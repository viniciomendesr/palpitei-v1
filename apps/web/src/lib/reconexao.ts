/** Backoff exponencial limitado para a reconexão SSE. */

export const RECONEXAO_BASE_MS = 1_000;
export const RECONEXAO_TETO_MS = 15_000;

/** Quanto esperar antes da tentativa de número `tentativa` (0 = a primeira). */
export function esperaDeReconexao(tentativa: number): number {
  // Limite o expoente antes de calcular para evitar `Infinity`.
  const expoente = Math.max(0, Math.min(tentativa, 30));
  return Math.min(RECONEXAO_TETO_MS, RECONEXAO_BASE_MS * 2 ** expoente);
}
