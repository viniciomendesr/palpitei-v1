/**
 * O id da sala na URL: `18241006` (valendo) ou `treino-18241006` (treino).
 * Qualquer outra coisa é inválida — e a MESMA regra vale para lobby, stream e
 * palpite, senão cada rota poderia abrir uma sala diferente.
 */
export function parseRoomId(id: string): { fixtureId: number; treino: boolean } | null {
  const match = /^(treino-)?(\d+)$/.exec(id);
  if (!match) return null;
  return { fixtureId: Number(match[2]), treino: Boolean(match[1]) };
}

/** Código curto e seguro para URL que identifica um grupo dentro da fixture. */
export function parsePartyId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{6,12}$/.test(normalized) ? normalized : null;
}

/** Dois convites da mesma partida nunca compartilham runner ou placar. */
export const chaveDaSala = (fixtureId: number, treino: boolean, partyId = 'PUBLIC'): string =>
  `${treino ? `treino-${fixtureId}` : String(fixtureId)}:${partyId}`;
