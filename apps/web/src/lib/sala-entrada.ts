/**
 * Real room (a lobby over TxLINE data) vs. demo room — pure predicate.
 *
 * "No local session" is NOT demo: the session lives in `sessionStorage` (per tab) and
 * arrives `null` in the tab the invite opened. Treating that as demo renders the mock,
 * which calls `useRequireSession()` and sends the fan back to login. Privy is the
 * authority.
 */

import type { AuthMethod } from './session';

export type SalaEntrada = 'loading' | 'lobby' | 'mock';

export interface SalaContexto {
  roomId: string;
  hydrated: boolean;
  privyReady: boolean;
  privyAuthenticated: boolean;
  authMethod: AuthMethod | null;
}

/** Real room ids: a TxLINE fixture, with the optional training prefix. */
const ID_DE_SALA_REAL = /^(treino-)?\d+$/;

export function entradaDaSala({
  roomId,
  hydrated,
  privyReady,
  privyAuthenticated,
  authMethod,
}: SalaContexto): SalaEntrada {
  if (!hydrated) return 'loading';

  // Rule 3: the judge's path must not depend on the network. Demo decides BEFORE
  // looking at `privyReady` — a Privy that never readies (E7) must not freeze the screen.
  if (authMethod === 'demo') return 'mock';

  // Nobody decides before Privy is ready: the mock redirects itself to /home on its
  // first effect, so rendering it by mistake is a one-way door.
  if (!privyReady) return 'loading';

  const contaReal = privyAuthenticated || authMethod === 'google' || authMethod === 'wallet';
  return contaReal && ID_DE_SALA_REAL.test(roomId) ? 'lobby' : 'mock';
}
