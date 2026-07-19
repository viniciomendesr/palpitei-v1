/** Pure decision for the debut trophy, so the reasoning is unit-testable. */

import type { RoomMode } from './room-mode';

export type DebutTrophyContext = {
  /** How the room was built. Only a genuinely live room can be a debut. */
  roomMode: RoomMode;
  /** Training rooms neither persist nor pay; they cannot mark a debut either. */
  training: boolean;
  /** The verified privy_did. Demo accounts live in the `demo:` namespace. */
  privyDid: string | undefined;
};

/**
 * Decides whether placing a prediction right now marks the fan's live debut.
 *
 * THE SUBTLETY THIS EXISTS FOR: being live is not the same as having events.
 *
 * A recorded match has a full timeline, so any rule shaped like "this fixture
 * has events" hands a debut trophy to whoever opens a replay and predicts on a
 * match played days ago. Evaluating it after the fact is worse: a fixture that
 * was live yesterday is `state = 'finished'` today, so the current state answers
 * the question wrong in BOTH directions.
 *
 * So decide at the moment of the prediction, using the same authority that
 * decides `live_fixtures`. `roomMode === 'live'` is exactly that authority: it
 * is set from `garantirCanalAoVivo`, which only returns true for a fixture the
 * operator activated through `podeAtivarFixtureAoVivo`. A replay room is
 * `replay`, and a match that already ended for this party is `finished` —
 * neither is a debut.
 */
export function canAwardDebutTrophy(ctx: DebutTrophyContext): boolean {
  // The operator's LIVE_FIXTURE_IDS decides, never anything the fan does on screen.
  if (ctx.roomMode !== 'live') return false;
  if (ctx.training) return false;
  // Demo is excluded by construction, and this is the second lock: the route
  // already requires a verified Privy token. An ABSENT did is not permission
  // either — same doctrine as `podeAtivarFixtureAoVivo`: absent != authorized.
  if (!ctx.privyDid || ctx.privyDid.startsWith('demo:')) return false;
  return true;
}
