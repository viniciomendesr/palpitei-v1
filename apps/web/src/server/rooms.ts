/**
 * A sala ao vivo — onde o motor de perguntas encontra o feed da TxLINE.
 *
 * Vive no MÓDULO, e é de propósito: uma sala é um processo com relógio andando,
 * não uma consulta. O `next dev`/`next start` é um processo Node só, então o Map
 * abaixo é o servidor de salas. (Em serverless isto não sobrevive — é a decisão
 * a revisitar no deploy, não aqui.)
 *
 * ─── por que o relógio é assim, e não do jeito óbvio ───
 *
 * O jeito óbvio seria derivar a posição do replay do relógio de PAREDE:
 * `cursor = kickoff + (agora - entrou) * speed`. É errado, e o v0 pagou para
 * descobrir (B2): o ReplayRunner COMPRIME os buracos (pré-jogo, intervalo) para
 * no máximo 2s reais, então em minutos de jogo o relógio de parede diverge do
 * agendador — e começa a fechar janelas de palpite sozinho, antes de o fã poder
 * reagir. Por isso o `cursorClock` ancora no ÚLTIMO EVENTO EMITIDO e só
 * interpola dali. Quem manda no tempo é o feed; o relógio de parede só preenche
 * o intervalo entre dois eventos.
 *
 * ─── por que o servidor decide, e não o cliente ───
 *
 * O motor podia rodar no browser (o core é puro). Não pode: o palpite vale XP no
 * ranking público, e cliente que decide o próprio XP é fraude trivial atrás de
 * um link (CONTEXT §4). A identidade é o DID verificado; a janela do palpite é o
 * relógio DESTA sala. O cliente só recebe e mostra.
 */

import { QuestionEngine, XP_BASE, cursorClock, type Clock, type ReplayCursor } from '@palpitei/core';
import type {
  Fixture,
  NormEvent,
  Question,
  ResolvedResult,
  RoomMessage,
  ScoreEvent,
  User,
} from '@palpitei/core';
import { ReplayRunner } from '@palpitei/txline';
import {
  createEnginePorts,
  createEventRepo,
  createMatchRepo,
  createPredictionRepo,
} from '@palpitei/db';
import type { Db, EnginePorts } from '@palpitei/db';
import { criarFiltroDeLances } from './lances';
import { createDb } from './db';

/** 60 = um minuto de jogo por segundo real. O mesmo default do config da txline. */
const REPLAY_SPEED = Number(process.env.REPLAY_SPEED ?? 60) || 60;

export type RoomState = {
  fixtureId: number;
  teamA: string;
  teamB: string;
  source: string;
  score: { p1: number; p2: number };
  /** Minuto do relógio do FEED. null antes do apito. */
  minute: number | null;
  /**
   * A ÂNCORA do relógio na tela: segundos de jogo do último evento que trouxe
   * relógio. Com `replaySpeed`, o cliente interpola o minuto ENTRE eventos —
   * antes o badge congelava no 0’ e saltava para o 6’ no escanteio seguinte.
   * A disciplina é a do cursorClock (B2): o evento re-ancora, a parede preenche.
   */
  clockSeconds: number | null;
  /** Minutos de jogo por segundo real (12 no replay padrão; 1 ao vivo). */
  replaySpeed: number;
  finished: boolean;
  questions: Question[];
  feed: { minute: number | null; action: string; goals: { p1: number; p2: number } | null }[];
  /**
   * O bloco `Score.Total` acumulado, chave a chave. Vazio até o primeiro evento
   * com Score — e vazio é a leitura honesta: a partida ainda não trouxe total
   * nenhum. Quem preencher com zeros aqui inventa estatística (G6).
   *
   * O conjunto de chaves é DESTA partida, não uma lista fixa: medido no England
   * × Argentina, o Total inteiro é `{ Goals, Corners, YellowCards }` — sem
   * `Shots`, sem `Possession`. A UI mostra o que vier; nada mais.
   */
  totals: { p1: Record<string, number>; p2: Record<string, number> };
};

/**
 * Um assinante é uma CONEXÃO DE UM FÃ, não um canal genérico — e isso não é
 * detalhe: o contrato do §8 (lib/api.ts) é escrito na primeira pessoa.
 * `question_resolved` manda `gained`, o XP DAQUELE fã; o motor, por dentro,
 * emite `results[]` com o palpite e o XP de TODO MUNDO na sala.
 *
 * Traduzir por assinante é o que faz o contrato ser cumprido e, de quebra, evita
 * transmitir para cada fã o que os outros palpitaram e quanto ganharam.
 */
type Sub = { userId: string | null; enviar: (msg: RoomMessage) => void };

type Room = {
  fixtureId: number;
  /**
   * Sala de TREINO: a mesma partida, o mesmo motor — e XP sempre 0, para
   * TODO MUNDO, com NADA persistido. Existe para rejogar com gabarito decorado
   * sem corromper o ranking: a sala valendo paga cada fã só na primeira jogada
   * dele, e o treino é para as seguintes. Não gravar nada aqui é o que impede
   * o treino de queimar a primeira vez valendo (o detector olha o banco).
   */
  treino: boolean;
  /**
   * Na sala VALENDO: quem JÁ jogou esta partida antes (palpite anterior no
   * banco) entra em modo treino individual — veredito normal, XP 0.
   * Decidido UMA vez por fã, no primeiro contato (`decidirPagamento`).
   */
  semXp: Set<string>;
  /** Fãs cuja decisão de pagamento já foi tomada (cache da consulta). */
  decididos: Set<string>;
  /**
   * Os FATOS do jogo no instante em que cada pergunta liquidou (minuto, placar,
   * escanteios). É a matéria-prima da explicação na tela de resultado — o
   * cliente redige o texto; aqui só se registra o que o feed dizia. Capturado
   * no emit porque `Question` não guarda o estado do jogo, só o veredito.
   */
  fatos: Map<string, FatosDaResolucao>;
  engine: QuestionEngine;
  runner: ReplayRunner;
  ports: EnginePorts;
  db: Db;
  cursor: ReplayCursor;
  /** O relógio DESTA sala — o mesmo que o motor usa. É ele que converte
   *  "quanto falta da janela" em ms REAIS para quem entra no meio do jogo. */
  clock: Clock;
  state: RoomState;
  subs: Set<Sub>;
  /**
   * O ranking DESTA sala: XP ganho nesta partida, por fã. Não é o global —
   * `users.xp` é a soma da vida inteira e entrar numa sala no segundo tempo não
   * pode parecer disputa perdida. Vive aqui, com a sala, e morre com ela.
   */
  xpDaSala: Map<string, number>;
  /**
   * O apelido de cada fã, como o motor o viu no palpite. É o ÚNICO nome que sai
   * daqui para o browser (E12: o e-mail nunca vira apelido, e o userId interno
   * não é da conta de terceiros).
   */
  apelidos: Map<string, string>;
  /** Timer da carência: sala vazia espera antes de morrer (um F5 não é adeus). */
  desligar: ReturnType<typeof setTimeout> | null;
  /** Quem desliga tudo quando o último fã sai ou o jogo acaba. */
  encerrar: () => void;
};

/** O que o jogo dizia quando a pergunta liquidou. null = o feed não contou. */
export type FatosDaResolucao = {
  minute: number | null;
  score: { p1: number; p2: number };
  /** Do Total acumulado; ausente ≠ zero (G7/A4) — null quando não veio. */
  corners: { p1: number; p2: number } | null;
};

const salas = new Map<string, Room>();
/** A promessa entra no Map ANTES do primeiro await: duas visitas simultâneas
 * compartilham a mesma criação, o mesmo runner e os mesmos questionIds. */
const salasEmCriacao = new Map<string, Promise<Room | null>>();

const ehScore = (ev: NormEvent): ev is ScoreEvent => ev.kind === 'score';

/**
 * O id da sala na URL: `18241006` (valendo) ou `treino-18241006` (treino).
 * Qualquer outra coisa é inválida — e a MESMA regra vale para o stream e para
 * o palpite, senão os dois abririam salas diferentes do mesmo id.
 */
export function parseRoomId(id: string): { fixtureId: number; treino: boolean } | null {
  const m = /^(treino-)?(\d+)$/.exec(id);
  if (!m) return null;
  return { fixtureId: Number(m[2]), treino: Boolean(m[1]) };
}

const chaveDaSala = (fixtureId: number, treino: boolean): string =>
  treino ? `treino-${fixtureId}` : String(fixtureId);

/**
 * Portas da sala de TREINO: interface idêntica, persistência NENHUMA.
 *
 * Não é preguiça — é a regra do treino inteira num lugar só: sem linhas em
 * `questions`/`predictions`, o treino (1) não queima a primeira jogada valendo
 * do fã (o detector consulta o banco), (2) não infla o aproveitamento do
 * perfil e (3) não deixa pergunta órfã em 'open' quando a sala morre no meio.
 * O motor continua vendo palpites normalmente: eles vivem na memória dele.
 */
function portsDeTreino(): EnginePorts {
  let n = 0;
  return {
    uid: (prefix) => `${prefix}_t${(++n).toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    savePrediction: () => {},
    saveBet: () => {},
    saveQuestion: () => {},
    saveMarket: () => {},
    flush: () => Promise.resolve(),
    flushDe: () => Promise.resolve(),
    pendentes: () => 0,
  };
}

async function criarSala(fixtureId: number, treino: boolean): Promise<Room | null> {
  const db = createDb();
  const fixture: Fixture | null = await createMatchRepo(db).findById(fixtureId);
  if (!fixture) {
    await db.close?.();
    return null;
  }
  const eventos = await createEventRepo(db).listReplayByFixture(fixtureId);
  if (!eventos.length) {
    await db.close?.();
    return null;
  }

  // A régua dos contadores é DESTA partida, então o filtro nasce com a sala.
  const ehLance = criarFiltroDeLances();
  // Treino não persiste NADA (ver portsDeTreino); valendo grava no Postgres.
  const ports = treino ? portsDeTreino() : createEnginePorts(db);
  const cursor: ReplayCursor = { matchTs: eventos[0]!.ts, realAt: Date.now() };
  const clock = cursorClock(cursor, REPLAY_SPEED);
  const kickoff = eventos.find((e) => e.action === 'kickoff') ?? eventos[0]!;

  const state: RoomState = {
    fixtureId,
    teamA: fixture.p1,
    teamB: fixture.p2,
    source: (fixture as { cacheSource?: string }).cacheSource ?? 'txline-cache',
    score: { p1: 0, p2: 0 },
    minute: null,
    clockSeconds: null,
    replaySpeed: REPLAY_SPEED,
    finished: false,
    questions: [],
    feed: [],
    totals: { p1: {}, p2: {} },
  };

  const sala: Room = {
    fixtureId,
    treino,
    semXp: new Set(),
    decididos: new Set(),
    fatos: new Map(),
    db,
    ports,
    cursor,
    clock,
    state,
    subs: new Set(),
    xpDaSala: new Map(),
    apelidos: new Map(),
    desligar: null,
    engine: null as unknown as QuestionEngine,
    runner: null as unknown as ReplayRunner,
    encerrar: () => {},
  };

  /**
   * Traduz uma mensagem do motor para o evento do §8 QUE ESTE FÃ deve receber.
   * `null` = não é da conta dele.
   */
  /** Este fã está sem pagamento nesta sala? (treino, ou valendo-já-jogado) */
  const semXpPara = (userId: string | null): boolean =>
    treino || (userId !== null && sala.semXp.has(userId));

  const paraOFa = (msg: RoomMessage, userId: string | null): RoomMessage | null => {
    const ts = cursor.matchTs;

    if (msg.type === 'question_open') {
      const q = msg.question as Question;
      return {
        type: 'question_open',
        ts,
        questionId: q.id,
        // O TIPO da pergunta (next_goal/hilo_corners/final_result). A tela usa
        // como rótulo do card. Vai como `qtype` porque `type` já é o nome do
        // EVENTO no envelope do §8 — dois `type` no mesmo objeto é confusão
        // garantida na primeira leitura.
        qtype: q.type,
        prompt: q.prompt,
        // `pct` vem do OddsExplainer, que esta sala ainda não roda. null é a
        // leitura honesta e é a MESMA do G8 ("a TxLINE não mandou preço"):
        // quem renderizar `?? 0` inventa "a chance caiu pra zero".
        options: q.options.map((o) => ({ id: o.id, label: o.label, pct: null })),
        // Quanto vale, do próprio motor — nunca uma tabela copiada aqui.
        // É o PISO: quem palpita na primeira metade da janela leva 1.5x, e o
        // resultado revela o valor real. Piso não é mentira; número inventado é.
        // Para quem está SEM pagamento (treino/já jogou), o piso honesto é 0.
        xp: semXpPara(userId) ? 0 : (XP_BASE[q.type as keyof typeof XP_BASE] ?? 0),
        closesAt: q.closesAt,
        closesInRealMs: msg.closesInRealMs as number,
      };
    }

    if (msg.type === 'question_closed') {
      return { type: 'question_closed', ts, questionId: msg.questionId as string };
    }

    if (msg.type === 'question_resolved') {
      const q = msg.question as Question;
      const results = (msg.results ?? []) as { userId: string; awardedXp: number }[];
      const meu = userId ? results.find((r) => r.userId === userId) : undefined;
      return {
        type: 'question_resolved',
        ts,
        questionId: q.id,
        correctOptionId: q.correct,
        // Os RÓTULOS das opções e os fatos do instante: é com eles que a tela
        // diz "Você: England · Certo: Argentina — gol aos 63’". Sem os rótulos
        // o resultado falava por id; sem os fatos, não explicava nada.
        options: q.options.map((o) => ({ id: o.id, label: o.label })),
        facts: sala.fatos.get(q.id) ?? null,
        qtype: q.type,
        // Sem palpite meu, `gained` é 0 — e é verdade: não ganhei nada.
        gained: meu?.awardedXp ?? 0,
      };
    }

    if (msg.type === 'question_void') {
      const q = msg.question as Question;
      return {
        type: 'question_void',
        ts,
        questionId: q.id,
        reason: msg.reason as string,
        options: q.options.map((o) => ({ id: o.id, label: o.label })),
        facts: sala.fatos.get(q.id) ?? null,
        qtype: q.type,
      };
    }

    if (msg.type === 'game_end') {
      return { type: 'game_end', ts, scoreA: state.score.p1, scoreB: state.score.p2 };
    }

    // `log` e o que mais o motor emitir para si mesmo não é evento de fã.
    return null;
  };

  const publicar = (msg: RoomMessage) => {
    for (const sub of sala.subs) {
      const dele = paraOFa(msg, sub.userId);
      if (!dele) continue;
      try {
        sub.enviar(dele);
      } catch {
        // Um assinante morto não pode derrubar a sala dos outros.
      }
    }
  };

  /** Eventos que já nascem no formato do §8 e são iguais para todo mundo. */
  const publicarBruto = (msg: RoomMessage) => {
    for (const sub of sala.subs) {
      try {
        sub.enviar(msg);
      } catch {
        // idem
      }
    }
  };

  /**
   * Acumula no ranking da sala o que o MOTOR pagou. `awardedXp` é o veredito
   * dele — aqui não se recalcula nada: recontar o bônus de velocidade a partir
   * do `result` daria uma segunda tabela de XP, e duas tabelas divergem.
   *
   * Anulada (`void`) também entra, com 0: quem palpitou está na sala e some do
   * ranking seria mentira por omissão. 0 XP é a verdade, não é ausência.
   */
  const registrarNoRanking = (results: ResolvedResult[]) => {
    for (const r of results) {
      sala.xpDaSala.set(r.userId, (sala.xpDaSala.get(r.userId) ?? 0) + r.awardedXp);
      // O motor manda '' quando o fã ainda não escolheu apelido (paraCore não
      // coage NULL) e '?' quando não achou o fã. Nenhum dos dois pode APAGAR um
      // apelido que já conhecíamos — e nenhum dos dois vira nome na tela.
      if (r.handle && r.handle !== '?') sala.apelidos.set(r.userId, r.handle);
    }
  };

  /** O ranking, por assinante — porque `me` é escrito na primeira pessoa (§8). */
  const publicarRanking = () => {
    for (const sub of sala.subs) {
      try {
        sub.enviar(rankingDaSala(sala, sub.userId));
      } catch {
        // idem
      }
    }
  };

  sala.engine = new QuestionEngine({
    fixture,
    clock,
    ports,
    // Quem NÃO é pago: a sala de treino inteira, ou (na valendo) o fã que já
    // jogou esta partida antes. O motor dá o veredito normal e paga 0 — uma
    // tabela de pagamento, um pagador.
    pagaXp: treino ? () => false : (userId) => !sala.semXp.has(userId),
    emit: (msg) => {
      // O core NÃO conhece a porta saveQuestion (o contrato dele tem só
      // uid/savePrediction/saveBet). Sem gravar a pergunta aqui, o primeiro
      // palpite estoura FK: predictions referencia questions.
      //
      // E tem que gravar de novo ao RESOLVER/ANULAR. Gravar só na abertura
      // deixava `questions.state` em 'open' para sempre: medido, 101 perguntas
      // no banco e nenhuma fora de 'open', com a partida terminada e os palpites
      // já liquidados. O `correct` e o `voidReason` também nunca chegavam. Quem
      // lesse a tabela veria uma partida inteira "em aberto" — e é dela que o
      // ranking e o histórico vão sair.
      if (msg.question && (msg.type === 'question_open' || msg.type === 'question_resolved' || msg.type === 'question_void')) {
        ports.saveQuestion(msg.question as Question);
      }
      if (msg.type === 'game_end') state.finished = true;
      state.questions = sala.engine.allQuestions();
      // O ranking se move ANTES de o evento sair: quem receber o
      // `question_resolved` e pedir o ranking no mesmo tick tem que ver o XP
      // que acabou de ganhar já contado.
      if (msg.type === 'question_resolved' || msg.type === 'question_void') {
        registrarNoRanking((msg.results ?? []) as ResolvedResult[]);
        // Os FATOS do instante da liquidação — é deles que a tela redige a
        // explicação ("gol aos 63’ — 1×0"). Escanteio sai do Total acumulado;
        // sem a chave, null (ausente ≠ zero, G7/A4 — não se inventa 0×0).
        const c1 = state.totals.p1.Corners;
        const c2 = state.totals.p2.Corners;
        sala.fatos.set((msg.question as Question).id, {
          minute: state.minute,
          score: { ...state.score },
          corners: c1 !== undefined || c2 !== undefined ? { p1: c1 ?? 0, p2: c2 ?? 0 } : null,
        });
      }
      publicar(msg);
      if (msg.type === 'question_resolved' || msg.type === 'question_void') {
        publicarRanking();
      }
    },
  });

  sala.runner = new ReplayRunner(
    eventos,
    REPLAY_SPEED,
    (ev) => {
      // A ÂNCORA. Tem que ser atualizada ANTES de o motor rodar: é ela que
      // define o "agora" da partida para abrir e fechar janelas.
      cursor.matchTs = ev.ts;
      cursor.realAt = Date.now();

      if (!ehScore(ev)) return;
      sala.engine.onScoreEvent(ev);

      // `hasScore` NÃO basta para mover o placar, e a diferença é a distância
      // entre 1 × 2 e 0 × 0 no meio do jogo.
      //
      // Medido nesta partida: 23 dos 47 eventos com `hasScore: true` trazem o
      // bloco `Total` SEM a chave `Goals` — e, sem a chave, `ev.goals` vem
      // {0,0} de placeholder. As chaves entram no Total DURANTE o jogo (a de
      // `Goals` só aparece no 1º gol, seq 539); antes disso o Total vem vazio.
      //
      // Aqui o A4 entra pela porta do G7: dentro do Total, chave ausente É zero
      // (G7) — mas um Total que não fala de gols não está dizendo "0 a 0", está
      // calado. Confiar no `hasScore` sozinho faz o placar REGREDIR ao primeiro
      // evento pós-gol cujo Total não cite `Goals`.
      //
      // Nesta partida isso não acontece (depois do seq 539 a chave nunca mais
      // falta), e é por isso que o placar fecha 1 × 2. Isso é SORTE DESTA
      // PARTIDA, não garantia — e o France × England é outra partida. Só move o
      // placar quem realmente fala de gols.
      const falaDeGols =
        ev.totals?.p1?.Goals !== undefined || ev.totals?.p2?.Goals !== undefined;
      const mudou =
        ev.hasScore &&
        falaDeGols &&
        (ev.goals.p1 !== state.score.p1 || ev.goals.p2 !== state.score.p2);
      if (mudou) state.score = { p1: ev.goals.p1, p2: ev.goals.p2 };
      if (typeof ev.clockSeconds === 'number') {
        state.minute = Math.floor(ev.clockSeconds / 60);
        state.clockSeconds = ev.clockSeconds;
      }

      // Os totais só valem com o bloco Score (A4): sem ele não há Total nenhum,
      // e sobrescrever aqui zeraria a aba inteira num evento de lineup.
      //
      // MERGE por chave, nunca `state.totals = ev.totals`. As chaves entram no
      // Total ao longo do jogo, não no apito: medido nesta partida, `Goals` só
      // aparece no 1º gol (seq 539) — dos 47 eventos com Score, 24 têm `Goals`,
      // 46 têm `Corners` e o primeiro (seq 76) traz o Total VAZIO. Trocar o mapa
      // inteiro faria a linha de Gols piscar e sumir a cada evento que não a
      // trouxesse: é o G7 na tela ("chave ausente = zero → linhas somem"). Como
      // são contadores acumulados do feed (medido: zero regressões), a última
      // leitura de cada chave é a verdade dela.
      if (ev.hasScore && ev.totals) {
        state.totals = {
          p1: { ...state.totals.p1, ...ev.totals.p1 },
          p2: { ...state.totals.p2, ...ev.totals.p2 },
        };
      }

      if (ehLance(ev, mudou)) {
        const lance = {
          minute: state.minute,
          action: ev.action,
          goals: mudou ? { ...state.score } : null,
        };
        state.feed.unshift(lance);
        if (state.feed.length > 40) state.feed.pop();
        publicarBruto({
          type: 'score_event',
          ts: ev.ts,
          minute: state.minute,
          // A âncora nova do relógio da tela — null quando ESTE evento não
          // trouxe relógio (a âncora anterior continua valendo lá).
          clockSeconds: typeof ev.clockSeconds === 'number' ? ev.clockSeconds : null,
          // Ausente NAO e zero (A4): so mando placar quando o bloco Score veio.
          // null diz "nao mudou"; quem renderizar `?? 0` da gol fantasma.
          scoreA: mudou ? state.score.p1 : null,
          scoreB: mudou ? state.score.p2 : null,
          lance,
          // O ACUMULADO inteiro, não o delta — e é de propósito. Todo evento que
          // mexe nos totais nesta partida também vira lance (medido: 0 exceções),
          // mas se um dia não virar, o snapshot seguinte conserta a tela sozinho.
          // Delta perdido no caminho ficaria errado para sempre.
          totals: state.totals,
        });
      }
    },
    () => {
      state.finished = true;
      publicarBruto({ type: 'replay_done', ts: cursor.matchTs, source: state.source });
    },
  );

  sala.encerrar = () => {
    if (sala.desligar) clearTimeout(sala.desligar);
    sala.desligar = null;
    sala.runner.stop();
    salas.delete(chaveDaSala(fixtureId, treino));
    void ports.flush().catch(() => {}).finally(() => void db.close?.());
  };

  sala.runner.start();
  salas.set(chaveDaSala(fixtureId, treino), sala);
  return sala;
}

/** A sala desta partida, criando-a (e dando o apito inicial) na primeira visita. */
export async function abrirSala(fixtureId: number, treino = false): Promise<Room | null> {
  const chave = chaveDaSala(fixtureId, treino);
  const aberta = salas.get(chave);
  if (aberta) return aberta;

  const existente = salasEmCriacao.get(chave);
  if (existente) return existente;

  const criacao = criarSala(fixtureId, treino).finally(() => {
    if (salasEmCriacao.get(chave) === criacao) salasEmCriacao.delete(chave);
  });
  salasEmCriacao.set(chave, criacao);
  return criacao;
}

/**
 * Decide, UMA vez por fã por sala, se os palpites dele nesta sala pagam XP.
 *
 * Sala de treino: ninguém é pago, não há o que decidir. Sala valendo: quem já
 * tem palpite desta partida no banco (jogou antes, em qualquer rodada) entra em
 * `semXp` — o gabarito decorado não vale ranking; a primeira jogada de cada fã
 * segue pagando normal. Roda no PRIMEIRO contato (join do stream e/ou primeiro
 * palpite), sempre ANTES do primeiro `place` da rodada — por isso a consulta
 * não precisa excluir a rodada corrente: os palpites dela ainda não existem.
 */
export async function decidirPagamento(sala: Room, userId: string): Promise<void> {
  if (sala.treino || sala.decididos.has(userId)) return;
  sala.decididos.add(userId);
  try {
    const jaJogou = await createPredictionRepo(sala.db).temPalpiteNaFixture(
      userId,
      sala.fixtureId,
    );
    if (jaJogou) sala.semXp.add(userId);
  } catch {
    // Banco fora na decisão: o fã fica como pagante (o caminho normal). Errar
    // para o lado do fã honesto é melhor que negar XP à primeira jogada por
    // causa de um soluço de rede — e o farm exige o banco de pé de todo jeito.
    sala.decididos.delete(userId);
  }
}

/** Uma pergunta no formato do §8, com o prazo já convertido em ms REAIS. */
function perguntaDoPacote(sala: Room, q: Question, semXp: boolean) {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    // `pct: null` = o explicador de odds não roda nesta sala (G8: ausente ≠ 0%).
    options: q.options.map((o) => ({ id: o.id, label: o.label, pct: null })),
    // O PISO do XP, do próprio motor — a mesma régua do question_open.
    // Sem pagamento (treino/já jogou), o piso honesto é 0.
    xp: semXp ? 0 : (XP_BASE[q.type as keyof typeof XP_BASE] ?? 0),
    state: q.state,
    closesAt: q.closesAt,
    // Quanto falta DE VERDADE, pelo relógio da sala. O primeiro pacote mandava
    // a pergunta sem prazo e a tela chutava 60s — um contador inventado em cima
    // de uma janela real. Fechada, falta zero: o que se espera é o LANCE.
    closesInRealMs:
      q.state === 'open'
        ? Math.max(0, sala.clock.toRealMs(Math.max(0, q.closesAt - sala.clock.now())))
        : 0,
  };
}

/**
 * O primeiro pacote da sala NA VOZ DESTE FÃ — estado do jogo + o que ELE já
 * respondeu + o que os palpites dele já renderam.
 *
 * Existe porque um F5 derruba a tela, não o palpite: sem `minhas`/`resultados`,
 * o recibo e o histórico viviam só no estado do React e morriam no reload — o
 * fã via a pergunta aberta de novo, tocava, e ouvia "você já palpitou". O motor
 * sempre soube; o pacote é que não contava.
 */
export function estadoDaSalaPara(sala: Room, userId: string | null): RoomMessage {
  const respostas = userId ? sala.engine.respostasDe(userId) : [];
  const minhasPorId = new Set(respostas.map((r) => r.question.id));
  const semXp = sala.treino || (userId !== null && sala.semXp.has(userId));

  // Abertas para todo mundo — mais as FECHADAS em que este fã palpitou: o card
  // "janela fechada · aguardando o lance" tem que renascer no F5.
  const questions = sala.engine
    .allQuestions()
    .filter((q) => q.state === 'open' || (q.state === 'closed' && minhasPorId.has(q.id)))
    .map((q) => perguntaDoPacote(sala, q, semXp));

  const minhas = respostas
    .filter((r) => r.question.state === 'open' || r.question.state === 'closed')
    .map((r) => ({ questionId: r.question.id, choice: r.prediction.choice }));

  // O que já liquidou, mais recente primeiro — a ordem em que a aba mostra.
  const resultados = respostas
    .filter((r) => r.question.state === 'resolved' || r.question.state === 'void')
    .sort((a, b) => (b.question.resolvedAt ?? 0) - (a.question.resolvedAt ?? 0))
    .map((r) => ({
      questionId: r.question.id,
      prompt: r.question.prompt,
      qtype: r.question.type,
      correctOptionId: r.question.correct,
      voidReason: r.question.voidReason,
      // O XP que o MOTOR pagou a ele — nunca recalculado aqui (duas tabelas divergem).
      gained: r.prediction.awardedXp ?? 0,
      choice: r.prediction.choice,
      // Rótulos e fatos: o F5 não pode rebaixar o histórico a ids sem explicação.
      options: r.question.options.map((o) => ({ id: o.id, label: o.label })),
      facts: sala.fatos.get(r.question.id) ?? null,
    }));

  return {
    type: 'room_state',
    ts: sala.cursor.matchTs,
    state: { ...sala.state, questions },
    minhas,
    resultados,
    // NA VOZ DESTE FÃ: os palpites dele aqui valem XP? `treinoDaSala` separa
    // "sala de treino" de "você já jogou esta partida" — o aviso é outro.
    treino: semXp,
    treinoDaSala: sala.treino,
  };
}

/**
 * O apelido FRESCO do banco, registrado na entrada. Sem isto o ranking só
 * aprendia o nome quando uma pergunta resolvia (`ResolvedResult.handle`) — quem
 * escolheu o apelido depois do primeiro palpite ficava "sem apelido" na sala
 * até o próximo lance liquidar. Vazio não apaga o que já se sabia.
 */
export function registrarApelido(sala: Room, userId: string, handle: string | null): void {
  if (handle) sala.apelidos.set(userId, handle);
}

/**
 * O ranking desta sala NA VOZ DESTE FÃ — o evento `ranking` do §8.
 *
 * Repare no que NÃO atravessa: o `userId` interno. Ele é a chave da conta de
 * outra pessoa e o browser não tem o que fazer com ele; a única coisa que o fã
 * precisa saber sobre os outros é o apelido (que é público de propósito) e o XP.
 * `me` é calculado aqui, por assinante, pelo mesmo motivo que o `gained` do
 * `question_resolved`: o contrato é escrito na primeira pessoa.
 *
 * `name: ''` diz "ainda não escolheu apelido" e é a leitura HONESTA — quem
 * renderizar tem que dizer isso ao fã. Inventar um nome aqui (ou, pior, sacar um
 * do e-mail) é o E12 com outra roupa.
 */
export function rankingDaSala(sala: Room, userId: string | null): RoomMessage {
  const rows = [...sala.xpDaSala.entries()]
    .map(([id, xp]) => ({
      name: sala.apelidos.get(id) ?? '',
      xp,
      me: userId !== null && id === userId,
    }))
    // Empate mantém quem pontuou primeiro na frente: o sort do JS é estável e o
    // Map itera na ordem de inserção.
    .sort((a, b) => b.xp - a.xp);
  return { type: 'ranking', ts: sala.cursor.matchTs, rows };
}

/**
 * Carência antes de derrubar a sala vazia. Sem ela, um F5 mata a sala entre o
 * unsubscribe e o subscribe seguinte — e a partida RECOMEÇA do minuto zero, com
 * perguntas novas. Pior: o palpite que o fã acabou de dar aponta para um
 * questionId que não existe mais, e ele ouve "pergunta não existe". Medido.
 */
const CARENCIA_MS = 30_000;

export function assinar(sala: Room, sub: Sub): () => void {
  sala.subs.add(sub);
  if (sala.desligar) {
    clearTimeout(sala.desligar);
    sala.desligar = null;
  }
  return () => {
    sala.subs.delete(sub);
    // Sala sem ninguém não fica queimando timer e conexão de banco — mas espera
    // um pouco: quase sempre é um reload, não um adeus.
    if (sala.subs.size === 0 && !sala.desligar) {
      sala.desligar = setTimeout(() => {
        if (sala.subs.size === 0) sala.encerrar();
      }, CARENCIA_MS);
    }
  };
}

/** O palpite. Devolve o veredito do MOTOR — a tela não decide nada. */
export async function palpitar(
  sala: Room,
  user: User,
  questionId: string,
  choice: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // ANTES do place: a decisão de pagamento tem que existir quando a pergunta
  // resolver — e um curl que palpita sem nunca ter aberto o stream não pode
  // escapar dela (seria o farm entrando pela porta dos fundos).
  await decidirPagamento(sala, user.id);
  const r = sala.engine.place(user, questionId, choice);
  if (!r.ok) return r;
  // `place` devolve ok ANTES de o INSERT terminar (as portas são
  // fire-and-forget). Sem esperar, o fã ouve "palpite registrado" e o palpite
  // pode não existir — mentir para o torcedor é pior que dar erro.
  //
  // `flushDe` e não `flush`: o flush genérico julga a sala INTEIRA e entrega o
  // erro do primeiro que falhou a quem chamar primeiro. Numa sala com vários
  // fãs — que é o caso do France × England — isso faz um levar 500 pelo palpite
  // do outro. Cada um espera pelo SEU.
  await sala.ports.flushDe(r.prediction.id);
  return { ok: true };
}
