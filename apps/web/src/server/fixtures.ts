/** Snapshot TxLINE com TTL curto e single-flight por processo. */
import { fetchFixtures } from '@palpitei/txline';
import type { Fixture } from '@palpitei/core';

const TTL_MS = Math.max(1_000, Number(process.env.TXLINE_FIXTURES_CACHE_MS ?? 15_000) || 15_000);
const CHAVE = '__palpitei_fixtures_cache__' as const;

type Cache = {
  valor: Fixture[] | null;
  expiraEm: number;
  emVoo: Promise<Fixture[]> | null;
};

type GlobalComCache = typeof globalThis & { [CHAVE]?: Cache };

function cache(): Cache {
  const g = globalThis as GlobalComCache;
  return (g[CHAVE] ??= { valor: null, expiraEm: 0, emVoo: null });
}

/**
 * Evita uma chamada idêntica à devnet por fã. Se a atualização falhar e já
 * houver snapshot anterior, devolve o último valor conhecido (stale cache).
 */
export async function fixturesTxline(): Promise<Fixture[]> {
  const c = cache();
  if (c.valor && Date.now() < c.expiraEm) return c.valor;
  if (c.emVoo) return c.emVoo;

  c.emVoo = fetchFixtures()
    .then((valor) => {
      c.valor = valor;
      c.expiraEm = Date.now() + TTL_MS;
      return valor;
    })
    .catch((erro) => {
      if (c.valor) return c.valor;
      throw erro;
    })
    .finally(() => {
      c.emVoo = null;
    });

  return c.emVoo;
}
