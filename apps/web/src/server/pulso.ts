/** Sends SSE comments to keep otherwise idle live connections through proxy timeouts. */

/** Keeps a margin below common 30–60 second idle timeouts. */
export const PULSO_MS = 20_000;

/** Raw SSE comment heartbeat; it starts with `:` and ends with `\n\n`. */
export const PULSO = ': ping\n\n';

/** Calls `send` until stopped. Send failures cannot terminate the room process. */
export function iniciarPulso(enviar: () => void, intervaloMs: number = PULSO_MS): () => void {
  const timer = setInterval(() => {
    try {
      enviar();
    } catch {
      // Abort or cancel performs cleanup after a connection closes.
    }
  }, intervaloMs);
  return () => clearInterval(timer);
}
