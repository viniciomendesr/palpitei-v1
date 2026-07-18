/** Parses ranked and training room IDs consistently across lobby, stream, and prediction routes. */
export type RoomIdentity = { fixtureId: number; training: boolean };

export function parseRoomId(id: string): RoomIdentity | null {
  const match = /^(treino-)?(\d+)$/.exec(id);
  if (!match) return null;
  return { fixtureId: Number(match[2]), training: Boolean(match[1]) };
}

/** Only the explicit `treino-*` route disables XP and persistence. */
export function roomPolicy(training: boolean): { paysXp: boolean; persists: boolean } {
  return training
    ? { paysXp: false, persists: false }
    : { paysXp: true, persists: true };
}

/** URL-safe code that identifies a group within a fixture. */
export function parsePartyId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{6,12}$/.test(normalized) ? normalized : null;
}

/** Separate invitations for a fixture never share a runner or score. */
export const roomKey = (fixtureId: number, training: boolean, partyId = 'PUBLIC'): string =>
  `${training ? `treino-${fixtureId}` : String(fixtureId)}:${partyId}`;
