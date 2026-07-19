/**
 * Prediction persistence and XP settlement. The conditional update in
 * `settle` is the idempotency boundary for replayed or redelivered events.
 */

import type { Db, Executor } from '../pool.js';
import type { Prediction } from '../types.js';
import { isForeignKeyViolation, isUniqueViolation } from '../errors.js';

export type PredictionResult = 'won' | 'lost' | 'void';

export type SettleResult = {
  /** False when the prediction was already resolved and XP was not paid again. */
  pagou: boolean;
  userId?: string;
  awardedXp?: number;
};

export function createPredictionRepo(db: Db) {
  const repo = {
    /**
     * The database unique constraint enforces one prediction per user and question.
     *
     * `runId` identifies the execution that produced the prediction, which is the
     * only way a replay run can be told apart from the next one: replay rooms
     * create no `game_sessions` row, so `questions.session_id` groups live play
     * and nothing groups replay play. The room supplies it; core never sees it.
     */
    async place(p: Prediction, runId: string | null = null): Promise<void> {
      try {
        await db.query(
          `insert into predictions (id, user_id, question_id, choice, placed_at, run_id)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (id) do nothing`,
          [p.id, p.userId, p.questionId, p.choice, p.placedAt, runId]
        );
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new Error('você já palpitou nesta pergunta');
        }
        if (isForeignKeyViolation(e)) {
          throw new Error(
            `[db] não dá para gravar o palpite ${p.id}: a pergunta ${p.questionId} ou o usuário ` +
              `${p.userId} não está no banco. Quem trata o 'question_open' precisa chamar ` +
              `questionRepo.save(q) ANTES de aceitar palpite (predictions referencia questions).`
          );
        }
        throw e;
      }
    },

    /**
     * Settles XP exactly once. Wins advance streaks, losses reset them, and
     * void results preserve the current streak.
     */
    async settle(
      predictionId: string,
      result: PredictionResult,
      awardedXp: number,
      tx?: Executor
    ): Promise<SettleResult> {
      const xp = result === 'won' ? Math.max(0, Math.trunc(awardedXp)) : 0;

      const exec = async (q: Executor): Promise<SettleResult> => {
        // The compare-and-swap only settles unresolved predictions.
        const linhas = await q.query(
          `update predictions
              set result = $2, awarded_xp = $3, resolved_at = now()
            where id = $1 and result is null
            returning user_id, awarded_xp`,
          [predictionId, result, xp]
        );
        if (linhas.length === 0) return { pagou: false };

        const userId = String(linhas[0]!.user_id);

        await q.query(
          `update users
              set xp = xp + $2,
                  current_streak = case
                                     when $3 = 'won'  then current_streak + 1
                                     when $3 = 'lost' then 0
                                     else current_streak
                                   end,
                  best_streak = case
                                  when $3 = 'won' then greatest(best_streak, current_streak + 1)
                                  else best_streak
                                end,
                  updated_at = now()
            where id = $1`,
          [userId, xp, result]
        );

        return { pagou: true, userId, awardedXp: xp };
      };

      return tx ? exec(tx) : db.withTx(exec);
    },

    /** Settles by user and question, matching the engine event shape. */
    async settleByUserQuestion(
      userId: string,
      questionId: string,
      result: PredictionResult,
      awardedXp: number,
      tx?: Executor
    ): Promise<SettleResult> {
      const exec = async (q: Executor): Promise<SettleResult> => {
        const linhas = await q.query(`select id from predictions where user_id = $1 and question_id = $2`, [
          userId,
          questionId,
        ]);
        const id = linhas[0]?.id;
        if (!id) return { pagou: false };
        return repo.settle(String(id), result, awardedXp, q);
      };
      return tx ? exec(tx) : db.withTx(exec);
    },

    /** Settles every prediction for a question atomically. */
    async settleQuestion(
      questionId: string,
      results: { userId: string; result: PredictionResult; awardedXp: number }[]
    ): Promise<{ pagos: number; jaEstavam: number }> {
      return db.withTx(async (tx) => {
        let pagos = 0;
        let jaEstavam = 0;
        for (const r of results) {
          const out = await repo.settleByUserQuestion(r.userId, questionId, r.result, r.awardedXp, tx);
          if (out.pagou) pagos++;
          else jaEstavam++;
        }
        return { pagos, jaEstavam };
      });
    },

    async findById(id: string): Promise<Prediction | null> {
      const rows = await db.query(
        `select id, user_id, question_id, choice, placed_at, result, awarded_xp
           from predictions where id = $1`,
        [id]
      );
      const r = rows[0];
      if (!r) return null;
      const p: Prediction = {
        id: String(r.id),
        userId: String(r.user_id),
        questionId: String(r.question_id),
        choice: String(r.choice),
        placedAt: Number(r.placed_at),
      };
      if (r.result != null) p.result = r.result as PredictionResult;
      if (r.awarded_xp != null) p.awardedXp = Number(r.awarded_xp);
      return p;
    },

    async listByUser(userId: string, limit = 50): Promise<Prediction[]> {
      const rows = await db.query(
        `select id, user_id, question_id, choice, placed_at, result, awarded_xp
           from predictions where user_id = $1 order by placed_at desc limit $2`,
        [userId, limit]
      );
      return rows.map((r) => {
        const p: Prediction = {
          id: String(r.id),
          userId: String(r.user_id),
          questionId: String(r.question_id),
          choice: String(r.choice),
          placedAt: Number(r.placed_at),
        };
        if (r.result != null) p.result = r.result as PredictionResult;
        if (r.awarded_xp != null) p.awardedXp = Number(r.awarded_xp);
        return p;
      });
    },

    async listByQuestion(questionId: string): Promise<Prediction[]> {
      const rows = await db.query(
        `select id, user_id, question_id, choice, placed_at, result, awarded_xp
           from predictions where question_id = $1 order by placed_at`,
        [questionId]
      );
      return rows.map((r) => {
        const p: Prediction = {
          id: String(r.id),
          userId: String(r.user_id),
          questionId: String(r.question_id),
          choice: String(r.choice),
          placedAt: Number(r.placed_at),
        };
        if (r.result != null) p.result = r.result as PredictionResult;
        if (r.awarded_xp != null) p.awardedXp = Number(r.awarded_xp);
        return p;
      });
    },

    /** Returns the user's prediction summary for the profile. */
    async estatisticas(userId: string): Promise<{
      total: number;
      acertos: number;
      erros: number;
      anuladas: number;
      abertos: number;
      xpDePalpites: number;
    }> {
      const rows = await db.query(
        `select
           count(*)::int as total,
           count(*) filter (where result = 'won')::int  as acertos,
           count(*) filter (where result = 'lost')::int as erros,
           count(*) filter (where result = 'void')::int as anuladas,
           count(*) filter (where result is null)::int  as abertos,
           coalesce(sum(awarded_xp), 0)::int as xp
         from predictions where user_id = $1`,
        [userId]
      );
      const r = rows[0]!;
      return {
        total: Number(r.total),
        acertos: Number(r.acertos),
        erros: Number(r.erros),
        anuladas: Number(r.anuladas),
        abertos: Number(r.abertos),
        xpDePalpites: Number(r.xp),
      };
    },
  };

  return repo;
}

export type PredictionRepo = ReturnType<typeof createPredictionRepo>;
