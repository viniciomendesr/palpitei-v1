/**
 * Config do PWA.
 *
 * transpilePackages: os pacotes do monorepo são ESM e vão publicados como fonte
 * (o ds traz .jsx compilado por esbuild, sem passar pelo babel/swc do Next). Sem
 * isto o Next não transpila o que vem de node_modules/@palpitei/* e o build quebra.
 *
 * @palpitei/core JÁ existe no disco (packages/core, motores puros + testes) mas
 * ainda não é importado por nenhuma tela, e por isso não está em dependencies:
 * declarar dependência de código que ninguém importa é mentir no manifesto.
 * Listar aqui é inofensivo — transpilePackages casa por caminho, não resolve o
 * módulo — e deixa a fronteira pronta. Quando a primeira tela importar de
 * @palpitei/core, adicione "@palpitei/core": "*" em dependencies no MESMO commit:
 * é workspace, o npm install resolve pelo link local.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import os from 'node:os';

// O .env vive na RAIZ do monorepo (um arquivo, um lugar). O Next só procura na
// pasta do app, então sem isto NEXT_PUBLIC_PRIVY_APP_ID chega undefined, a ilha
// da Privy se desliga SOZINHA e o login só falha quando o fã clica: o app sobe,
// a tela aparece, o modo demo funciona, e ninguém descobre. Medido em 16/07.
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: resolve(raiz, '.env') });

// Falha alto no boot em vez de degradar calado. NEXT_PUBLIC_* é inlinado em
// build time: se faltar aqui, falta para sempre no bundle — e o watchdog de 8s
// da ilha só pega o caso em que a Privy sobe e trava, não o caso em que ela
// nunca chega a ser tentada.
if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
  console.warn(
    '\n[palpitei] NEXT_PUBLIC_PRIVY_APP_ID ausente — a Privy fica DESLIGADA neste build.\n' +
      `           Procurei em: ${resolve(raiz, '.env')}\n` +
      '           O modo demo (§5.1) segue funcionando; Google e carteira, não.\n',
  );
}

function localDevHosts() {
  const hosts = new Set(['localhost', '127.0.0.1']);

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) hosts.add(entry.address);
    }
  }

  if (process.env.PALPITEI_DEV_ORIGIN) {
    hosts.add(process.env.PALPITEI_DEV_ORIGIN.replace(/^https?:\/\//, '').replace(/:\d+$/, ''));
  }

  return [...hosts];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `next build` e `next dev` brigam pelo MESMO .next: build com o dev vivo
  // morre em "Cannot find module for page: /_document" (medido em 17/07). Um
  // distDir alternativo (NEXT_DIST_DIR=.next-build) deixa o build de produção
  // rodar ao lado do dev — e `next start` precisa do MESMO valor para achá-lo.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: localDevHosts(),
  // @palpitei/txline entra aqui pelo mesmo motivo do core: é publicado como FONTE
  // (exports: "./src/index.ts"), então quem transpila é o Next. O @palpitei/db NÃO
  // entra — ele compila para dist/ (por isso `build:db` roda antes no build da raiz).
  transpilePackages: ['@palpitei/core', '@palpitei/ds', '@palpitei/txline'],
};

export default nextConfig;
