/**
 * Who may join a lobby from an invite link — pure predicate, testable without a DOM.
 *
 * Privy is the authority (`ready && authenticated`), as in `usePalpitePreJogo`: the
 * join authenticates with its Bearer and the server derives identity from the
 * verified `privy_did`. The local session lives in `sessionStorage` (per tab), so it
 * arrives `null` in the fresh tab a link opens — it is display cache, never authority.
 */

import type { AuthMethod } from './session';

export type ConviteAcao = 'loading' | 'join' | 'login';

export interface ConviteContexto {
  /** False until the first effect reads `sessionStorage`. */
  hydrated: boolean;
  privyReady: boolean;
  privyAuthenticated: boolean;
  /** Display cache only; kept in the signature to document that it does NOT decide. */
  authMethod: AuthMethod | null;
}

export function acaoDoConvite({
  hydrated,
  privyReady,
  privyAuthenticated,
}: ConviteContexto): ConviteAcao {
  // Without both, an authenticated fan still looks logged out: the button loads
  // instead of lying "log in to join" and bouncing someone who already has an account.
  if (!hydrated || !privyReady) return 'loading';
  if (privyAuthenticated) return 'join';
  // Including `authMethod === 'demo'`: a lobby is ranked, so it needs a real account (rule 3).
  return 'login';
}
