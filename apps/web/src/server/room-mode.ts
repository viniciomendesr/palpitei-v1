/** How a room must be built: pure decision, so the reasoning is unit-testable. */

export type RoomMode = 'live' | 'replay' | 'finished';

export type RoomModeContext = {
  /** `matches.state` as persisted; unknown is not a verdict. */
  matchState: string | null | undefined;
  /** The fixture still has an active local live channel. */
  liveChannel: boolean;
  /** This party already has a persisted `game_sessions` run for this fixture. */
  hasPartySession: boolean;
};

/**
 * `finished` exists because a finished match plus a party that already played
 * is not a replay. Without it, a room orphaned by a restart came back as a fresh
 * `ReplayRunner` over the persisted timeline: the fan who reopened the link
 * watched the match restart at 0-0, on XP-bearing ports, creating new questions
 * for a match that was already over.
 *
 * A finished match with NO session for this party stays `replay` on purpose:
 * that is exactly how a recorded match is played, and narrowing it would take
 * the whole replay path down.
 */
export function roomMode(ctx: RoomModeContext): RoomMode {
  // While the channel is up it is the authority: `matches.state` flips to
  // 'finished' inside the terminal event's write queue, before the channel drops.
  if (ctx.liveChannel) return 'live';
  if (ctx.matchState === 'finished' && ctx.hasPartySession) return 'finished';
  return 'replay';
}
