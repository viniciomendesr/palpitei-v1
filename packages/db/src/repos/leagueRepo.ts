// Private league persistence. Callers provide identities verified by Privy.

import { randomInt } from 'node:crypto';
import type { Db, Executor, Row } from '../pool.js';
import type { League, LeagueMember, LeagueRole } from '../types.js';
import {
  InviteCodeInvalidError,
  LeagueLimitError,
  LeagueNameInvalidError,
  LeagueNotFoundError,
  LeagueNotOwnerError,
  UserNotFoundError,
  constraintName,
  isUniqueViolation,
} from '../errors.js';

/** Free users can create one league; joining does not consume the quota. */
export const LIGAS_FREE = 1;

/** Excludes visually ambiguous characters from invite codes. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TAM_CODIGO = 6;

/** Maximum invite-code collision retries. */
const TENTATIVAS_CODIGO = 5;

const COLS = `
  l.id, l.name, l.owner_id, l.invite_code,
  (select count(*) from league_members m2 where m2.league_id = l.id)::int as member_count,
  extract(epoch from l.created_at) * 1000 as created_ms
`;

function mapLeague(r: Row): League {
  return {
    id: String(r.id),
    name: String(r.name),
    ownerId: String(r.owner_id),
    inviteCode: String(r.invite_code),
    memberCount: Number(r.member_count),
    createdAt: Math.round(Number(r.created_ms)),
  };
}

/** Uses cryptographically secure, unbiased sampling for invitation credentials. */
function gerarCodigo(): string {
  let saida = '';
  for (let i = 0; i < TAM_CODIGO; i++) saida += ALFABETO[randomInt(ALFABETO.length)];
  return saida;
}

/** Normalizes user input without substituting ambiguous characters. */
export function normalizeLeagueCode(code: string): string {
  return String(code ?? '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
}

/** Validates names using the same constraints enforced by the database. */
export function validateLeagueName(nome: string): string {
  const limpo = String(nome ?? '').replace(/\s+/g, ' ').trim();
  if (limpo.length < 3 || limpo.length > 24) {
    throw new LeagueNameInvalidError('o nome da liga precisa ter de 3 a 24 caracteres');
  }
  // Inspect code points so all control characters are rejected.
  for (const ch of limpo) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c === 0x7f) {
      throw new LeagueNameInvalidError('o nome da liga tem caractere que não dá pra mostrar');
    }
  }
  return limpo;
}

export function createLeagueRepo(db: Db) {
  const repo = {
    async findById(id: string): Promise<League | null> {
      const rows = await db.query(`select ${COLS} from leagues l where l.id = $1`, [id]);
      return rows[0] ? mapLeague(rows[0]) : null;
    },

    /** A missing row deliberately hides whether the league exists. */
    async findForMember(id: string, userId: string): Promise<League | null> {
      const rows = await db.query(
        `select ${COLS}
           from leagues l
           join league_members acesso
             on acesso.league_id = l.id and acesso.user_id = $2
          where l.id = $1`,
        [id, userId]
      );
      return rows[0] ? mapLeague(rows[0]) : null;
    },

    /** Counts leagues owned by the user for free-tier enforcement. */
    async countOwned(userId: string): Promise<number> {
      const rows = await db.query(`select count(*)::int as n from leagues where owner_id = $1`, [
        userId,
      ]);
      return Number(rows[0]?.n ?? 0);
    },

    /** Returns a count without loading all memberships. */
    async countForUser(userId: string): Promise<number> {
      const rows = await db.query(
        `select count(*)::int as n from league_members where user_id = $1`,
        [userId]
      );
      return Number(rows[0]?.n ?? 0);
    },

    /** Lists every league the user belongs to, including invited leagues. */
    async listForUser(userId: string): Promise<(League & { iLead: boolean })[]> {
      const rows = await db.query(
        `select ${COLS}, m.role
           from league_members m
           join leagues l on l.id = m.league_id
          where m.user_id = $1
          order by m.joined_at, l.created_at`,
        [userId]
      );
      return rows.map((r) => ({ ...mapLeague(r), iLead: r.role === 'owner' }));
    },

    /**
     * Creates the league and its owner membership atomically.
     * Locking the owner row serializes free-tier quota checks.
     */
    async create(ownerId: string, name: string): Promise<League> {
      const nome = validateLeagueName(name);

      const id = await db.withTx(async (tx: Executor) => {
        const [dono] = await tx.query(`select is_premium from users where id = $1 for update`, [
          ownerId,
        ]);
        if (!dono) throw new UserNotFoundError(ownerId);

        if (!dono.is_premium) {
          const [c] = await tx.query(`select count(*)::int as n from leagues where owner_id = $1`, [
            ownerId,
          ]);
          if (Number(c?.n ?? 0) >= LIGAS_FREE) throw new LeagueLimitError();
        }

        // The unique constraint is authoritative; savepoints allow collision retries.
        for (let tentativa = 0; tentativa < TENTATIVAS_CODIGO; tentativa++) {
          await tx.query('savepoint liga_codigo');
          try {
            const [liga] = await tx.query(
              `insert into leagues (name, owner_id, invite_code)
               values ($1, $2, $3)
               returning id`,
              [nome, ownerId, gerarCodigo()]
            );
            if (!liga) throw new Error('[db] insert da liga não devolveu id');
            const novoId = String(liga.id);
            await tx.query(
              `insert into league_members (league_id, user_id, role) values ($1, $2, 'owner')`,
              [novoId, ownerId]
            );
            await tx.query('release savepoint liga_codigo');
            return novoId;
          } catch (e) {
            await tx.query('rollback to savepoint liga_codigo');
            // Retry only invitation-code collisions; surface every other failure.
            if (isUniqueViolation(e) && constraintName(e) === 'leagues_invite_code_key') continue;
            throw e;
          }
        }
        throw new Error('[db] não consegui gerar um código de convite único — tente de novo');
      });

      const liga = await repo.findById(id);
      if (!liga) throw new LeagueNotFoundError();
      return liga;
    },

    /** Joining by invitation is idempotent and does not consume the owner quota. */
    async joinByCode(userId: string, code: string): Promise<League> {
      const codigo = normalizeLeagueCode(code);
      const rows = await db.query(`select id from leagues where invite_code = $1`, [codigo]);
      if (!rows[0]) throw new InviteCodeInvalidError();

      const id = String(rows[0].id);
      await db.query(
        `insert into league_members (league_id, user_id) values ($1, $2)
         on conflict (league_id, user_id) do nothing`,
        [id, userId]
      );

      const liga = await repo.findById(id);
      if (!liga) throw new LeagueNotFoundError();
      return liga;
    },

    /**
     * Deletes only when ownership matches. The fallback error preserves league
     * existence privacy for non-members.
     */
    async delete(id: string, userId: string): Promise<void> {
      const rows = await db.query(`delete from leagues where id = $1 and owner_id = $2 returning id`, [
        id,
        userId,
      ]);
      if (rows[0]) return;
      if (await repo.isMember(id, userId)) throw new LeagueNotOwnerError();
      throw new LeagueNotFoundError();
    },

    /** Private leagues expose neither their name nor invitation to non-members. */
    async isMember(leagueId: string, userId: string): Promise<boolean> {
      const rows = await db.query(
        `select 1 from league_members where league_id = $1 and user_id = $2`,
        [leagueId, userId]
      );
      return rows.length > 0;
    },

    async listMembers(leagueId: string): Promise<LeagueMember[]> {
      const rows = await db.query(
        `select m.user_id, m.role, u.handle,
                extract(epoch from m.joined_at) * 1000 as joined_ms
           from league_members m
           join users u on u.id = m.user_id
          where m.league_id = $1
          order by (m.role = 'owner') desc, m.joined_at`,
        [leagueId]
      );
      return rows.map((r) => ({
        userId: String(r.user_id),
        handle: (r.handle as string | null) ?? null,
        role: r.role as LeagueRole,
        joinedAt: Math.round(Number(r.joined_ms)),
      }));
    },
  };

  return repo;
}

export type LeagueRepo = ReturnType<typeof createLeagueRepo>;
