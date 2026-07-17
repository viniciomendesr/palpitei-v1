// userRepo — a identidade do Palpitei.
//
// REGRA QUE NÃO SE NEGOCIA: a identidade é o `privy_did` VERIFICADO. Nunca
// `body.userId`, nunca a carteira. A carteira muda (a Opção B ganha uma
// embutida por cima) e o MESMO endereço reaparece como 'external' depois que o
// fã exporta e importa no Phantom (E16). Só o DID é estável.
//
// Este repositório não sabe verificar token nenhum: quem chama já tem de ter
// passado pelo verifyAuthToken da Privy. Se um DID chegar aqui, ele é lei.

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
    // NULL fica NULL. O schema guarda NULL justamente para o E2 (fã da Privy que
    // entrou sem carteira Solana) ficar visível; um `?? 'simulated'` aqui
    // apagaria essa evidência e ainda marcaria um `did:privy:*` real como modo
    // demo — combinação que o próprio users_did_namespace_ck recusa gravar.
    // Quem precisa de carteira checa por NULL; não há origem padrão.
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

/** Regras do apelido. Ele é PÚBLICO (ranking, ligas) — por isso o onboarding pede. */
export function validarHandle(handle: string): string {
  const limpo = handle.trim();
  if (limpo.length < 3 || limpo.length > 20) {
    throw new HandleInvalidError('o apelido precisa ter de 3 a 20 caracteres');
  }
  if (!/^[\p{L}\p{N}._-]+$/u.test(limpo)) {
    throw new HandleInvalidError('o apelido aceita letras, números, ponto, hífen e underline');
  }
  // E12: o apelido NUNCA sai do e-mail. Aqui só dá para barrar o formato óbvio —
  // a garantia de verdade é que nada neste pacote lê e-mail nenhum.
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

    /**
     * O caminho do login. Cria na primeira vez, atualiza a carteira nas
     * seguintes — e NUNCA apaga o que já sabia: se a Privy responder sem
     * carteira desta vez (acontece), `coalesce` preserva a que estava lá.
     * Sobrescrever com NULL seria o "ausente = zero" de novo, agora na conta
     * do fã.
     *
     * Repare no que NÃO acontece aqui: nenhum apelido é inventado. O usuário
     * nasce com handle NULL e o onboarding pede (E12).
     */
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
      // A carteira principal também entra em user_wallets: é lá que mora o 1:N.
      if (wallet && source) await repo.linkWallet(id, wallet, source, { primary: true });

      const user = await repo.findById(id);
      if (!user) throw new UserNotFoundError(id);
      return user;
    },

    /**
     * O fã escolhe o apelido. 409 se já for de outra pessoa.
     *
     * A corrida entre dois fãs pedindo o mesmo apelido no mesmo instante é
     * resolvida pelo UNIQUE do banco, não por um SELECT antes do UPDATE — o
     * "confere e depois grava" perde essa corrida em silêncio e cria dois
     * "craques" no ranking.
     */
    async setHandle(userId: string, handle: string): Promise<User> {
      const limpo = validarHandle(handle);
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
     * Soma XP. O NÍVEL não é atualizado aqui de propósito: ele é coluna GERADA
     * pelo banco com a fórmula do v0 — floor(sqrt(xp/100)) + 1 — e por isso não
     * tem como divergir do XP. A fórmula vive num lugar só.
     *
     * CUIDADO: isto é incremento cego. Serve para XP avulso (conquista, missão,
     * bônus). Para o XP de PALPITE use predictionRepo.settle, que só paga na
     * transição de resolução — senão o replay paga duas vezes.
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

    /**
     * Vincula uma carteira à conta (1:N).
     *
     * O mesmo endereço PODE aparecer duas vezes na mesma conta com origens
     * diferentes: a embutida que o fã exportou e reimportou no Phantom volta
     * como 'external' com o MESMO pubkey (E16). Por isso a chave é
     * (user_id, pubkey, source) — deduplicar só por pubkey apagaria a
     * proveniência, que é justamente a evidência anti-lock-in da demo.
     */
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

    /**
     * Espelha a lista de carteiras que a Privy diz serem deste DID.
     * Só ACRESCENTA: uma resposta da Privy sem uma carteira não é prova de que
     * o fã a desvinculou — e apagar o vínculo aqui apagaria o histórico.
     */
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

    /** Ranking global por XP. O ranking da SALA é do motor; este é o da tela de ranking. */
    async topByXp(limit = 50): Promise<{ userId: string; handle: string; xp: number; level: number }[]> {
      const rows = await db.query(
        `select id, handle, xp, level
           from users
          where handle is not null
          order by xp desc, created_at asc
          limit $1`,
        [limit]
      );
      return rows.map((r) => ({
        userId: String(r.id),
        handle: String(r.handle),
        xp: Number(r.xp),
        level: Number(r.level),
      }));
    },

    /**
     * Recalcula o XP a partir do que foi REGISTRADO (palpites resolvidos +
     * conquistas + missões concluídas) e devolve o antes/depois.
     *
     * É a auditoria do invariante: `users.xp` é um cache de uma soma. Se este
     * método mudar o valor de alguém, algum caminho pagou XP em dobro (ou de
     * menos) — e aí temos um bug para caçar, não um número para admirar.
     */
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
