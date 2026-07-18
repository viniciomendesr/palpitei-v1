/** Interpola relógio de jogo entre eventos sem deixar a parede regredir a âncora. */
export function minutoDoReplay(
  ancoraGameSeconds: number,
  ancoraRealAtMs: number,
  speed: number,
  agoraMs: number,
): number {
  return Math.floor(segundoDoReplay(ancoraGameSeconds, ancoraRealAtMs, speed, agoraMs) / 60);
}

/** Segundos de jogo desde a âncora, sem arredondamento a minuto. */
export function segundoDoReplay(
  ancoraGameSeconds: number,
  ancoraRealAtMs: number,
  speed: number,
  agoraMs: number,
): number {
  const decorridoRealS = Math.max(0, agoraMs - ancoraRealAtMs) / 1000;
  return Math.floor(ancoraGameSeconds + decorridoRealS * speed);
}

/** Nunca extrapola além do último relógio que realmente existe na timeline. */
export function limitarSegundoDoReplay(interpolado: number, maximoReal: number | null): number {
  return maximoReal === null ? interpolado : Math.min(interpolado, maximoReal);
}

/** Formata segundos de jogo em `MM:SS`. */
export function formataRelogio(totalGameSeconds: number): string {
  const s = Math.max(0, totalGameSeconds);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
