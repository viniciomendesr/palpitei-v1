// gamificationRepo — conquistas e missões.
//
// As duas coisas pagam XP, e as duas são chamadas de dentro de fluxos que
// repetem (o fã recarrega a tela, o replay reprocessa, o cliente tenta de
// novo). Mesma regra do resto desta camada: o XP só sai na TRANSIÇÃO —
// bloqueada/desbloqueada, em andamento/concluída. Chamar duas vezes é no-op.

import type { Db, Executor } from '../pool.js';
import type { Achievement, Mission } from '../types.js';

// "Hoje" para o fã brasileiro é o dia em São Paulo, não em UTC. A missão de
// hoje virando às 21h de Brasília seria uma esquisitice silenciosa.
const HOJE_BR = `(now() at time zone 'America/Sao_Paulo')::date`;

// Missão de temporada não tem dia; usa uma data sentinela para caber na mesma
// chave primária (user_id, mission_code, period_date).
const EPOCA = '1970-01-01';

export function createGamificationRepo(db: Db) {
  const repo = {
    // -----------------------------------------------------------------------
    // Conquistas
    // -----------------------------------------------------------------------

    /**
     * Desbloqueia a conquista e paga o XP dela UMA vez.
     * A PK (user_id, achievement_code) faz o trabalho: quem já tinha a conquista
     * não recebe nada e a função devolve false.
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

    // -----------------------------------------------------------------------
    // Missões
    // -----------------------------------------------------------------------

    /**
     * Anda com a missão. `delta` soma ao progresso do dia.
     *
     * Devolve `concluiuAgora: true` só na virada — e é só nessa virada que o XP
     * sai. Depois de concluída, progresso extra não paga de novo (o
     * `completed_at is null` no WHERE é o CAS).
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

        // Virada: marca a conclusão e paga. O `completed_at is null` garante que
        // duas chamadas concorrentes não paguem duas vezes.
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

    /** As missões do fã hoje (é o que a home mostra em "MISSÃO DE HOJE"). */
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
