// EnginePorts — a ponte entre os motores de @palpitei/core e o Postgres.
//
// No v0 os motores importavam o singleton `store` (Maps em memória) direto. Era
// o que fazia o XP sumir no primeiro restart. Aqui eles recebem PORTAS, e quem
// as implementa é o banco.
//
// Este arquivo foi escrito CONTRA O CONTRATO REAL de packages/core/src/ports.ts:
//
//   type EnginePorts = {
//     uid(prefix: string): string;
//     savePrediction(p: Prediction): void;   // <- SÍNCRONO, e chamado SEM await
//     saveBet(b: Bet): void;                 // <- idem
//     saveUser?(u: User): void;              // <- OPCIONAL. Ver abaixo por que não implementamos.
//   };
//
// ============================================================================
// 1. POR QUE NADA AQUI PODE REJEITAR
// ============================================================================
// O core chama as portas em fire-and-forget (`this.ports.savePrediction(p);`,
// sem await). Escrita em banco é assíncrona. Uma Promise rejeitada que ninguém
// pegou é `unhandled rejection` — e o Node 22 DERRUBA O PROCESSO por padrão.
//
// Foi medido, não deduzido: o fã recebe `{ok:true}`, e 200 ms depois o servidor
// morre com exit 1. Uma violação de FK ou um soluço da rede no meio do
// France × England levaria o Palpitei inteiro embora na frente do jurado.
//
// Por isso toda porta aqui ENGOLE a rejeição — mas não a esconde: registra em
// `onError` (que grita alto por padrão) e guarda para o `flush()`.
//
// ============================================================================
// 2. E POR QUE ENGOLIR NÃO BASTA: use flush() na rota que aceita o palpite
// ============================================================================
// `engine.place()` devolve `{ok:true}` na hora, antes de o INSERT terminar. Se
// a escrita falhar depois, o fã já ouviu "palpite registrado" e o palpite não
// existe. Mentir para o torcedor é pior que dar erro.
//
// Quem atende POST /api/rooms/:id/predictions deve fazer:
//
//     const r = room.placePrediction(userId, questionId, choice);
//     if (!r.ok) return res.status(400).json(r);
//     await ports.flush();   // estoura aqui se o banco recusou -> 409/500 honesto
//     return res.json(r);
//
// ============================================================================
// 3. POR QUE `saveUser` NÃO É IMPLEMENTADO (de propósito — não é esquecimento)
// ============================================================================
// O core faz, ao resolver: `addXp(user, awardedXp); ports.saveUser?.(user);`
// — ou seja, oferece o objeto User inteiro, com o xp JÁ SOMADO EM MEMÓRIA.
// Persistir isso seria `update users set xp = <valor que o motor calculou>`:
// uma escrita CEGA e ABSOLUTA. Dois jeitos de estragar, os dois silenciosos:
//
//   · Cópia velha: o mesmo fã em duas salas (dois jogos ao mesmo tempo) tem dois
//     objetos User. A sala A paga +150 e grava xp=150. A sala B, que carregou o
//     fã antes, paga +100 e grava xp=100. Os 150 SOMEM. Ninguém reclama de XP
//     que nunca viu.
//   · Saldo em dobro: em `placeBet` o core já debita `user.balanceCents` e chama
//     saveBet E saveUser. O nosso `saveBet` debita de forma relativa; somar um
//     saveUser absoluto por cima é contar a mesma moeda duas vezes.
//
// A porta é OPCIONAL (`saveUser?`) justamente para poder não existir. Omitindo,
// o XP e o saldo passam só pelos caminhos RELATIVOS e idempotentes:
//   · XP de palpite  -> savePrediction(p) com result != null -> settle (CAS)
//   · saldo          -> saveBet (débito) / marketRepo.resolve (crédito)
// Ambos imunes a cópia velha, porque somam (`xp = xp + $1`) em vez de mandar
// um total. NÃO ADICIONE saveUser aqui sem reler isto.

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
  /** Extra: alguém PRECISA gravar a pergunta (predictions referencia questions). */
  saveQuestion(q: Question): void;
  /** Extra: o mercado da prévia da v2. */
  saveMarket(m: Market): void;
  /**
   * Aguarda as escritas em voo. Estoura se alguma falhou desde o último flush.
   * É o que permite à rota HTTP contar a verdade para o fã.
   */
  flush(): Promise<void>;
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

  /** Dispara a escrita sem deixar a rejeição escapar para o process. */
  function disparar(contexto: string, fn: () => Promise<unknown>): void {
    const pr = fn()
      .then(() => undefined)
      .catch((e: unknown) => {
        const erro = e instanceof Error ? e : new Error(String(e));
        if (!primeiroErro) primeiroErro = erro;
        onError(erro, contexto);
      })
      .finally(() => {
        emVoo.delete(pr);
      });
    emVoo.add(pr);
  }

  return {
    uid,

    savePrediction(p: Prediction): void {
      // O core chama isto DUAS vezes na vida do palpite:
      //   1) quando o fã palpita        -> result == null -> registra
      //   2) quando a pergunta resolve  -> result != null -> paga o XP, 1x só
      // O segundo caso passa pelo CAS do settle: replay não paga de novo.
      disparar(`savePrediction(${p.id})`, () =>
        p.result == null
          ? predictions.place(p)
          : predictions.settle(p.id, p.result, p.awardedXp ?? 0)
      );
    },

    saveBet(b: Bet): void {
      // Só o caminho de ENTRADA da aposta (registra + debita, uma vez).
      // O PAGAMENTO não passa por aqui: o core também chama saveBet ao resolver,
      // com payoutCents preenchido, e nesta altura a aposta já existe — o insert
      // vira no-op. Quem credita é marketRepo.resolve(market, bets), sob o CAS do
      // mercado. Ver o handler de `market_resolved`.
      disparar(`saveBet(${b.id})`, () => markets.saveBet(b));
    },

    saveQuestion(q: Question): void {
      disparar(`saveQuestion(${q.id})`, () => questions.save(q));
    },

    saveMarket(m: Market): void {
      disparar(`saveMarket(${m.id})`, () => markets.save(m));
    },

    async flush(): Promise<void> {
      while (emVoo.size > 0) await Promise.all([...emVoo]);
      if (primeiroErro) {
        const e = primeiroErro;
        primeiroErro = null; // consumido: o próximo flush julga só o que vier depois
        throw e;
      }
    },

    pendentes(): number {
      return emVoo.size;
    },
  };
}
