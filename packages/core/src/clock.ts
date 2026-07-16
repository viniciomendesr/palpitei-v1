// Abstração de relógio na linha do tempo da PARTIDA (epoch ms do feed).
// Os motores nunca usam Date.now() direto — sempre clock.now(). É isso que
// faz o mesmo código funcionar ao vivo (1x) e em replay acelerado (Nx).
// Date.now() aparece SÓ aqui dentro, que é a fronteira com o mundo real.

export type Clock = {
  now(): number;
  speed: number;
  /** Converte uma duração em ms de partida para ms reais (p/ cronômetros na UI). */
  toRealMs(matchMs: number): number;
};

export function liveClock(): Clock {
  return {
    now: () => Date.now(),
    speed: 1,
    toRealMs: (matchMs) => matchMs,
  };
}

export function replayClock(t0Match: number, speed: number): Clock {
  const t0Real = Date.now();
  return {
    now: () => t0Match + (Date.now() - t0Real) * speed,
    speed,
    toRealMs: (matchMs) => matchMs / speed,
  };
}

// O ReplayRunner comprime buracos grandes (pré-jogo, intervalo) para <= 2s
// reais, então o replayClock "puro" deriva do agendador em dezenas de minutos
// de jogo — o bastante para fechar janelas de palpite antes de qualquer
// reação (bug real do v0, B2). O cursorClock ancora o relógio no ÚLTIMO
// evento emitido e só interpola o tempo real desde então.

export type ReplayCursor = { matchTs: number; realAt: number };

export function cursorClock(cursor: ReplayCursor, speed: number): Clock {
  return {
    now: () => cursor.matchTs + (Date.now() - cursor.realAt) * speed,
    speed,
    toRealMs: (matchMs) => matchMs / speed,
  };
}

/** Relógio controlado na mão — só para testes. */
export function manualClock(start: number): Clock & { set(ts: number): void } {
  let current = start;
  return {
    now: () => current,
    speed: 1,
    toRealMs: (matchMs) => matchMs,
    set(ts: number) {
      current = ts;
    },
  };
}
