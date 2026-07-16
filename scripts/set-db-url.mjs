#!/usr/bin/env node
// Cola a connection string do Supabase no .env, com validação.
//
//   node scripts/set-db-url.mjs 'postgresql://postgres.xxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres'
//
// Aceita a URI entre aspas simples (importante: senha com # ou ! confunde o shell sem elas).
// Faz o percent-encoding da senha sozinho, testa a conexão de verdade e só então grava.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..');
const ENV = resolve(RAIZ, '.env');

const bruta = process.argv[2]?.trim();
if (!bruta) {
  console.error(`
Uso: node scripts/set-db-url.mjs '<connection string>'

Onde achar: Dashboard → Connect → aba ORMs (NÃO "App Frameworks"),
ou o bloco "Connection String" → Transaction pooler.

A certa começa com postgresql:// e tem :6543. Se começa com https://, é a URL da API — errada.
`);
  process.exit(1);
}

if (bruta.startsWith('https://')) {
  console.error(`
✗ Isso é a URL da API do projeto, não do banco.
  ${bruta}

  Ela serve ao PostgREST/Auth do Supabase, que esta v1 não usa (a identidade é o privy_did).
  Volte ao Connect e pegue a aba ORMs / Transaction pooler.
`);
  process.exit(1);
}

// Separa a senha na mão: uma senha com "@" quebraria o parser de URL.
const m = bruta.match(/^(postgres(?:ql)?):\/\/([^:]+):(.*)@([^@]+)$/);
if (!m) {
  console.error(`✗ Não reconheci o formato. Esperado:
  postgresql://USUARIO:SENHA@HOST:PORTA/BANCO`);
  process.exit(1);
}
const [, esquema, usuario, senhaBruta, resto] = m;

if (/YOUR-PASSWORD|\[.*\]/i.test(senhaBruta)) {
  console.error(`✗ A senha ainda é o placeholder "${senhaBruta}".
  Troque pela Database Password (Project Settings → Database → Reset database password, se perdeu).`);
  process.exit(1);
}

const senha = encodeURIComponent(decodeURIComponent(senhaBruta));
const url = `${esquema}://${usuario}:${senha}@${resto}`;
const u = new URL(url.replace(/^postgres:/, 'postgresql:'));

console.log(`host   : ${u.hostname}`);
console.log(`porta  : ${u.port}${u.port === '6543' ? '  (pooler ✓)' : `  ⚠ esperado 6543; ${u.port === '5432' ? 'a direta é IPv6-only no plano free' : '?'}`}`);
console.log(`usuário: ${u.username}${u.username.startsWith('postgres') ? '  ✓' : '  ⚠ não é a role dona — RLS devolve ZERO LINHAS sem erro'}`);
if (senha !== senhaBruta) console.log(`senha  : tinha caractere especial → percent-encoded`);

const { Client } = await import('pg');
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  await c.connect();
  const { rows } = await c.query('select current_user, current_database(), version()');
  console.log(`\n✓ conectado: ${rows[0].current_user} @ ${rows[0].current_database}`);
  console.log(`  ${rows[0].version.split(',')[0]}`);
  await c.end();
} catch (e) {
  console.error(`\n✗ não conectou: ${e.message}`);
  if (/password authentication/i.test(e.message)) console.error('  → senha errada. Resete em Project Settings → Database.');
  if (/ENOTFOUND|EAI_AGAIN/i.test(e.message)) console.error('  → host não resolveu. Confira se copiou a URI inteira.');
  if (/ENETUNREACH/i.test(e.message)) console.error('  → sem rota. Se for porta 5432, é o IPv6-only: use 6543.');
  process.exit(1);
}

const txt = readFileSync(ENV, 'utf8');
const linha = `DATABASE_URL=${url}`;
writeFileSync(ENV, /^DATABASE_URL=.*$/m.test(txt)
  ? txt.replace(/^DATABASE_URL=.*$/m, linha)
  : `${txt.trimEnd()}\n${linha}\n`);
console.log('\n✓ gravado no .env — agora: node scripts/migrate.mjs');
