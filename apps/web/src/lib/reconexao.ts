/** Capped exponential backoff for SSE reconnection. */

export const RECONEXAO_BASE_MS = 1_000;
export const RECONEXAO_TETO_MS = 15_000;

/** Delay before attempt number `tentativa` (0 is the first attempt). */
export function esperaDeReconexao(tentativa: number): number {
  // Cap the exponent before calculating to prevent `Infinity`.
  const expoente = Math.max(0, Math.min(tentativa, 30));
  return Math.min(RECONEXAO_TETO_MS, RECONEXAO_BASE_MS * 2 ** expoente);
}
