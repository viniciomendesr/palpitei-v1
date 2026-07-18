import { randomInt } from 'node:crypto';
import type { Db, Executor, Row } from '../pool.js';
import type { Lobby } from '../types.js';
import {
  LobbyNotFoundError,
  LobbyUnavailableError,
  UserNotFoundError,
  constraintName,
  isUniqueViolation,
} from '../errors.js';

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TAMANHO = 6;
const TENTATIVAS = 5;

const COLUNAS = `
  l.id, l.invite_code, l.fixture_id, l.treino, l.host_user_id, l.phase,
  l.max_players, extract(epoch from l.expires_at) * 1000 as expires_ms,
  extract(epoch from l.created_at) * 1000 as created_ms,
  (select count(*) from lobby_members lm where lm.lobby_id = l.id and lm.left_at is null)::int as member_count
`;

function mapLobby(row: Row): Lobby {
  return {
    id: String(row.id),
    inviteCode: String(row.invite_code),
    fixtureId: Number(row.fixture_id),
    treino: Boolean(row.treino),
    hostUserId: String(row.host_user_id),
    phase: row.phase as Lobby['phase'],
    maxPlayers: Number(row.max_players),
    memberCount: Number(row.member_count),
    expiresAt: Math.round(Number(row.expires_ms)),
    createdAt: Math.round(Number(row.created_ms)),
  };
}

function gerarCodigo(): string {
  let codigo = '';
  for (let i = 0; i < TAMANHO; i++) codigo += ALFABETO[randomInt(ALFABETO.length)];
  return codigo;
}

export function normalizeLobbyCode(value: string): string {
  return String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
}

export function createLobbyRepo(db: Db) {
  const repo = {
    async findByCode(code: string): Promise<Lobby | null> {
      const normalized = normalizeLobbyCode(code);
      const rows = await db.query(`select ${COLUNAS} from lobbies l where l.invite_code = $1`, [normalized]);
      return rows[0] ? mapLobby(rows[0]) : null;
    },

    async findForMember(code: string, userId: string): Promise<Lobby | null> {
      const normalized = normalizeLobbyCode(code);
      const rows = await db.query(
        `select ${COLUNAS}
           from lobbies l
           join lobby_members acesso on acesso.lobby_id = l.id and acesso.user_id = $2 and acesso.left_at is null
          where l.invite_code = $1`,
        [normalized, userId],
      );
      return rows[0] ? mapLobby(rows[0]) : null;
    },

    async create(hostUserId: string, fixtureId: number, treino: boolean): Promise<Lobby> {
      const id = await db.withTx(async (tx: Executor) => {
        const [user] = await tx.query('select id from users where id = $1', [hostUserId]);
        if (!user) throw new UserNotFoundError(hostUserId);

        for (let attempt = 0; attempt < TENTATIVAS; attempt++) {
          await tx.query('savepoint lobby_codigo');
          try {
            const [created] = await tx.query(
              `insert into lobbies (invite_code, fixture_id, treino, host_user_id)
               values ($1, $2, $3, $4) returning id`,
              [gerarCodigo(), fixtureId, treino, hostUserId],
            );
            if (!created) throw new Error('[db] insert do lobby não devolveu id');
            const lobbyId = String(created.id);
            await tx.query(
              `insert into lobby_members (lobby_id, user_id, role)
               values ($1, $2, 'host')`,
              [lobbyId, hostUserId],
            );
            await tx.query('release savepoint lobby_codigo');
            return lobbyId;
          } catch (error) {
            await tx.query('rollback to savepoint lobby_codigo');
            if (isUniqueViolation(error) && constraintName(error) === 'lobbies_invite_code_key') continue;
            throw error;
          }
        }
        throw new Error('[db] não consegui gerar um código de lobby único');
      });

      const rows = await db.query(`select ${COLUNAS} from lobbies l where l.id = $1`, [id]);
      if (!rows[0]) throw new LobbyNotFoundError();
      return mapLobby(rows[0]);
    },

    async joinByCode(userId: string, code: string): Promise<Lobby> {
      const normalized = normalizeLobbyCode(code);
      const id = await db.withTx(async (tx: Executor) => {
        const [lobby] = await tx.query(
          `select id, phase, max_players, expires_at from lobbies
            where invite_code = $1 for update`,
          [normalized],
        );
        if (!lobby) throw new LobbyNotFoundError();
        if (lobby.phase !== 'waiting') throw new LobbyUnavailableError('a partida desse lobby já começou');
        if (new Date(String(lobby.expires_at)).getTime() <= Date.now()) {
          throw new LobbyUnavailableError('esse convite expirou — pede um novo ao anfitrião');
        }
        const [membership] = await tx.query(
          `select left_at from lobby_members where lobby_id = $1 and user_id = $2`,
          [lobby.id, userId],
        );
        if (!membership) {
          const [count] = await tx.query(
            `select count(*)::int as n from lobby_members where lobby_id = $1 and left_at is null`,
            [lobby.id],
          );
          if (Number(count?.n ?? 0) >= Number(lobby.max_players)) {
            throw new LobbyUnavailableError('esse lobby está cheio');
          }
          await tx.query(
            `insert into lobby_members (lobby_id, user_id) values ($1, $2)`,
            [lobby.id, userId],
          );
        } else {
          await tx.query(
            `update lobby_members
                set last_seen_at = now(), left_at = null, ready = false
              where lobby_id = $1 and user_id = $2`,
            [lobby.id, userId],
          );
        }
        return String(lobby.id);
      });

      const rows = await db.query(`select ${COLUNAS} from lobbies l where l.id = $1`, [id]);
      if (!rows[0]) throw new LobbyNotFoundError();
      return mapLobby(rows[0]);
    },

    async markStarted(code: string, hostUserId: string): Promise<void> {
      const normalized = normalizeLobbyCode(code);
      const rows = await db.query(
        `update lobbies
            set phase = 'started', updated_at = now()
          where invite_code = $1 and host_user_id = $2 and phase in ('waiting', 'started')
          returning id`,
        [normalized, hostUserId],
      );
      if (!rows[0]) throw new LobbyUnavailableError('só o anfitrião pode começar esse lobby');
    },

    async markLeft(code: string, userId: string): Promise<void> {
      const normalized = normalizeLobbyCode(code);
      const rows = await db.query(
        `update lobby_members lm
            set left_at = now(), ready = false, last_seen_at = now()
           from lobbies l
          where l.id = lm.lobby_id and l.invite_code = $1 and lm.user_id = $2
                and lm.left_at is null
          returning lm.user_id`,
        [normalized, userId],
      );
      if (!rows[0]) throw new LobbyUnavailableError('você já saiu desse lobby');
    },

    async markFinished(code: string, hostUserId: string): Promise<void> {
      const normalized = normalizeLobbyCode(code);
      const rows = await db.query(
        `update lobbies
            set phase = 'finished', updated_at = now()
          where invite_code = $1 and host_user_id = $2 and phase in ('started', 'finished')
          returning id`,
        [normalized, hostUserId],
      );
      if (!rows[0]) throw new LobbyUnavailableError('só o anfitrião pode encerrar essa partida');
    },

    /** Authoritative runner shutdown; not an action exposed to fans. */
    async markFinishedBySystem(code: string): Promise<void> {
      const normalized = normalizeLobbyCode(code);
      await db.query(
        `update lobbies
            set phase = 'finished', updated_at = now()
          where invite_code = $1 and phase in ('started', 'finished')`,
        [normalized],
      );
    },
  };
  return repo;
}

export type LobbyRepo = ReturnType<typeof createLobbyRepo>;
