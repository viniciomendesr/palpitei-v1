/**
 * Persistence bridge from core to Postgres. Ports are fire-and-forget; capture
 * rejections through flush/flushDe. XP and balance writes are relative and idempotent.
 */

import type { Db } from './pool.js';
import type { Bet, Market, Prediction, Question } from './types.js';
import { uid } from './ids.js';
import { createMarketRepo } from './repos/marketRepo.js';
import { createPredictionRepo } from './repos/predictionRepo.js';
import { createQuestionRepo } from './repos/questionRepo.js';

export type EnginePortsOptions = {
  /** Called when an engine-triggered write fails. Defaults to console.error. */
  onError?: (erro: Error, contexto: string) => void;
  /**
   * The execution these writes belong to, stamped on every prediction.
   *
   * Core has no concept of a run and must not grow one: this is a persistence
   * concern. Without it two replay runs of the same fixture are indistinguishable
   * in the schema, because replay rooms create no `game_sessions` row.
   */
  runId?: string | null;
};

export interface EnginePorts {
  uid(prefix: string): string;
  savePrediction(p: Prediction): void;
  saveBet(b: Bet): void;
  /** Persists a question before predictions that reference it. */
  saveQuestion(q: Question): void;
  /** Persists a domain market. */
  saveMarket(m: Market): void;
  /** Waits for all writes; use `flushDe` for one prediction. */
  flush(): Promise<void>;
  /** Waits for writes and fails only for the indicated owner. */
  flushDe(dono: string): Promise<void>;
  /** Writes still in flight, used by tests and shutdown. */
  pendentes(): number;
}

export function createEnginePorts(db: Db, opts: EnginePortsOptions = {}): EnginePorts {
  const predictions = createPredictionRepo(db);
  const questions = createQuestionRepo(db);
  const markets = createMarketRepo(db);

  const onError =
    opts.onError ??
    ((erro: Error, contexto: string) => {
      console.error(`[ports] ${contexto} FALHOU: ${erro.message}`);
    });

  const emVoo = new Set<Promise<void>>();
  let primeiroErro: Error | null = null;

  /** One write per question; retains its settled promise for late predictions. */
  const perguntaEmVoo = new Map<string, Promise<void>>();

  /** Owner-scoped errors prevent exposing one fan's error to another. */
  const erroDoDono = new Map<string, Error>();

  /** Starts a write and captures rejection for `flush`/`flushDe`. */
  function disparar(contexto: string, fn: () => Promise<unknown>, dono?: string): Promise<void> {
    const pr = fn()
      .then(() => undefined)
      .catch((e: unknown) => {
        const erro = e instanceof Error ? e : new Error(String(e));
        if (!primeiroErro) primeiroErro = erro;
        if (dono) erroDoDono.set(dono, erro);
        onError(erro, contexto);
      })
      .finally(() => {
        emVoo.delete(pr);
      });
    emVoo.add(pr);
    return pr;
  }

  return {
    uid,

    savePrediction(p: Prediction): void {
      // Opening persists first; settlement uses CAS. Await it to preserve the FK.
      disparar(
        `savePrediction(${p.id})`,
        async () => {
          if (p.result == null) {
            await perguntaEmVoo.get(p.questionId)?.catch(() => {});
            return predictions.place(p, opts.runId ?? null);
          }
          return predictions.settle(p.id, p.result, p.awardedXp ?? 0);
        },
        p.id,
      );
    },

    saveBet(b: Bet): void {
      // Record the debit; market settlement credits it under CAS.
      disparar(`saveBet(${b.id})`, () => markets.saveBet(b));
    },

    saveQuestion(q: Question): void {
      // `savePrediction` espera esta promise antes de inserir a chave estrangeira.
      const pr = disparar(`saveQuestion(${q.id})`, () => questions.save(q));
      perguntaEmVoo.set(q.id, pr);
    },

    saveMarket(m: Market): void {
      disparar(`saveMarket(${m.id})`, () => markets.save(m));
    },

    async flush(): Promise<void> {
      while (emVoo.size > 0) await Promise.all([...emVoo]);
      if (primeiroErro) {
        const e = primeiroErro;
        primeiroErro = null; // The next flush considers only later failures.
        throw e;
      }
    },

    /** Waits only for a failure related to the requested owner. */
    async flushDe(dono: string): Promise<void> {
      while (emVoo.size > 0) await Promise.all([...emVoo]);
      const erro = erroDoDono.get(dono);
      if (erro) {
        erroDoDono.delete(dono);
        // Do not repeat an error already delivered by a prior flush.
        if (primeiroErro === erro) primeiroErro = null;
        throw erro;
      }
    },

    pendentes(): number {
      return emVoo.size;
    },
  };
}
