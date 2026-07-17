/**
 * Lobby efêmero por grupo. O estado autoritativo continua no servidor: presença,
 * pronto e início chegam a todos por SSE antes de o runner da partida existir.
 */

export type LobbyMeta = {
  key: string;
  roomId: string;
  partyId: string;
  fixtureId: number;
  treino: boolean;
  teamA: string;
  teamB: string;
};

type Member = { userId: string; name: string; ready: boolean; connections: number };
type Subscriber = { userId: string; send: (state: LobbyState) => void };

export type LobbyState = {
  type: 'lobby_state';
  roomId: string;
  partyId: string;
  fixtureId: number;
  treino: boolean;
  teamA: string;
  teamB: string;
  phase: 'waiting' | 'started';
  meReady: boolean;
  meHost: boolean;
  players: { name: string; ready: boolean; host: boolean }[];
};

export type Lobby = LobbyMeta & {
  phase: 'waiting' | 'started';
  hostId: string | null;
  members: Map<string, Member>;
  subscribers: Set<Subscriber>;
};

const KEY = '__palpitei_lobbies__' as const;
type GlobalWithLobbies = typeof globalThis & { [KEY]?: Map<string, Lobby> };
const all = (): Map<string, Lobby> => ((globalThis as GlobalWithLobbies)[KEY] ??= new Map());

export function openLobby(meta: LobbyMeta): Lobby {
  const found = all().get(meta.key);
  if (found) return found;
  const lobby: Lobby = {
    ...meta,
    phase: 'waiting',
    hostId: null,
    members: new Map(),
    subscribers: new Set(),
  };
  all().set(meta.key, lobby);
  return lobby;
}

export function getLobby(key: string): Lobby | null {
  return all().get(key) ?? null;
}

export function stateFor(lobby: Lobby, userId: string): LobbyState {
  const me = lobby.members.get(userId);
  return {
    type: 'lobby_state',
    roomId: lobby.roomId,
    partyId: lobby.partyId,
    fixtureId: lobby.fixtureId,
    treino: lobby.treino,
    teamA: lobby.teamA,
    teamB: lobby.teamB,
    phase: lobby.phase,
    meReady: me?.ready ?? false,
    meHost: lobby.hostId === userId,
    players: [...lobby.members.values()].map((member) => ({
      name: member.name,
      ready: member.ready,
      host: lobby.hostId === member.userId,
    })),
  };
}

function broadcast(lobby: Lobby): void {
  for (const sub of lobby.subscribers) {
    try {
      sub.send(stateFor(lobby, sub.userId));
    } catch {
      // Uma conexão encerrada não impede as outras de receber o lobby.
    }
  }
}

export function connectLobby(
  lobby: Lobby,
  user: { id: string; name: string },
  send: (state: LobbyState) => void,
): () => void {
  const current = lobby.members.get(user.id);
  if (current) {
    current.connections++;
    if (user.name) current.name = user.name;
  } else {
    lobby.members.set(user.id, {
      userId: user.id,
      name: user.name,
      ready: lobby.phase === 'started',
      connections: 1,
    });
  }
  if (!lobby.hostId) lobby.hostId = user.id;
  const sub: Subscriber = { userId: user.id, send };
  lobby.subscribers.add(sub);
  broadcast(lobby);

  return () => {
    lobby.subscribers.delete(sub);
    const member = lobby.members.get(user.id);
    if (member) {
      member.connections--;
      if (member.connections <= 0 && lobby.phase === 'waiting') lobby.members.delete(user.id);
    }
    if (lobby.phase === 'waiting' && lobby.hostId === user.id && !lobby.members.has(user.id)) {
      lobby.hostId = lobby.members.keys().next().value ?? null;
    }
    if (lobby.phase === 'waiting' && lobby.members.size === 0) all().delete(lobby.key);
    else broadcast(lobby);
  };
}

export function setReady(lobby: Lobby, userId: string, ready: boolean): boolean {
  if (lobby.phase !== 'waiting') return false;
  const member = lobby.members.get(userId);
  if (!member) return false;
  member.ready = ready;
  broadcast(lobby);
  return true;
}

export function startLobby(lobby: Lobby, userId: string): { ok: boolean; error?: string } {
  if (lobby.phase === 'started') return { ok: true };
  if (lobby.hostId !== userId) return { ok: false, error: 'só o anfitrião pode iniciar' };
  if (lobby.members.size === 0 || [...lobby.members.values()].some((m) => !m.ready)) {
    return { ok: false, error: 'espere todos ficarem prontos' };
  }
  lobby.phase = 'started';
  broadcast(lobby);
  return { ok: true };
}

/** A execução acabou e ficou vazia: o próximo grupo volta a passar pelo lobby. */
export function resetLobby(key: string): void {
  all().delete(key);
}
