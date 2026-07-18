/**
 * Pure, locale-injected renderer for chance updates. It uses structured event
 * fields and the current dictionary; server text is only a fallback/log value.
 * Context is rendered only when the supplied action has a known translation.
 */

import type { Dict } from './i18n';
import type { SalaChance } from './useSala';

/** Dictionary subset consumed by the renderer. */
export type DicionarioDeChance = Pick<Dict, 'chanceUp' | 'chanceDown' | 'chanceDraw' | 'chanceCtx'>;

/** Maps a 1X2 feed price name to the final-result option id. */
export function idDaOpcaoChance(priceName: string): 'p1' | 'draw' | 'p2' | null {
  const n = priceName.toLowerCase();
  if (n === 'part1' || n === '1' || n === 'home') return 'p1';
  if (n === 'x' || n === 'draw') return 'draw';
  if (n === 'part2' || n === '2' || n === 'away') return 'p2';
  return null;
}

/** Maps known feed aliases to the display names used by the final-result UI. */
function nomeDaChance(priceName: string, t: DicionarioDeChance, teamA: string, teamB: string): string {
  const n = priceName.toLowerCase();
  if (n === 'part1' || n === '1' || n === 'home') return teamA;
  if (n === 'part2' || n === '2' || n === 'away') return teamB;
  if (n === 'x' || n === 'draw') return t.chanceDraw;
  return priceName;
}

/** Renders a chance update using the supplied locale, with one decimal place. */
export function redigeChance(
  leitura: Pick<SalaChance, 'priceName' | 'fromPct' | 'toPct' | 'contextAction'>,
  t: DicionarioDeChance,
  teamA: string,
  teamB: string,
): string {
  const nome = nomeDaChance(leitura.priceName, t, teamA, teamB);
  // `noUncheckedIndexedAccess`: an unknown key returns undefined, so no context is rendered.
  const fragmento = leitura.contextAction ? t.chanceCtx[leitura.contextAction] : undefined;
  const causa = fragmento ? ` ${fragmento}` : '';
  const template = leitura.toPct >= leitura.fromPct ? t.chanceUp : t.chanceDown;
  return template
    .replace('{nome}', nome)
    .replace('{de}', leitura.fromPct.toFixed(1))
    .replace('{para}', leitura.toPct.toFixed(1))
    .replace('{causa}', causa);
}
