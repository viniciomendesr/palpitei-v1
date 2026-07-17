/**
 * O backoff da reconexão manual do SSE (useSala.ts).
 *
 * Dobra a cada tentativa e bate num teto: rápido o bastante para uma queda de
 * rede num lance quente (1s na primeira), educado o bastante para não
 * metralhar um servidor caído com a sala cheia — France × England é a noite em
 * que todo mundo cai e volta junto.
 *
 * Puro e fora do hook de propósito: o agendamento é a parte da reconexão que
 * dá para provar por teste de unidade sem montar React nem browser
 * (test/reconexao.test.ts).
 */

export const RECONEXAO_BASE_MS = 1_000;
export const RECONEXAO_TETO_MS = 15_000;

/** Quanto esperar antes da tentativa de número `tentativa` (0 = a primeira). */
export function esperaDeReconexao(tentativa: number): number {
  // O expoente é limitado ANTES do 2**n: tentativa grande viraria Infinity e
  // o min() devolveria o teto por sorte, não por desenho.
  const expoente = Math.max(0, Math.min(tentativa, 30));
  return Math.min(RECONEXAO_TETO_MS, RECONEXAO_BASE_MS * 2 ** expoente);
}
