/** Persistent membership authorizes room access; process-local lobby presence does not. */

import type { Lobby } from '@palpitei/db';

export type RoomScope = { fixtureId: number; training: boolean };
type PersistedLobby = Pick<Lobby, 'fixtureId' | 'treino' | 'phase' | 'expiresAt'>;

/**
 * Requires active membership in a running OR finished lobby for the same fixture.
 *
 * `finished` has to pass. At full time `finalizarSala` flips the persisted phase,
 * and requiring `started` meant the whistle itself revoked access: a fan whose tab
 * had dropped got 403 forever and never saw the result screen or the room ranking —
 * the end of the loop. Placing a late prediction is not a risk here, the engine
 * rejects anything whose question is not `open`. Restarting still requires a NEW
 * party: this only reopens reading, never re-running a finished one.
 */
export function canAccessStartedLobby(
  lobby: PersistedLobby | null,
  room: RoomScope,
  now = Date.now(),
): boolean {
  return Boolean(
    lobby &&
      lobby.fixtureId === room.fixtureId &&
      lobby.treino === room.training &&
      (lobby.phase === 'started' || lobby.phase === 'finished') &&
      lobby.expiresAt > now,
  );
}

/**
 * Same phase rule for the process-local lobby that gates the room routes.
 *
 * It has to accept exactly what `canAccessStartedLobby` accepts. The in-memory
 * lobby is rehydrated from Postgres by `openLobby`, so once a room is reconciled
 * to `finished` a `started`-only gate would answer 409 right after the Postgres
 * gate answered "you may enter" — the fan bounces off their own room forever.
 */
export function inMemoryLobbyAllowsRoom(phase: Lobby['phase'] | undefined | null): boolean {
  return phase === 'started' || phase === 'finished';
}
