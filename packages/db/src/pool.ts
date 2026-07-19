// PostgreSQL connection. `pg` works with both Supabase direct and transaction
// pooler endpoints without named prepared statements.

import pgPkg from 'pg';
import { readFileSync } from 'node:fs';

const { Pool, types } = pgPkg;
type PoolType = InstanceType<typeof Pool>;

// Parse INT8 values used as epoch milliseconds or counters, rejecting unsafe values.
types.setTypeParser(types.builtins.INT8, (v: string): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) {
    throw new Error(
      `[db] bigint ${v} não cabe num number seguro (>2^53). ` +
        `Se isto apareceu, algum campo deixou de ser epoch ms/contador e precisa de BigInt.`
    );
  }
  return n;
});

export type Row = Record<string, unknown>;

/** Query executor: the pool or a transaction client. */
export interface Executor {
  query<R extends Row = Row>(text: string, values?: unknown[]): Promise<R[]>;
}

export interface Db extends Executor {
  pool: PoolType;
  withTx<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type CreateDbOptions = {
  /** Default: process.env.DATABASE_URL */
  url?: string;
  max?: number;
  /** CA PEM, or a path to one, used to verify the certificate. */
  caCert?: string;
};

function sslConfig(url: string, caCert?: string): false | { ca?: string; rejectUnauthorized: boolean } {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  if (local) return false; // Local development Postgres does not use TLS.

  const ca = caCert ?? process.env.DATABASE_CA_CERT;
  if (ca) {
    const pem = ca.includes('BEGIN CERTIFICATE') ? ca : readFileSync(ca, 'utf8');
    return { ca: pem, rejectUnauthorized: true };
  }
  // Encryption remains enabled without a CA, but certificate verification is disabled.
  return { rejectUnauthorized: false };
}

export function createDb(opts: CreateDbOptions = {}): Db {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      '[db] DATABASE_URL não definida. Copie .env.example para .env e aponte para o seu Postgres/Supabase.'
    );
  }

  const pool = new Pool({
    connectionString: url,
    max: opts.max ?? 10,
    ssl: sslConfig(url, opts.caCert),
    // Fail quickly when the Supabase pooler drops an idle connection.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  // Pool emits idle-connection errors; handle them to keep the process alive.
  pool.on('error', (err: Error) => {
    console.error('[db] idle pool connection error:', err.message);
  });

  const db: Db = {
    pool,

    async query<R extends Row = Row>(text: string, values?: unknown[]): Promise<R[]> {
      const res = await pool.query<R>(text, values as never);
      return res.rows;
    },

    async withTx<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const tx: Executor = {
          async query<R extends Row = Row>(text: string, values?: unknown[]): Promise<R[]> {
            const res = await client.query<R>(text, values as never);
            return res.rows;
          },
        };
        const out = await fn(tx);
        await client.query('commit');
        return out;
      } catch (e) {
        try {
          await client.query('rollback');
        } catch {
          // The connection is already dead, so rollback is implicit.
        }
        throw e;
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };

  return db;
}

/**
 * Verifies read/write access and returns schema version information. RLS without
 * policies intentionally fails startup when the connection uses the wrong role.
 */
export async function assertDbReady(db: Executor): Promise<{ version: string; migrations: number }> {
  const [info] = await db.query<{ user_name: string; server: string }>(
    'select current_user as user_name, version() as server'
  );

  const applied = await db.query<{ version: string }>(
    `select version from schema_migrations order by version`
  ).catch(() => {
    throw new Error(
      '[db] tabela schema_migrations não existe — rode `npm run db:migrate` antes de subir o servidor.'
    );
  });

  // The role must be able to read users before checking RLS state.
  try {
    await db.query('select 1 from users limit 1');
  } catch (e) {
    throw new Error(
      `[db] a role "${info?.user_name}" não consegue ler users (${(e as Error).message}). ` +
        `As tabelas têm RLS ligada sem policy: use a connection string da role postgres (dona do schema).`
    );
  }

  // row_security_active detects a role subject to RLS, unlike count(*) queries.
  const [rls] = await db.query<{ ativa: boolean }>(
    `select row_security_active('users') as ativa`
  );
  if (rls?.ativa) {
    throw new Error(
      `[db] a role "${info?.user_name}" está SUJEITA à RLS (row_security_active('users') = true). ` +
        `As tabelas têm RLS ligada SEM POLICY de propósito, para fechar o PostgREST que o Supabase ` +
        `publica sozinho — o que significa que esta role vai ler ZERO LINHAS de tudo, sem erro nenhum. ` +
        `Use a connection string da role dona do schema (postgres), não a anon/authenticated.`
    );
  }

  return {
    version: String(info?.server ?? '?'),
    migrations: applied.length,
  };
}
