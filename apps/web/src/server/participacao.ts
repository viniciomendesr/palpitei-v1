/**
 * Which run counts as the fan's participation in a fixture: pure decision, so
 * the rule is unit-testable without a database.
 *
 * The rule the owner wants is "only the FIRST participation counts", and it has
 * two halves that a single `order by` cannot express safely:
 *
 *  1. LIVE WINS. If the fan played live, that is their record, even if they
 *     replayed the same match earlier in wall-clock terms — which is not
 *     hypothetical, because a fan can replay an OLD fixture and then play a
 *     later one live. Live is the stronger claim, so it is checked first.
 *  2. AMONG EQUALS, EARLIEST WINS, BY REAL CLOCK. Later replays never overwrite
 *     the first one.
 *
 * The clock here must be the real one. `predictions.placed_at` is match time and
 * a replay reproduces it faithfully, so a replay of a finished match yields
 * predictions that LOOK like they happened during the match. `firstAt` is built
 * from `predictions.created_at` for exactly this reason (participationRepo).
 */

import type { ParticipationRun } from '@palpitei/db';

/**
 * Returns the run that is the fan's record for the fixture, or `null` when they
 * never played it.
 */
export function pickFirstParticipation(runs: readonly ParticipationRun[]): ParticipationRun | null {
  if (runs.length === 0) return null;
  const live = runs.filter((run) => run.live);
  const elegiveis = live.length > 0 ? live : runs;
  return elegiveis.reduce((melhor, run) => (run.firstAt < melhor.firstAt ? run : melhor));
}
