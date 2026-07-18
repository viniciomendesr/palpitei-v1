/** Interpolates the match clock between events without moving behind its anchor. */
export function minutoDoReplay(
  ancoraGameSeconds: number,
  ancoraRealAtMs: number,
  speed: number,
  agoraMs: number,
): number {
  return Math.floor(segundoDoReplay(ancoraGameSeconds, ancoraRealAtMs, speed, agoraMs) / 60);
}

/** Match seconds since the anchor, without minute rounding. */
export function segundoDoReplay(
  ancoraGameSeconds: number,
  ancoraRealAtMs: number,
  speed: number,
  agoraMs: number,
): number {
  const decorridoRealS = Math.max(0, agoraMs - ancoraRealAtMs) / 1000;
  return Math.floor(ancoraGameSeconds + decorridoRealS * speed);
}

/** Never extrapolates beyond the latest clock present in the timeline. */
export function limitarSegundoDoReplay(interpolado: number, maximoReal: number | null): number {
  return maximoReal === null ? interpolado : Math.min(interpolado, maximoReal);
}

/** Formats match seconds as `MM:SS`. */
export function formataRelogio(totalGameSeconds: number): string {
  const s = Math.max(0, totalGameSeconds);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
