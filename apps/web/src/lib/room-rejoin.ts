/**
 * What to do when the lobby stream refuses the connection — pure predicate, testable
 * without a DOM.
 *
 * A fan who leaves during a live match gets `left_at` stamped, and `findForMember`
 * filters that row out: coming back to `/sala/<id>?party=CODE` then 403s forever. The
 * server now accepts a rejoin into a `started` lobby, so the client has to ask for it
 * once instead of retrying a verdict that will never change on its own.
 *
 * The failure mode being fixed is silence: an unbounded backoff over a permanent 403 is
 * a frozen screen with no message. Anything that is not a rejoin worth trying must end
 * in `desistir`, which is what puts an error in front of the fan.
 */

export type RejoinAction = 'reconnect' | 'rejoin' | 'giveUp';

export interface RejoinContext {
  /** HTTP status of the refusal; `null` when the failure carried none (EventSource). */
  status: number | null;
  /** A rejoin needs a room to rejoin into. */
  hasParty: boolean;
  privyAuthenticated: boolean;
  /** Rejoins already attempted for this connection. */
  tentativas: number;
}

/** One attempt. A second would only repeat a server verdict that did not change. */
export const MAX_REJOIN_ATTEMPTS = 1;

/** Statuses that mean "you are not in this lobby", not "the network hiccuped". */
function isAccessVerdict(status: number | null): boolean {
  return status === 403 || status === 404;
}

export function rejoinAction({
  status,
  hasParty,
  privyAuthenticated,
  tentativas,
}: RejoinContext): RejoinAction {
  // Only an access verdict justifies a rejoin. A dropped connection, a 500 or a 401
  // are transient by nature, and the existing capped backoff already handles them —
  // turning them into a rejoin would spend the single attempt on a network blip.
  if (!isAccessVerdict(status)) return 'reconnect';

  // Privy fails late, not loud (CONTEXT §11): the island may still be booting, and the
  // join would fail with 401 anyway. Keep reconnecting instead of burning an attempt.
  if (!privyAuthenticated) return 'reconnect';

  // No invite code means there is no room to rejoin: retrying is guaranteed silence.
  if (!hasParty) return 'giveUp';

  if (tentativas >= MAX_REJOIN_ATTEMPTS) return 'giveUp';
  return 'rejoin';
}
