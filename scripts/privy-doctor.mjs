import { readFileSync } from 'node:fs';
import os from 'node:os';

const PORT = process.env.PORT || '3000';
const PRIVY_ORIGIN = 'https://auth.privy.io';
const GOOGLE_CALLBACK = `${PRIVY_ORIGIN}/api/v1/oauth/callback`;

function readDotenv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const [key, ...rest] = line.split('=');
          return [key, rest.join('=').replace(/^['"]|['"]$/g, '')];
        }),
    );
  } catch {
    return {};
  }
}

function localOrigins() {
  const origins = new Set([`http://localhost:${PORT}`, `https://localhost:${PORT}`]);

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        origins.add(`http://${entry.address}:${PORT}`);
        origins.add(`https://${entry.address}:${PORT}`);
      }
    }
  }

  if (process.env.PALPITEI_DEV_ORIGIN) {
    origins.add(process.env.PALPITEI_DEV_ORIGIN.replace(/\/$/, ''));
  }

  return [...origins];
}

function ok(label) {
  console.log(`ok   ${label}`);
}

function warn(label) {
  console.log(`warn ${label}`);
}

function fail(label) {
  console.log(`FAIL ${label}`);
}

async function postOAuthInit(appId, origin) {
  const verifier = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = Buffer.from(verifier).toString('base64url');
  const digest = await crypto.subtle.digest('SHA-256', Buffer.from(codeVerifier));
  const codeChallenge = Buffer.from(digest).toString('base64url');
  const stateCode = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');

  const res = await fetch(`${PRIVY_ORIGIN}/api/v1/oauth/init`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      origin,
      'privy-app-id': appId,
      'privy-client': 'react-auth:3.35.1',
    },
    body: JSON.stringify({
      redirect_to: origin,
      provider: 'google',
      code_challenge: codeChallenge,
      state_code: stateCode,
    }),
  });

  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}

  if (!res.ok) {
    throw new Error(`${res.status} ${body?.error ?? text}`);
  }

  return body.url;
}

/** Retorna a recusa OAuth a partir de `Location.authError`, ou `null` se não houver. */
async function googleAuthError(authUrl) {
  const res = await fetch(authUrl, {
    redirect: 'manual',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36',
    },
  });

  // Em redirects, o veredito confiável está no header `Location`.
  const target = res.headers.get('location') || res.url || '';
  if (!target.includes('/signin/oauth/error')) return null;

  let decoded = '';
  try {
    const authError = new URL(target).searchParams.get('authError') ?? '';
    decoded = Buffer.from(authError, 'base64').toString('utf8');
  } catch {
    // A recusa continua válida mesmo sem um `authError` decodificável.
  }

  const reason = decoded.match(/[a-z][a-z_]*(?:mismatch|invalid|denied)[a-z_]*/i);
  return reason?.[0] ?? 'motivo não identificado';
}

const fileEnv = readDotenv('.env');
const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || fileEnv.NEXT_PUBLIC_PRIVY_APP_ID;

if (!appId) {
  fail('NEXT_PUBLIC_PRIVY_APP_ID ausente');
  process.exit(1);
}

console.log(`Privy app: ${appId}`);

let failures = 0;
const configRes = await fetch(`${PRIVY_ORIGIN}/api/v1/apps/${appId}`, {
  headers: { 'privy-app-id': appId, accept: 'application/json' },
});

if (!configRes.ok) {
  fail(`config real da Privy inacessivel (${configRes.status})`);
  process.exit(1);
}

const config = await configRes.json();
const allowed = new Set(config.allowed_domains ?? []);

config.google_oauth ? ok('google_oauth ligado') : (fail('google_oauth desligado'), failures++);
config.solana_wallet_auth
  ? ok('solana_wallet_auth ligado')
  : (fail('solana_wallet_auth desligado'), failures++);

const solanaCreate = config.embedded_wallet_config?.solana?.create_on_login;
solanaCreate === 'users-without-wallets'
  ? ok('embedded Solana create_on_login = users-without-wallets')
  : (fail(`embedded Solana create_on_login = ${solanaCreate ?? 'ausente'}`), failures++);

for (const origin of localOrigins()) {
  if (allowed.has(origin)) ok(`Allowed origin: ${origin}`);
  else warn(`origem local nao liberada na Privy: ${origin}`);
}

const oauthOrigin =
  localOrigins().find((origin) => origin.startsWith('https://') && allowed.has(origin)) ??
  [...allowed].find((origin) => origin.startsWith('https://')) ??
  [...allowed][0];

if (!oauthOrigin) {
  fail('nenhuma Allowed origin configurada na Privy');
  process.exit(1);
}

try {
  const googleUrl = await postOAuthInit(appId, oauthOrigin);
  const parsed = new URL(googleUrl);
  const redirectUri = parsed.searchParams.get('redirect_uri');
  const clientId = parsed.searchParams.get('client_id');

  console.log(`Google OAuth client_id: ${clientId}`);
  console.log(`Google redirect_uri:    ${redirectUri}`);

  if (redirectUri !== GOOGLE_CALLBACK) {
    fail(`redirect_uri inesperado; esperado ${GOOGLE_CALLBACK}`);
    failures++;
  }

  const authError = await googleAuthError(googleUrl);
  if (authError) {
    fail(`Google esta recusando o login: ${authError}`);
    console.log(`     Corrija no Google Cloud OAuth client ${clientId}:`);
    console.log(`     Authorized redirect URI: ${GOOGLE_CALLBACK}`);
    failures++;
  } else {
    ok('Google aceitou o redirect_uri gerado pela Privy');
  }
} catch (error) {
  fail(`OAuthInit Google falhou para ${oauthOrigin}: ${error.message}`);
  failures++;
}

process.exit(failures ? 1 : 0);
