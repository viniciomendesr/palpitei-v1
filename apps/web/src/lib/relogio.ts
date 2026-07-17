/**
 * O minuto do replay ENTRE eventos do feed.
 *
 * O servidor manda a âncora (segundos de jogo do último evento com relógio) e a
 * velocidade; aqui só se interpola o intervalo até o próximo lance — que
 * re-ancora tudo. É a mesma disciplina do cursorClock do servidor (B2): o
 * relógio de parede NUNCA manda, só preenche. Por isso o `max(0, …)`: parede
 * atrasada (skew, aba que dormiu) segura o minuto na âncora, não o regride.
 *
 * Pura e fora do hook de propósito: dá para provar por teste de unidade
 * (test/relogio.test.ts) sem montar React.
 */
export function minutoDoReplay(
  ancoraGameSeconds: number,
  ancoraRealAtMs: number,
  speed: number,
  agoraMs: number,
): number {
  return Math.floor(segundoDoReplay(ancoraGameSeconds, ancoraRealAtMs, speed, agoraMs) / 60);
}

/** Os segundos DE JOGO desde a âncora — a mesma interpolação, sem arredondar a minuto. */
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

/** `MM:SS`, como cronômetro de transmissão. Só formata — quem conta é o de cima. */
export function formataRelogio(totalGameSeconds: number): string {
  const s = Math.max(0, totalGameSeconds);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
