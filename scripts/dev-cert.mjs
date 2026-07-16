/**
 * Emite o certificado do dev HTTPS cobrindo TODOS os endereços desta máquina.
 *
 * Por que existe: o `--experimental-https` do Next emite um cert só para
 * localhost/127.0.0.1/::1. Abrir pelo celular usa o IP da rede (172.20.10.x no
 * hotspot do iPhone, 192.168.x.x no Wi-Fi, 100.x no Tailscale) — que NÃO está no
 * SAN. O browser então recusa por NOME ERRADO, que é um aviso diferente e pior
 * que o de CA desconhecida: o Safari fica menos disposto a deixar passar.
 *
 * E HTTPS aqui não é capricho: fora de contexto seguro o `canUseEmbeddedWallet`
 * da ilha derruba a config de embedded wallet (a Privy depende de WebCrypto), a
 * carteira embutida some e o requisito "sign up through Solana" (E2) cai calado.
 * `http://localhost` é exceção e conta como seguro; `http://<ip-da-lan>`, não.
 *
 * O IP muda quando você troca de rede, então a lista é lida das interfaces a
 * cada boot. O cert só é REEMITIDO quando ela muda de verdade: reemitir à toa
 * troca a identidade do servidor e invalida a exceção que o celular já aceitou,
 * obrigando todo mundo a aceitar o aviso de novo.
 *
 * A CA continua sendo a do mkcert — o Mac confia (está no System keychain), os
 * outros aparelhos não. Quem abrir pelo IP aceita o aviso uma vez; o HTTPS segue
 * valendo depois disso, que é o que a carteira embutida precisa.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const certDir = resolve(raiz, 'apps/web/certificates');
const certFile = resolve(certDir, 'localhost.pem');
const keyFile = resolve(certDir, 'localhost-key.pem');
/** A lista exata que gerou o cert atual. Comparar isto é mais confiável que
 *  reparsear o SAN do x509 (o ::1 sai como 0:0:0:0:0:0:0:1, entre outros). */
const marcaFile = resolve(certDir, '.hosts.json');

const PORT = process.env.PORT || '3000';

/** O mkcert que o próprio Next baixa, ou um instalado no PATH. */
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
