// Achievements and missions. XP is awarded only on a state transition, making
// retries and replay reprocessing idempotent.

import type { Db, Executor } from '../pool.js';
import type { Achievement, Mission } from '../types.js';

// Daily missions follow the São Paulo calendar rather than UTC.
const HOJE_BR = `(now() at time zone 'America/Sao_Paulo')::date`;

// Seasonal missions use a sentinel date to share the same primary-key shape.
const EPOCA = '1970-01-01';

export function createGamificationRepo(db: Db) {
  const repo = {
    /**
     * Unlocks an achievement and awards its XP once via the primary key.
     */
    async unlock(userId: string, code: string): Promise<boolean> {
      return db.withTx(async (tx: Executor) => {
        const rows = await tx.query(
          `insert into user_achievements (user_id, achievement_code)
           values ($1, $2)
           on conflict (user_id, achievement_code) do nothing
           returning achievement_code`,
          [userId, code]
        );
        if (rows.length === 0) return false;

        await tx.query(
          `update users
              set xp = xp + coalesce((select xp_reward from achievements where code = $2), 0),
                  updated_at = now()
            where id = $1`,
          [userId, code]
        );
        return true;
      });
    },

    async listAchievements(userId?: string): Promise<Achievement[]> {
      const rows = await db.query(
        `select a.code, a.title, a.description, a.xp_reward, a.sort_order, a.active,
                extract(epoch from ua.unlocked_at) * 1000 as unlocked_ms
           from achievements a
           left join user_achievements ua
             on ua.achievement_code = a.code and ua.user_id = $1::uuid
          where a.active
          order by a.sort_order`,
        [userId ?? null]
      );
      return rows.map((r) => {
        const a: Achievement = {
          code: String(r.code),
          title: String(r.title),
          description: String(r.description),
          xpReward: Number(r.xp_reward),
          sortOrder: Number(r.sort_order),
          active: Boolean(r.active),
        };
        if (r.unlocked_ms != null) a.unlockedAt = Math.round(Number(r.unlocked_ms));
        return a;
      });
    },

    /**
     * Advances a mission by delta. XP is awarded only when completed_at changes
     * from null, guarded by CAS.
     */
    async progress(
      userId: string,
      code: string,
      delta = 1,
      opts: { date?: string } = {}
    ): Promise<{ progresso: number; alvo: number; concluiuAgora: boolean }> {
      return db.withTx(async (tx: Executor) => {
        const [missao] = await tx.query(`select target, kind, xp_reward from missions where code = $1 and active`, [
          code,
        ]);
        if (!missao) throw new Error(`[db] missão "${code}" não existe (ou está inativa)`);

        const alvo = Number(missao.target);
        const periodo =
          opts.date ?? (String(missao.kind) === 'season' ? EPOCA : null);

        const [linha] = await tx.query(
          `
          insert into user_missions (user_id, mission_code, period_date, progress)
          values ($1, $2, coalesce($3::date, ${HOJE_BR}), $4)
          on conflict (user_id, mission_code, period_date) do update set
            progress   = user_missions.progress + $4,
            updated_at = now()
          returning progress, period_date, completed_at
          `,
          [userId, code, periodo, Math.trunc(delta)]
        );

        const progresso = Number(linha!.progress);
        if (progresso < alvo || linha!.completed_at != null) {
          return { progresso, alvo, concluiuAgora: false };
        }

        // CAS on completed_at prevents concurrent calls from paying twice.
        const virou = await tx.query(
          `update user_missions
              set completed_at = now(), updated_at = now()
            where user_id = $1 and mission_code = $2 and period_date = $3 and completed_at is null
            returning mission_code`,
          [userId, code, linha!.period_date]
        );
        if (virou.length === 0) return { progresso, alvo, concluiuAgora: false };

        await tx.query(`update users set xp = xp + $2, updated_at = now() where id = $1`, [
          userId,
          Number(missao.xp_reward),
        ]);
        return { progresso, alvo, concluiuAgora: true };
      });
    },

    /** Today's missions for the home view. */
    async listMissions(userId: string, opts: { date?: string } = {}): Promise<Mission[]> {
      const rows = await db.query(
        `select m.code, m.title, m.description, m.kind, m.target, m.xp_reward, m.sort_order, m.active,
                coalesce(um.progress, 0) as progress,
                extract(epoch from um.completed_at) * 1000 as completed_ms
           from missions m
           left join user_missions um
             on um.mission_code = m.code
            and um.user_id = $1::uuid
            and um.period_date = case when m.kind = 'season'
                                      then '${EPOCA}'::date
                                      else coalesce($2::date, ${HOJE_BR}) end
          where m.active
          order by m.sort_order`,
        [userId, opts.date ?? null]
      );
      return rows.map((r) => {
        const m: Mission = {
          code: String(r.code),
          title: String(r.title),
          description: String(r.description),
          kind: r.kind as 'daily' | 'season',
          target: Number(r.target),
          xpReward: Number(r.xp_reward),
          sortOrder: Number(r.sort_order),
          active: Boolean(r.active),
          progress: Number(r.progress),
        };
        if (r.completed_ms != null) m.completedAt = Math.round(Number(r.completed_ms));
        return m;
      });
    },
  };

  return repo;
}

export type GamificationRepo = ReturnType<typeof createGamificationRepo>;
