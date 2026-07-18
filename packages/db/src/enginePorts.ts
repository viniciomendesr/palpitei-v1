/**
 * Ponte de persistência do core para Postgres.
 *
 * As portas são fire-and-forget: nunca deixe uma rejeição escapar; registre-a e
 * exponha-a por `flush`/`flushDe`. XP e saldo usam operações relativas e
 * idempotentes; não implemente `saveUser` com um valor absoluto.
 */

import type { Db } from './pool.js';
import type { Bet, Market, Prediction, Question } from './types.js';
import { uid } from './ids.js';
import { createMarketRepo } from './repos/marketRepo.js';
import { createPredictionRepo } from './repos/predictionRepo.js';
import { createQuestionRepo } from './repos/questionRepo.js';

export type EnginePortsOptions = {
  /** Chamado quando uma escrita disparada pelo motor falha. Padrão: console.error. */
  onError?: (erro: Error, contexto: string) => void;
};

export interface EnginePorts {
  uid(prefix: string): string;
  savePrediction(p: Prediction): void;
  saveBet(b: Bet): void;
  /** Persiste a pergunta antes dos palpites que a referenciam. */
  saveQuestion(q: Question): void;
  /** Persiste um mercado do domínio. */
  saveMarket(m: Market): void;
  /** Aguarda todas as escritas; para um palpite individual prefira `flushDe`. */
  flush(): Promise<void>;
  /** Aguarda as escritas e falha somente pelo dono indicado. */
  flushDe(dono: string): Promise<void>;
  /** Escritas ainda em voo — útil para teste e para o shutdown. */
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

  /** Escrita de cada pergunta; mantém a promise concluída para palpites tardios. */
  const perguntaEmVoo = new Map<string, Promise<void>>();

  /** Erros por dono evitam entregar a um fã o erro de outro. */
  const erroDoDono = new Map<string, Error>();

  /** Dispara uma escrita e captura a rejeição para `flush`/`flushDe`. */
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
      // Abertura grava; liquidação usa CAS. Esperar a pergunta evita violar a FK.
      disparar(
        `savePrediction(${p.id})`,
        async () => {
          if (p.result == null) {
            await perguntaEmVoo.get(p.questionId)?.catch(() => {});
            return predictions.place(p);
          }
          return predictions.settle(p.id, p.result, p.awardedXp ?? 0);
        },
        p.id,
      );
    },

    saveBet(b: Bet): void {
      // Registra o débito; a liquidação é creditada pelo mercado sob CAS.
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
        primeiroErro = null; // O próximo flush julga apenas falhas posteriores.
        throw e;
      }
    },

    /** Aguarda somente a falha relacionada ao dono solicitado. */
    async flushDe(dono: string): Promise<void> {
      while (emVoo.size > 0) await Promise.all([...emVoo]);
      const erro = erroDoDono.get(dono);
      if (erro) {
        erroDoDono.delete(dono);
        // Não deixe um `flush` posterior repetir um erro já entregue.
        if (primeiroErro === erro) primeiroErro = null;
        throw erro;
      }
    },

    pendentes(): number {
      return emVoo.size;
    },
  };
}
