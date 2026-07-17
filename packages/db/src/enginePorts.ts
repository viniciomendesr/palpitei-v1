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
   * Aguarda as escritas em voo. Estoura se ALGUMA falhou desde o último flush —
   * de qualquer fã. Numa sala com mais de um, prefira `flushDe`.
   */
  flush(): Promise<void>;
  /**
   * Aguarda as escritas e estoura só se a de `dono` falhou. É o que a rota do
   * palpite usa para contar a verdade AO FÃ CERTO.
   */
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

  /**
   * A escrita de cada PERGUNTA, por id. O palpite espera por ela — ver
   * `savePrediction`. Fica aqui e não some no `finally`: um palpite que chega
   * depois da escrita terminar precisa achar a promise já resolvida, não nada.
   */
  const perguntaEmVoo = new Map<string, Promise<void>>();

  /**
   * O erro de cada escrita, pelo DONO dela (o id do palpite/aposta).
   *
   * Existe porque `primeiroErro` é um slot ÚNICO por sala, e quem chama `flush()`
   * primeiro CONSOME o erro — de qualquer um. Medido numa sala com 3 fãs: o
   * palpite de um falhou e a exceção saiu no POST de OUTRO. O fã inocente levou
   * 500 por um palpite que estava bom, e o dono do erro ouviu "registrado" para
   * um palpite que não existe. É a mentira que este arquivo diz existir para
   * impedir, entregue ao fã errado.
   */
  const erroDoDono = new Map<string, Error>();

  /**
   * Dispara a escrita sem deixar a rejeição escapar para o process.
   * `dono` = a quem este erro pertence, para o flush não julgar o palpite alheio.
   */
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
      // O core chama isto DUAS vezes na vida do palpite:
      //   1) quando o fã palpita        -> result == null -> registra
      //   2) quando a pergunta resolve  -> result != null -> paga o XP, 1x só
      // O segundo caso passa pelo CAS do settle: a mesma liquidação não paga de novo.
      //
      // ============================================================
      // POR QUE ESPERA A PERGUNTA (e por que isto perdia palpite)
      // ============================================================
      // `predictions.question_id` referencia `questions.id`. O core chama
      // `saveQuestion(q)` ao abrir e `savePrediction(p)` quando o fã responde —
      // as duas fire-and-forget, sem ordem entre elas, e em CONEXÕES DIFERENTES
      // do pool. Quem palpita rápido chega antes da pergunta existir e leva
      // violação de FK (23503).
      //
      // E "rápido" não é caso raro: é JUSTO QUEM O BÔNUS DE 1.5x PREMIA. Medido
      // numa partida: 4 palpites perdidos, e um fã terminou com 675 XP no
      // ranking e 450 no banco — 225 XP que o motor pagou em memória e o
      // Postgres nunca viu. Some calado: o `disparar` engole a rejeição (tem
      // que engolir, senão derruba o processo), e o fã vê o XP na tela.
      //
      // O `.catch` no await é de propósito: se a ESCRITA DA PERGUNTA falhou, o
      // erro é dela e já foi registrado — o palpite tenta assim mesmo e falha
      // com o erro DELE, que é o que o fã precisa ouvir. Não herdamos culpa.
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
      // Só o caminho de ENTRADA da aposta (registra + debita, uma vez).
      // O PAGAMENTO não passa por aqui: o core também chama saveBet ao resolver,
      // com payoutCents preenchido, e nesta altura a aposta já existe — o insert
      // vira no-op. Quem credita é marketRepo.resolve(market, bets), sob o CAS do
      // mercado. Ver o handler de `market_resolved`.
      disparar(`saveBet(${b.id})`, () => markets.saveBet(b));
    },

    saveQuestion(q: Question): void {
      // Guarda a promise por id: é nela que `savePrediction` espera para não
      // estourar a FK. Sem isto, o palpite rápido chega antes da pergunta existir.
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
        primeiroErro = null; // consumido: o próximo flush julga só o que vier depois
        throw e;
      }
    },

    /**
     * Espera as escritas e estoura SÓ se a de `dono` falhou. É o que a rota do
     * palpite deve usar — `flush()` julga a sala inteira.
     *
     * O `flush()` sem dono tem um defeito que só aparece com mais de um fã: o
     * `primeiroErro` é um slot único e quem chega primeiro CONSOME o erro de
     * quem for. Medido: o palpite de um fã falhou e a exceção saiu no POST de
     * outro — o inocente levou 500 por um palpite bom, e o dono do erro ouviu
     * "registrado" para um palpite que não existe. Numa sala de um fã só isso
     * não aparece; no France × England, com todo mundo palpitando junto, é o
     * caso normal.
     */
    async flushDe(dono: string): Promise<void> {
      while (emVoo.size > 0) await Promise.all([...emVoo]);
      const erro = erroDoDono.get(dono);
      if (erro) {
        erroDoDono.delete(dono);
        // O slot global também é limpo se o erro consumido for o mesmo objeto:
        // senão o próximo `flush()` genérico ressuscita um erro já entregue.
        if (primeiroErro === erro) primeiroErro = null;
        throw erro;
      }
    },

    pendentes(): number {
      return emVoo.size;
    },
  };
}
