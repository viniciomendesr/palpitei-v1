// predictionRepo — o palpite do fã e o pagamento do XP.
//
// ============================================================================
// O PONTO MAIS PERIGOSO DESTA CAMADA INTEIRA
// ============================================================================
// No v0 o pagamento era `store.addXp(user, awardedXp)` dentro do motor: um
// incremento cego. Em memória, sem replay, funcionava. Aqui não funcionaria:
//
//   · o replay REEMITE a linha do tempo — a mesma pergunta resolve de novo;
//   · o stream SSE reconecta e REENVIA eventos;
//   · o servidor reinicia no meio de uma partida e reprocessa o cache.
//
// Em qualquer um dos três, o incremento cego paga duas vezes. E paga em
// SILÊNCIO: ninguém abre um chamado porque ganhou XP demais. O ranking do
// jurado simplesmente estaria errado.
//
// Por isso o XP aqui é FUNÇÃO de (prediction_id, resolução), e não um "+=":
// o UPDATE só morde `where result is null`. É um compare-and-swap. Se a linha
// já tinha resolução, o update não pega ninguém, nada é devolvido, e o XP não
// se mexe. Pagar duas vezes deixa de ser uma questão de disciplina de quem
// chama e passa a ser impossível.

import type { Db, Executor } from '../pool.js';
import type { Prediction } from '../types.js';
import { isForeignKeyViolation, isUniqueViolation } from '../errors.js';

export type ResultadoPalpite = 'won' | 'lost' | 'void';

export type SettleResult = {
  /** false = já estava resolvido; o XP NÃO foi pago de novo (replay/reenvio). */
  pagou: boolean;
  userId?: string;
  awardedXp?: number;
};

export function createPredictionRepo(db: Db) {
  const repo = {
    /**
     * Registra o palpite. Um por fã por pergunta — garantido pelo UNIQUE do
     * banco, não pela memória do motor (que morre no restart).
     */
    async place(p: Prediction): Promise<void> {
      try {
        await db.query(
          `insert into predictions (id, user_id, question_id, choice, placed_at)
           values ($1, $2, $3, $4, $5)
           on conflict (id) do nothing`,
          [p.id, p.userId, p.questionId, p.choice, p.placedAt]
        );
      } catch (e) {
        if (isUniqueViolation(e)) {
          // Bateu no UNIQUE (user_id, question_id): o fã já palpitou aqui.
          throw new Error('você já palpitou nesta pergunta');
        }
        if (isForeignKeyViolation(e)) {
          // Diagnóstico explícito porque o sintoma é obscuro: some um palpite e
          // ninguém sabe por quê.
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
     * Paga (ou não) o XP de um palpite. Idempotente por construção.
     *
     * Regra do streak: acerto soma; erro zera; ANULADA não mexe. Anulação é
     * decisão do sistema (o evento resolvedor chegou com a janela aberta) — não
     * é falha do fã, e não pode custar a sequência dele.
     */
    async settle(
      predictionId: string,
      result: ResultadoPalpite,
      awardedXp: number,
      tx?: Executor
    ): Promise<SettleResult> {
      const xp = result === 'won' ? Math.max(0, Math.trunc(awardedXp)) : 0;

      const exec = async (q: Executor): Promise<SettleResult> => {
        // O CAS: só resolve quem ainda não estava resolvido.
        const linhas = await q.query(
          `update predictions
              set result = $2, awarded_xp = $3, resolved_at = now()
            where id = $1 and result is null
            returning user_id, awarded_xp`,
          [predictionId, result, xp]
        );
        if (linhas.length === 0) return { pagou: false };

        const userId = String(linhas[0]!.user_id);

        // Só chega aqui quem virou a chave. O XP segue o palpite; o nível é
        // coluna gerada e se ajusta sozinho.
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

    /**
     * Resolve pelo par (usuário, pergunta) — a forma como o `question_resolved`
     * dos motores descreve o resultado (ele traz userId, não predictionId).
     */
    async settleByUserQuestion(
      userId: string,
      questionId: string,
      result: ResultadoPalpite,
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

    /**
     * Resolve a pergunta inteira de uma vez, numa transação só — o formato do
     * `question_resolved`/`question_void` que a sala já difunde.
     * Devolve quantos foram REALMENTE pagos: numa entrega duplicada isso vem 0,
     * e é assim que se enxerga que a idempotência está viva.
     */
    async settleQuestion(
      questionId: string,
      results: { userId: string; result: ResultadoPalpite; awardedXp: number }[]
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
      if (r.result != null) p.result = r.result as ResultadoPalpite;
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
        if (r.result != null) p.result = r.result as ResultadoPalpite;
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
        if (r.result != null) p.result = r.result as ResultadoPalpite;
        if (r.awarded_xp != null) p.awardedXp = Number(r.awarded_xp);
        return p;
      });
    },

    /** Aproveitamento do fã — alimenta o perfil. */
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
