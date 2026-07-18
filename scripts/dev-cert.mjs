/** Creates a development certificate for localhost and current LAN IPs. */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const certDir = resolve(raiz, 'apps/web/certificates');
const certFile = resolve(certDir, 'localhost.pem');
const keyFile = resolve(certDir, 'localhost-key.pem');
/** Lists hosts included in the current certificate. */
const marcaFile = resolve(certDir, '.hosts.json');

const PORT = process.env.PORT || '3000';

/** Uses mkcert downloaded by Next.js or available on PATH. */
function acharMkcert() {
  const doNext = resolve(
    os.homedir(),
    'Library/Caches/mkcert',
    `mkcert-v1.4.4-${process.platform}-${process.arch}`,
  );
  if (existsSync(doNext)) return doNext;

  try {
    return execFileSync('which', ['mkcert'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function ipsDaMaquina() {
  const ips = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) ips.push(entry.address);
    }
  }
  return ips;
}

const hosts = ['localhost', '127.0.0.1', '::1', ...ipsDaMaquina()];

const marcaAtual = JSON.stringify(hosts);
const jaServe =
  existsSync(certFile) &&
  existsSync(keyFile) &&
  existsSync(marcaFile) &&
  readFileSync(marcaFile, 'utf8') === marcaAtual;

if (jaServe) {
  console.log(`[cert] ok — ja cobre: ${hosts.join(', ')}`);
} else {
  const mkcert = acharMkcert();
  if (!mkcert) {
    console.error(
      '\n[cert] mkcert nao encontrado.\n' +
        '       Instale com:  brew install mkcert && mkcert -install\n' +
        '       (ou rode `npm run dev:https` uma vez: o Next baixa o binario sozinho)\n',
    );
    process.exit(1);
  }

  mkdirSync(certDir, { recursive: true });
  console.log(`[cert] emitindo para: ${hosts.join(', ')}`);
  execFileSync(mkcert, ['-cert-file', certFile, '-key-file', keyFile, ...hosts], {
    stdio: 'inherit',
  });
  writeFileSync(marcaFile, marcaAtual);
}

const lan = ipsDaMaquina();
console.log(`\n  Mac:      https://localhost:${PORT}`);
for (const ip of lan) console.log(`  Celular:  https://${ip}:${PORT}`);

if (lan.length) {
  console.log(
    '\n  No celular o aviso de certificado aparece uma vez (a CA e local, so este\n' +
      '  Mac a conhece). Aceite e siga — o HTTPS continua valendo, que e o que a\n' +
      '  carteira embutida precisa. Cada origem acima tem que estar em Allowed\n' +
      '  origins na Privy: confira com `npm run privy:doctor`.\n',
  );
}
