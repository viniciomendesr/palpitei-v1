/** Shared match-event filter. Counter-based actions are emitted only when their feed total changes. */

import type { ScoreEvent } from '@palpitei/core';

/** Only these TxLINE actions become visible match events. */
export const MATCH_ACTIONS = new Set([
  'kickoff',
  'goal',
  'yellow_card',
  'red_card',
  'corner',
  'shot',
  'substitution',
  'injury',
  'additional_time',
  'halftime_finalised',
  'game_finalised',
]);

/** Maps counter-based actions to feed totals. Do not add keys that the feed does not provide. */
const CONTADORES: Record<string, string> = {
  corner: 'Corners',
  yellow_card: 'YellowCards',
  red_card: 'RedCards',
};

export type MatchEventFilter = (event: ScoreEvent, scoreChanged: boolean) => boolean;

/** Returns true for duplicate kickoff events at the same feed clock. Live mode must remove them before the question engine sees them. */
export function createKickoffDeduper(): (event: ScoreEvent) => boolean {
  const vistos = new Set<string>();
  return (ev) => {
    if (ev.action !== 'kickoff') return false;
    const id = `${ev.action}:${ev.clockSeconds ?? ev.ts}`;
    if (vistos.has(id)) return true;
    vistos.add(id);
    return false;
  };
}

/** Creates a stateful per-match event filter. */
export function createMatchEventFilter(): MatchEventFilter {
  const contado: Record<string, { p1: number; p2: number }> = {};
  const vistos = new Set<string>();

  return (ev, mudouPlacar) => {
    if (!MATCH_ACTIONS.has(ev.action)) return false;

    if (ev.action === 'goal') {
      // Goal actions without a score delta are VAR or amendment events.
      return mudouPlacar;
    }

    const chave = CONTADORES[ev.action];
    if (chave) {
      // Wait for score data; announcements can arrive before the total changes.
      if (!ev.hasScore) return false;
      const agora = {
        // A missing key within an existing total is zero; missing score data is different.
        p1: ev.totals?.p1?.[chave] ?? 0,
        p2: ev.totals?.p2?.[chave] ?? 0,
      };
      // Start counters at zero so the first event is not treated as calibration.
      const antes = contado[chave] ?? { p1: 0, p2: 0 };
      contado[chave] = agora;
      return agora.p1 !== antes.p1 || agora.p2 !== antes.p2;
    }

    // Non-counter actions dedupe by feed clock.
    const id = `${ev.action}:${ev.clockSeconds ?? ev.ts}`;
    if (vistos.has(id)) return false;
    vistos.add(id);
    return true;
  };
}
