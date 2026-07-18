/** Configuração do Next para os pacotes ESM do monorepo. */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import os from 'node:os';

// O Next não carrega automaticamente o `.env` da raiz do monorepo.
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: resolve(raiz, '.env') });

// Variáveis NEXT_PUBLIC são injetadas no build; falhe de forma visível se faltar.
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
  // Permite build paralelo ao dev quando `NEXT_DIST_DIR` é configurado.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: localDevHosts(),
  // Core, DS e TxLINE são fontes TypeScript; DB é consumido a partir de `dist`.
  transpilePackages: ['@palpitei/core', '@palpitei/ds', '@palpitei/txline'],
};

export default nextConfig;
