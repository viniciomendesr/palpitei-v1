/** Persistent membership authorizes room access; process-local lobby presence does not. */

import type { Lobby } from '@palpitei/db';

export type RoomScope = { fixtureId: number; training: boolean };
type PersistedLobby = Pick<Lobby, 'fixtureId' | 'treino' | 'phase' | 'expiresAt'>;

/** Requires active membership in the started lobby for the same fixture and mode. */
export function canAccessStartedLobby(
  lobby: PersistedLobby | null,
  room: RoomScope,
  now = Date.now(),
): boolean {
  return Boolean(
    lobby &&
      lobby.fixtureId === room.fixtureId &&
      lobby.treino === room.training &&
      lobby.phase === 'started' &&
      lobby.expiresAt > now,
  );
}
