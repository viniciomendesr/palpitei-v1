/**
 * O redator da leitura de chance — PURO, e bilíngue por injeção.
 *
 * O core emite `text` em pt fixo; a tela é bilíngue, então a frase que o fã lê
 * é redigida AQUI, pelos campos estruturados do contrato (priceName, fromPct,
 * toPct, contextAction) + o dicionário corrente. O `text` do servidor fica como
 * fallback/log — nunca como a frase da tela.
 *
 * Duas regras que não se negociam:
 * - A CAUSA só sai do mapa `chanceCtx`. `contextAction` ausente (não houve lance
 *   na janela de 3 min do core) ou desconhecido = frase SEM causa. Inventar
 *   "depois do gol" onde o dado não disse isso é o G6.
 * - Nome sem correspondência no mapa do feed sai CRU (o priceName como veio).
 *   Feio e verdadeiro ganha de bonito e falso.
 *
 * Só `import type` aqui em cima: o teste roda em node:test com strip-types, e
 * i18n.tsx/useSala.ts têm JSX/React que o node não parseia. Tipo é apagado;
 * runtime deste módulo não importa nada.
 */

import type { Dict } from './i18n';
import type { SalaChance } from './useSala';

/** O pedaço do dicionário que o redator usa — as telas passam o `t` inteiro. */
export type DicionarioDeChance = Pick<Dict, 'chanceUp' | 'chanceDown' | 'chanceDraw' | 'chanceCtx'>;

/**
 * Mapa de nomes do feed → nome na tela (contrato):
 * part1|1|home → teamA · part2|2|away → teamB · x|draw → empate/draw.
 * O mesmo aliasing do OddsExplainer do core — o feed 1X2 real manda
 * "part1"/"draw"/"part2"; os demais ficam por segurança.
 */
function nomeDaChance(priceName: string, t: DicionarioDeChance, teamA: string, teamB: string): string {
  const n = priceName.toLowerCase();
  if (n === 'part1' || n === '1' || n === 'home') return teamA;
  if (n === 'part2' || n === '2' || n === 'away') return teamB;
  if (n === 'x' || n === 'draw') return t.chanceDraw;
  return priceName;
}

/** A frase da leitura, no idioma do `t` recebido. Percentuais com 1 casa. */
export function redigeChance(
  leitura: Pick<SalaChance, 'priceName' | 'fromPct' | 'toPct' | 'contextAction'>,
  t: DicionarioDeChance,
  teamA: string,
  teamB: string,
): string {
  const nome = nomeDaChance(leitura.priceName, t, teamA, teamB);
  // noUncheckedIndexedAccess: chave fora do mapa devolve undefined → sem causa.
  const fragmento = leitura.contextAction ? t.chanceCtx[leitura.contextAction] : undefined;
  const causa = fragmento ? ` ${fragmento}` : '';
  const template = leitura.toPct >= leitura.fromPct ? t.chanceUp : t.chanceDown;
  return template
    .replace('{nome}', nome)
    .replace('{de}', leitura.fromPct.toFixed(1))
    .replace('{para}', leitura.toPct.toFixed(1))
    .replace('{causa}', causa);
}
