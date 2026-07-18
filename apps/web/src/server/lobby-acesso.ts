/**
 * A associação persistida é a autoridade para entrar na sala. O Map em
 * `server/lobbies.ts` só guarda presença e broadcast do processo: ele não prova
 * que quem conhece o código do grupo participou do convite, nem sobrevive a um
 * restart. Esta checagem é compartilhada pelas rotas de stream e palpite para
 * que as duas portas apliquem exatamente a mesma regra.
 */

import type { Lobby } from '@palpitei/db';

type EscopoDaSala = { fixtureId: number; treino: boolean };
type LobbyPersistido = Pick<Lobby, 'fixtureId' | 'treino' | 'phase' | 'expiresAt'>;

/**
 * Só o membro ativo de um convite ainda válido, da mesma partida/modo e já
 * iniciado pode acompanhar ou palpitar. `null` é tanto desconhecido quanto
 * ex-membro: `findForMember` já exclui vínculos com `left_at` preenchido.
 */
export function podeAcessarLobbyIniciado(
  lobby: LobbyPersistido | null,
  sala: EscopoDaSala,
  agora = Date.now(),
): boolean {
  return Boolean(
    lobby &&
      lobby.fixtureId === sala.fixtureId &&
      lobby.treino === sala.treino &&
      lobby.phase === 'started' &&
      lobby.expiresAt > agora,
  );
}
