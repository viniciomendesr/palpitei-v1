/**
 * Provenance of what a room is showing — pure predicate, testable without a DOM.
 *
 * Rule 4 / G6: a label that lies about where the data came from is disqualifying. The
 * room's `source` is written by `rooms.ts` as the literal `'txline-live'` for a live
 * fixture, and otherwise as the match's `cacheSource` — a free-form string read from
 * Postgres. So "not a replay" can never be read as "live": only the declared live
 * source counts, and anything unknown, empty or absent degrades to replay.
 */

export const FONTE_AO_VIVO = 'txline-live';

export function ehAoVivo(source: string | null | undefined): boolean {
  return source === FONTE_AO_VIVO;
}
