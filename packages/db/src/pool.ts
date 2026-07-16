// Conexão com o Postgres.
//
// POR QUE `pg` (node-postgres) E NÃO `postgres.js`:
//
// 1. O pooler do Supabase (Supavisor, porta 6543, modo transaction) NÃO suporta
//    prepared statements nomeados. O `postgres.js` prepara por padrão e, ligado
//    ao pooler, quebra com "prepared statement already exists" — só sob carga,
//    só às vezes. Some se você lembrar de `prepare: false`. É exatamente a
//    classe de armadilha que este projeto vem colecionando: falha rara e
//    dependente de configuração. O `pg` usa extended query SEM nome por padrão,
//    então funciona nos dois modos (5432 e 6543) sem flag nenhuma.
// 2. O `pg` tipa e testa o caminho de `PoolClient` para transações, que é onde
//    mora a idempotência do XP (o CAS de predictionRepo.settle).
// 3. `@types/pg` é maduro e o driver é o mais rodado do ecossistema — a 2,5 dias
//    do prazo, driver chato e previsível vale mais que ergonomia.
//
// O preço é SQL em string, sem tagged template. Aceito.

import pgPkg from 'pg';
import { readFileSync } from 'node:fs';

const { Pool, types } = pgPkg;
type PoolType = InstanceType<typeof Pool>;

// ---------------------------------------------------------------------------
// BIGINT: o `pg` devolve int8 (OID 20) como STRING para não perder precisão —
// e aí `ev.ts > cursor.matchTs` vira comparação de strings, que dá certo por
// acidente até o dia em que o número muda de dígitos. Todos os int8 daqui são
// epoch ms (~1,7e12) ou contadores, muito abaixo de 2^53: convertemos para
// number e ESTOURAMOS ALTO se algum dia não couber, em vez de arredondar calado.
// ---------------------------------------------------------------------------
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

/** Executor: o pool ou um cliente dentro de uma transação. */
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
  /** PEM da CA (ou caminho para o arquivo) para verificar o certificado. */
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
  if (local) return false; // Postgres local de desenvolvimento não tem TLS.

  const ca = caCert ?? process.env.DATABASE_CA_CERT;
  if (ca) {
    const pem = ca.includes('BEGIN CERTIFICATE') ? ca : readFileSync(ca, 'utf8');
    return { ca: pem, rejectUnauthorized: true };
  }
  // Sem CA: a conexão continua CRIPTOGRAFADA, mas a cadeia do certificado não é
  // verificada (o Supabase assina com CA própria no host direto). Para
  // verificação completa, baixe o certificado no painel do Supabase e aponte
  // DATABASE_CA_CERT para ele. Dito aqui em voz alta para não passar por
  // "TLS ok" sem ressalva.
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
    // O pooler do Supabase derruba conexão ociosa; falhar rápido é melhor que
    // pendurar a requisição do jurado.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  // Sem isto, um erro em conexão ociosa do pool derruba o processo inteiro
  // (o 'error' do Pool é um EventEmitter: sem listener, Node lança).
  pool.on('error', (err: Error) => {
    console.error('[db] erro em conexão ociosa do pool:', err.message);
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
          // conexão já morta: o rollback é implícito
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
 * Confere que dá para LER e ESCREVER de verdade, e devolve a versão do schema.
 *
 * Existe por um motivo específico: as tabelas têm RLS ligada SEM POLICY (para
 * fechar o PostgREST que o Supabase publica sozinho). A role dona (`postgres`)
 * ignora RLS; qualquer outra role passa a enxergar ZERO LINHAS — sem erro, sem
 * log. Seria um banco "funcionando" e vazio. Este check transforma isso em
 * falha barulhenta no boot.
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

  // A role tem de PODER ler users — se nem isso, o erro é direto.
  try {
    await db.query('select 1 from users limit 1');
  } catch (e) {
    throw new Error(
      `[db] a role "${info?.user_name}" não consegue ler users (${(e as Error).message}). ` +
        `As tabelas têm RLS ligada sem policy: use a connection string da role postgres (dona do schema).`
    );
  }

  // E o cheque que importa. Ele NÃO pode ser "select count(*) ... e ver se
  // voltou linha": count(*) devolve UMA linha sempre — com n=0 — mesmo quando a
  // RLS está zerando tudo. Era um check que não tinha como falhar.
  //
  // `row_security_active('users')` responde a pergunta certa: a RLS está sendo
  // APLICADA a ESTA role nesta tabela? Para a dona do schema (que a ignora) vem
  // false. Para qualquer outra role vem true — e aí o banco está "funcionando"
  // e vazio: sem policy nenhuma, todo select devolve zero linhas, sem erro e sem
  // log. É a falha silenciosa que esta função existe para transformar em ruído.
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
