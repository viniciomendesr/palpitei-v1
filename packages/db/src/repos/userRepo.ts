/** User identity persistence. Callers must provide a Privy-verified DID. */

import type { Db, Executor, Row } from '../pool.js';
import type { User, WalletSource } from '../types.js';
import { HandleInvalidError, HandleTakenError, UserNotFoundError, isUniqueViolation } from '../errors.js';

const COLS = `
  u.id, u.privy_did, u.handle, u.wallet_pubkey, u.wallet_source,
  u.is_premium, u.xp, u.level, u.current_streak, u.best_streak, u.balance_cents,
  extract(epoch from u.created_at) * 1000 as created_ms,
  coalesce(
    (select array_agg(w.pubkey order by w.linked_at)
       from user_wallets w
      where w.user_id = u.id and w.pubkey is distinct from u.wallet_pubkey),
    array[]::text[]
  ) as linked_wallets
`;

function mapUser(r: Row): User {
  return {
    id: String(r.id),
    handle: (r.handle as string | null) ?? null,
    wallet: (r.wallet_pubkey as string | null) ?? null,
    // Preserve null when Privy has not provided a Solana wallet.
    walletSource: (r.wallet_source as WalletSource | null) ?? null,
    privyId: String(r.privy_did),
    isPremium: Boolean(r.is_premium),
    xp: Number(r.xp),
    level: Number(r.level),
    currentStreak: Number(r.current_streak),
    bestStreak: Number(r.best_streak),
    balanceCents: Number(r.balance_cents),
    linkedWallets: (r.linked_wallets as string[] | null) ?? [],
    createdAt: Math.round(Number(r.created_ms)),
  };
}

/** Validates public handles used in rankings and leagues. */
export function validateHandle(handle: string): string {
  const limpo = handle.trim();
  if (limpo.length < 3 || limpo.length > 20) {
    throw new HandleInvalidError('o apelido precisa ter de 3 a 20 caracteres');
  }
  if (!/^[\p{L}\p{N}._-]+$/u.test(limpo)) {
    throw new HandleInvalidError('o apelido aceita letras, números, ponto, hífen e underline');
  }
  if (limpo.includes('@')) {
    throw new HandleInvalidError('nada de e-mail no apelido — ele aparece no ranking pra todo mundo');
  }
  return limpo;
}

export type FindOrCreateOpts = {
  wallet?: string | null;
  walletSource?: WalletSource | null;
};

export function createUserRepo(db: Db) {
  const repo = {
    async findById(id: string): Promise<User | null> {
      const rows = await db.query(`select ${COLS} from users u where u.id = $1`, [id]);
      return rows[0] ? mapUser(rows[0]) : null;
    },

    async findByPrivyDid(did: string): Promise<User | null> {
      const rows = await db.query(`select ${COLS} from users u where u.privy_did = $1`, [did]);
      return rows[0] ? mapUser(rows[0]) : null;
    },

    async findByHandle(handle: string): Promise<User | null> {
      const rows = await db.query(`select ${COLS} from users u where lower(u.handle) = lower($1)`, [
        handle,
      ]);
      return rows[0] ? mapUser(rows[0]) : null;
    },

    /** Creates the user or updates wallet data without overwriting it with null. */
    async findOrCreateByPrivyDid(did: string, opts: FindOrCreateOpts = {}): Promise<User> {
      const didLimpo = String(did ?? '').trim();
      if (!didLimpo) throw new Error('[db] privy_did vazio — identidade sem DID não existe');

      const wallet = opts.wallet ?? null;
      const source = wallet ? opts.walletSource ?? null : null;

      const rows = await db.query(
        `
        insert into users (privy_did, wallet_pubkey, wallet_source)
        values ($1, $2, $3)
        on conflict (privy_did) do update set
          wallet_pubkey = coalesce(excluded.wallet_pubkey, users.wallet_pubkey),
          wallet_source = coalesce(excluded.wallet_source, users.wallet_source),
          updated_at    = now()
        returning id
        `,
        [didLimpo, wallet, source]
      );

      const id = String(rows[0]?.id);
      if (wallet && source) await repo.linkWallet(id, wallet, source, { primary: true });

      const user = await repo.findById(id);
      if (!user) throw new UserNotFoundError(id);
      return user;
    },

    /** Sets a public handle; the database unique constraint resolves races. */
    async setHandle(userId: string, handle: string): Promise<User> {
      const limpo = validateHandle(handle);
      try {
        const rows = await db.query(
          `update users set handle = $2, updated_at = now() where id = $1 returning id`,
          [userId, limpo]
        );
        if (!rows[0]) throw new UserNotFoundError(userId);
      } catch (e) {
        if (isUniqueViolation(e)) throw new HandleTakenError(limpo);
        throw e;
      }
      const user = await repo.findById(userId);
      if (!user) throw new UserNotFoundError(userId);
      return user;
    },

    async setPremium(userId: string, premium: boolean): Promise<User> {
      await db.query(`update users set is_premium = $2, updated_at = now() where id = $1`, [
        userId,
        premium,
      ]);
      const user = await repo.findById(userId);
      if (!user) throw new UserNotFoundError(userId);
      return user;
    },

    /**
     * Adds ad-hoc XP. Use predictionRepo.settle for prediction XP because it is
     * idempotent; the generated database column derives the user's level.
     */
    async addXp(userId: string, amount: number): Promise<User> {
      if (!Number.isFinite(amount)) throw new Error('[db] addXp: valor inválido');
      const delta = Math.trunc(amount);
      const rows = await db.query(
        `update users
            set xp = greatest(0, xp + $2), updated_at = now()
          where id = $1
          returning id`,
        [userId, delta]
      );
      if (!rows[0]) throw new UserNotFoundError(userId);
      const user = await repo.findById(userId);
      if (!user) throw new UserNotFoundError(userId);
      return user;
    },

    /** Links a wallet using `(user_id, pubkey, source)` to retain provenance. */
    async linkWallet(
      userId: string,
      pubkey: string,
      source: WalletSource,
      opts: { primary?: boolean } = {}
    ): Promise<void> {
      if (!pubkey) return;
      await db.query(
        `
        insert into user_wallets (user_id, pubkey, source, is_primary)
        values ($1, $2, $3, $4)
        on conflict (user_id, pubkey, source) do update set is_primary = excluded.is_primary or user_wallets.is_primary
        `,
        [userId, pubkey, source, opts.primary ?? false]
      );
    },

    /** Adds wallets reported by Privy without deleting historical links. */
    async syncWallets(
      userId: string,
      wallets: { pubkey: string; source: WalletSource }[]
    ): Promise<void> {
      for (const w of wallets) await repo.linkWallet(userId, w.pubkey, w.source);
    },

    async listWallets(userId: string): Promise<{ pubkey: string; source: WalletSource; isPrimary: boolean }[]> {
      const rows = await db.query(
        `select pubkey, source, is_primary from user_wallets where user_id = $1 order by linked_at`,
        [userId]
      );
      return rows.map((r) => ({
        pubkey: String(r.pubkey),
        source: r.source as WalletSource,
        isPrimary: Boolean(r.is_primary),
      }));
    },

    /**
     * Returns the global ranking; room rankings come from the game engine.
     *
     * Ordered by XP, always: a trophy never reorders the table.
     *
     * The trophy balance is aggregated in the SAME statement, by a lateral over the
     * already-limited page: 50 fans cost one query, never one query per fan. The
     * lateral sits outside the `limit` subquery on purpose, so the ledger is only
     * touched for the rows that survive the cut.
     *
     * `sum(delta)` and never `count(*)`: `trophy_ledger` is a ledger, and a spend is
     * a negative row. A fan with no rows sums to null, which `coalesce` turns into a
     * real 0 — they earned none, and that is an answer, not a missing value.
     */
    async topRanking(
      limit = 50
    ): Promise<{ userId: string; handle: string; xp: number; level: number; trophies: number }[]> {
      const rows = await db.query(
        `select r.id, r.handle, r.xp, r.level, coalesce(t.saldo, 0)::int as trophies
           from (
             select id, handle, xp, level, created_at
               from users
              where handle is not null
              order by xp desc, created_at asc
              limit $1
           ) r
           left join lateral (
             select sum(l.delta) as saldo from trophy_ledger l where l.user_id = r.id
           ) t on true
          order by r.xp desc, r.created_at asc`,
        [limit]
      );
      return rows.map((r) => ({
        userId: String(r.id),
        handle: String(r.handle),
        xp: Number(r.xp),
        level: Number(r.level),
        trophies: Number(r.trophies),
      }));
    },

    /** Recomputes XP from durable awards to audit the cached users.xp value. */
    async recomputeXp(userId: string): Promise<{ antes: number; depois: number; bateu: boolean }> {
      return db.withTx(async (tx: Executor) => {
        const [atual] = await tx.query(`select xp from users where id = $1 for update`, [userId]);
        if (!atual) throw new UserNotFoundError(userId);
        const antes = Number(atual.xp);

        const [soma] = await tx.query(
          `
          select
            coalesce((select sum(p.awarded_xp) from predictions p where p.user_id = $1), 0)
          + coalesce((select sum(a.xp_reward)
                        from user_achievements ua
                        join achievements a on a.code = ua.achievement_code
                       where ua.user_id = $1), 0)
          + coalesce((select sum(m.xp_reward)
                        from user_missions um
                        join missions m on m.code = um.mission_code
                       where um.user_id = $1 and um.completed_at is not null), 0)
            as total
          `,
          [userId]
        );
        const depois = Number(soma?.total ?? 0);
        await tx.query(`update users set xp = $2, updated_at = now() where id = $1`, [userId, depois]);
        return { antes, depois, bateu: antes === depois };
      });
    },
  };

  return repo;
}

export type UserRepo = ReturnType<typeof createUserRepo>;
