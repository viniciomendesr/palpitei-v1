// Match-timeline clock (feed epoch milliseconds). Engines receive time through
// this boundary so live and accelerated replay execution remain deterministic.

export type Clock = {
  now(): number;
  speed: number;
  /** Converts match-time milliseconds to wall-clock milliseconds for UI timers. */
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

// Replay scheduling may compress large gaps. Anchor elapsed time to the latest
// emitted event so timers cannot advance through skipped match time.

export type ReplayCursor = { matchTs: number; realAt: number };

export function cursorClock(cursor: ReplayCursor, speed: number): Clock {
  return {
    now: () => cursor.matchTs + (Date.now() - cursor.realAt) * speed,
    speed,
    toRealMs: (matchMs) => matchMs / speed,
  };
}

/** Manually controlled clock for tests. */
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
