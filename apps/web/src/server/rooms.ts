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

import { QuestionEngine, XP_BASE, cursorClock, type ReplayCursor } from '@palpitei/core';
import type { Fixture, NormEvent, Question, RoomMessage, ScoreEvent, User } from '@palpitei/core';
import { ReplayRunner } from '@palpitei/txline';
import { createDb, createEnginePorts, createEventRepo, createMatchRepo } from '@palpitei/db';
import type { Db, EnginePorts } from '@palpitei/db';
import { criarFiltroDeLances } from './lances';

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
  finished: boolean;
  questions: Question[];
  feed: { minute: number | null; action: string; goals: { p1: number; p2: number } | null }[];
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
  engine: QuestionEngine;
  runner: ReplayRunner;
  ports: EnginePorts;
  db: Db;
  cursor: ReplayCursor;
  state: RoomState;
  subs: Set<Sub>;
  /** Timer da carência: sala vazia espera antes de morrer (um F5 não é adeus). */
  desligar: ReturnType<typeof setTimeout> | null;
  /** Quem desliga tudo quando o último fã sai ou o jogo acaba. */
  encerrar: () => void;
};

const salas = new Map<number, Room>();

const ehScore = (ev: NormEvent): ev is ScoreEvent => ev.kind === 'score';

async function criarSala(fixtureId: number): Promise<Room | null> {
  const db = createDb();
  const fixture: Fixture | null = await createMatchRepo(db).findById(fixtureId);
  if (!fixture) {
    await db.close?.();
    return null;
  }
  const eventos = await createEventRepo(db).listByFixture(fixtureId);
  if (!eventos.length) {
    await db.close?.();
    return null;
  }

  // A régua dos contadores é DESTA partida, então o filtro nasce com a sala.
  const ehLance = criarFiltroDeLances();
  const ports = createEnginePorts(db);
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
    finished: false,
    questions: [],
    feed: [],
  };

  const sala: Room = {
    fixtureId,
    db,
    ports,
    cursor,
    state,
    subs: new Set(),
    desligar: null,
    engine: null as unknown as QuestionEngine,
    runner: null as unknown as ReplayRunner,
    encerrar: () => {},
  };

  /**
   * Traduz uma mensagem do motor para o evento do §8 QUE ESTE FÃ deve receber.
   * `null` = não é da conta dele.
   */
  const paraOFa = (msg: RoomMessage, userId: string | null): RoomMessage | null => {
    const ts = cursor.matchTs;

    if (msg.type === 'question_open') {
      const q = msg.question as Question;
      return {
        type: 'question_open',
        ts,
        questionId: q.id,
        prompt: q.prompt,
        // `pct` vem do OddsExplainer, que esta sala ainda não roda. null é a
        // leitura honesta e é a MESMA do G8 ("a TxLINE não mandou preço"):
        // quem renderizar `?? 0` inventa "a chance caiu pra zero".
        options: q.options.map((o) => ({ id: o.id, label: o.label, pct: null })),
        // Quanto vale, do próprio motor — nunca uma tabela copiada aqui.
        // É o PISO: quem palpita na primeira metade da janela leva 1.5x, e o
        // resultado revela o valor real. Piso não é mentira; número inventado é.
        xp: XP_BASE[q.type as keyof typeof XP_BASE] ?? 0,
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
        // Sem palpite meu, `gained` é 0 — e é verdade: não ganhei nada.
        gained: meu?.awardedXp ?? 0,
      };
    }

    if (msg.type === 'question_void') {
      const q = msg.question as Question;
      return { type: 'question_void', ts, questionId: q.id, reason: msg.reason as string };
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

  sala.engine = new QuestionEngine({
    fixture,
    clock,
    ports,
    emit: (msg) => {
      // O core NÃO conhece a porta saveQuestion (o contrato dele tem só
      // uid/savePrediction/saveBet). Sem gravar a pergunta aqui, o primeiro
      // palpite estoura FK: predictions referencia questions.
      if (msg.type === 'question_open' && msg.question) {
        ports.saveQuestion(msg.question as Question);
      }
      if (msg.type === 'game_end') state.finished = true;
      state.questions = sala.engine.allQuestions();
      publicar(msg);
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

      const mudou = ev.hasScore && (ev.goals.p1 !== state.score.p1 || ev.goals.p2 !== state.score.p2);
      if (mudou) state.score = { p1: ev.goals.p1, p2: ev.goals.p2 };
      if (typeof ev.clockSeconds === 'number') state.minute = Math.floor(ev.clockSeconds / 60);

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
          // Ausente NAO e zero (A4): so mando placar quando o bloco Score veio.
          // null diz "nao mudou"; quem renderizar `?? 0` da gol fantasma.
          scoreA: mudou ? state.score.p1 : null,
          scoreB: mudou ? state.score.p2 : null,
          lance,
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
    salas.delete(fixtureId);
    void ports.flush().catch(() => {}).finally(() => void db.close?.());
  };

  sala.runner.start();
  salas.set(fixtureId, sala);
  return sala;
}

/** A sala desta partida, criando-a (e dando o apito inicial) na primeira visita. */
export async function abrirSala(fixtureId: number): Promise<Room | null> {
  return salas.get(fixtureId) ?? (await criarSala(fixtureId));
}

export function estadoDaSala(sala: Room): RoomState {
  return { ...sala.state, questions: sala.engine.openQuestions() };
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
  const r = sala.engine.place(user, questionId, choice);
  if (!r.ok) return r;
  // `place` devolve ok ANTES de o INSERT terminar (as portas são
  // fire-and-forget). Sem este flush o fã ouve "palpite registrado" e o palpite
  // pode não existir — mentir para o torcedor é pior que dar erro.
  await sala.ports.flush();
  return { ok: true };
}
