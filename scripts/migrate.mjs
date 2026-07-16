#!/usr/bin/env node
// Aplica as migrations de supabase/migrations em ordem. Idempotente.
//
// Uso:
//   node scripts/migrate.mjs           aplica o que falta
//   node scripts/migrate.mjs --status  só mostra o que está aplicado
//   node scripts/migrate.mjs --dry-run mostra o que aplicaria, sem aplicar
//
// Decisões que este script encarna:
//
// · CADA MIGRATION RODA NUMA TRANSAÇÃO. Se o arquivo falhar no meio, o banco
//   volta ao que era. Meio-schema aplicado é pior que schema nenhum: o próximo
//   `create table if not exists` passa por cima e o erro vira silêncio.
//
// · O CHECKSUM É CONFERIDO. Migration já aplicada que MUDOU no disco é erro, não
//   aviso: significa que o seu banco e o seu repositório discordam sobre o que
//   está no banco — e ninguém descobre isso até algo quebrar em produção.
//
// · SEM DEPENDÊNCIA NOVA: usa o `pg` que o @palpitei/db já traz.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(RAIZ, 'supabase', 'migrations');

const args = process.argv.slice(2);
const soStatus = args.includes('--status');
const dryRun = args.includes('--dry-run');

function carregarEnv() {
  // .env simples, sem dependência: só o suficiente para achar a DATABASE_URL.
  try {
    const texto = readFileSync(join(RAIZ, '.env'), 'utf8');
    for (const linha of texto.split('\n')) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const chave = m[1];
      let valor = m[2].trim();
      if (
        (valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))
      ) {
        valor = valor.slice(1, -1);
      }
      if (!(chave in process.env)) process.env[chave] = valor;
    }
  } catch {
    // sem .env: seguimos com o ambiente do processo
  }
}

function listarMigrations() {
  let arquivos;
  try {
    arquivos = readdirSync(DIR);
  } catch {
    console.error(`ERRO: ${DIR} não existe.`);
    process.exit(1);
  }
  return arquivos
    .filter((f) => f.endsWith('.sql'))
    .sort() // 0001_, 0002_… ordem lexicográfica = ordem cronológica
    .map((nome) => {
      const sql = readFileSync(join(DIR, nome), 'utf8');
      return {
        version: nome.replace(/\.sql$/, ''),
        nome,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16),
      };
    });
}

function sslDe(url) {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '') return false;
  const ca = process.env.DATABASE_CA_CERT;
  if (ca) {
    const pem = ca.includes('BEGIN CERTIFICATE') ? ca : readFileSync(ca, 'utf8');
    return { ca: pem, rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

async function main() {
  carregarEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ERRO: DATABASE_URL não definida. Copie .env.example para .env (veja como apontar para o Supabase).');
    process.exit(1);
  }

  const migrations = listarMigrations();
  if (migrations.length === 0) {
    console.log('nenhuma migration em supabase/migrations — nada a fazer.');
    return;
  }

  const client = new pg.Client({ connectionString: url, ssl: sslDe(url) });
  await client.connect();

  try {
    const [{ current_database: banco, current_user: usuario }] = (
      await client.query('select current_database(), current_user')
    ).rows;
    console.log(`banco: ${banco} · role: ${usuario}`);

    await client.query(`
      create table if not exists schema_migrations (
        version     text primary key,
        checksum    text not null,
        applied_at  timestamptz not null default now()
      )
    `);

    // RLS ligada sem policy é o que fecha o PostgREST que o Supabase publica sozinho
    // sobre o schema public. As tabelas de dados já nascem assim pela migration; esta
    // aqui é criada em código, então precisa do mesmo tratamento — senão fica a única
    // fresta aberta, e a role dona (postgres) segue ignorando RLS normalmente.
    await client.query('alter table schema_migrations enable row level security');

    const aplicadas = new Map(
      (await client.query('select version, checksum, applied_at from schema_migrations')).rows.map((r) => [
        r.version,
        r,
      ])
    );

    if (soStatus) {
      for (const m of migrations) {
        const a = aplicadas.get(m.version);
        const marca = !a ? 'PENDENTE' : a.checksum === m.checksum ? 'ok' : 'ALTERADA!';
        const quando = a ? new Date(a.applied_at).toISOString().slice(0, 16).replace('T', ' ') : '';
        console.log(`  [${marca.padEnd(9)}] ${m.version} ${quando}`);
      }
      return;
    }

    let aplicou = 0;
    for (const m of migrations) {
      const anterior = aplicadas.get(m.version);

      if (anterior) {
        if (anterior.checksum !== m.checksum) {
          // Editar migration já aplicada é a forma clássica de o schema do
          // banco divergir do repositório sem ninguém perceber. Crie 0002_.
          console.error(
            `\nERRO: ${m.nome} já foi aplicada em ${new Date(anterior.applied_at).toISOString()} ` +
              `mas o arquivo MUDOU (${anterior.checksum} -> ${m.checksum}).\n` +
              `      O banco não tem essa alteração. Não edite migration aplicada: ` +
              `crie uma nova (ex.: 0002_o_que_muda.sql).`
          );
          process.exit(1);
        }
        console.log(`  · ${m.version} já aplicada`);
        continue;
      }

      if (dryRun) {
        console.log(`  + ${m.version} SERIA aplicada (${m.sql.length} bytes)`);
        aplicou++;
        continue;
      }

      process.stdout.write(`  + aplicando ${m.version}… `);
      const t0 = Date.now();
      try {
        await client.query('begin');
        await client.query(m.sql);
        await client.query('insert into schema_migrations (version, checksum) values ($1, $2)', [
          m.version,
          m.checksum,
        ]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback').catch(() => {});
        console.log('FALHOU');
        console.error(`\nERRO em ${m.nome}: ${e.message}`);
        if (e.position) {
          const pos = Number(e.position);
          const antes = m.sql.slice(0, pos);
          console.error(`  linha ${antes.split('\n').length}: ${JSON.stringify(m.sql.slice(Math.max(0, pos - 60), pos + 40))}`);
        }
        console.error('  (a transação foi desfeita — o banco continua como estava)');
        process.exit(1);
      }
      console.log(`ok (${Date.now() - t0}ms)`);
      aplicou++;
    }

    console.log(
      aplicou === 0
        ? '\nnada a aplicar — o banco já está em dia.'
        : `\n${aplicou} migration(s) ${dryRun ? 'seriam aplicadas' : 'aplicadas'}.`
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
