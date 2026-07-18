/** Sala autoritativa: o servidor ancora o relógio no feed e decide XP. */

import {
  OddsExplainer,
  QuestionEngine,
  XP_BASE,
  cursorClock,
  type Clock,
  type ReplayCursor,
} from '@palpitei/core';
import type {
  Fixture,
  NormEvent,
  OddsEvent,
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
  createLobbyRepo,
  createMatchRepo,
  createOddsRepo,
} from '@palpitei/db';
import type { Db, EnginePorts } from '@palpitei/db';
import { criarDedupeDeKickoff, criarFiltroDeLances } from './lances';
import { assinarCanalAoVivo, fixtureTemCanalAoVivo } from './live';
import {
  atualizarPct1x2,
  mesclarLinhaDoTempo,
  registrarLeitura,
  type LeituraDeChance,
  type Pct1x2,
} from './chances';
import { createDb } from './db';
import { resetLobby } from './lobbies';
import { chaveDaSala, politicaDaSala } from './room-id';
import {
  WATCHDOG_MARGIN_MS,
  agendarEncerramentoSeVazia,
  agendarLimpezaFinal,
  cancelarEncerramento,
} from './room-lifecycle';

export { chaveDaSala, parsePartyId, parseRoomId } from './room-id';

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
  /** Segundos de jogo do último evento com relógio; o cliente interpola a partir daqui. */
  clockSeconds: number | null;
  /** Minutos de jogo por segundo real (12 no replay padrão; 1 ao vivo). */
  replaySpeed: number;
  /** Último relógio REAL conhecido na timeline; a UI nunca interpola além. */
  clockMaxSeconds: number | null;
  finished: boolean;
  questions: Question[];
  feed: { minute: number | null; action: string; goals: { p1: number; p2: number } | null }[];
  /** Totais acumulados por chave do feed; chaves ausentes não viram zero. */
  totals: { p1: Record<string, number>; p2: Record<string, number> };
  /** Leituras de odds emitidas, da mais recente para a mais antiga (cap 60). */
  chances: LeituraDeChance[];
};

/** Assinante individual; mensagens personalizadas não expõem resultados alheios. */
type Sub = { userId: string | null; enviar: (msg: RoomMessage) => void };

type Room = {
  fixtureId: number;
  /** Código do grupo: dois convites da mesma fixture nunca compartilham runner. */
  partyId: string;
  /** Treino não persiste nem concede XP. */
  treino: boolean;
  /** Fatos do feed no instante da liquidação, usados pela explicação da UI. */
  fatos: Map<string, FatosDaResolucao>;
  /** Último 1X2 por opção; ausência permanece `null` na UI. */
  pct1x2: Pct1x2;
  engine: QuestionEngine;
  /** null na sala AO VIVO: o alimentador é o canal (live.ts), não o runner. */
  runner: ReplayRunner | null;
  ports: EnginePorts;
  db: Db;
  cursor: ReplayCursor;
  /** Relógio usado pelo motor e para converter prazos para tempo real. */
  clock: Clock;
  state: RoomState;
  subs: Set<Sub>;
  /** XP desta sala, não o acumulado global do fã. */
  xpDaSala: Map<string, number>;
  /** Apelidos públicos; e-mail e identificadores internos não saem para a UI. */
  apelidos: Map<string, string>;
  /** Timer da carência: sala vazia espera antes de morrer (um F5 não é adeus). */
  desligar: ReturnType<typeof setTimeout> | null;
  /** Limite contra timer adormecido/processo zumbi. */
  watchdog: ReturnType<typeof setTimeout> | null;
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
/** Promessas em voo evitam duas criações simultâneas da mesma sala. */
const salasEmCriacao = new Map<string, Promise<Room | null>>();

const ehScore = (ev: NormEvent): ev is ScoreEvent => ev.kind === 'score';

/** Portas de treino: exercitam o motor sem persistir perguntas, palpites ou XP. */
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

async function criarSala(fixtureId: number, treino: boolean, partyId: string): Promise<Room | null> {
  const db = createDb();

  // O canal ativo, não a env crua, decide entre ingestão ao vivo e replay.
  const aoVivo = fixtureTemCanalAoVivo(fixtureId);

  // Assina antes da leitura para não perder eventos entre o snapshot e o catch-up.
  const bufferDoCatchUp: NormEvent[] = [];
  let entregar: (ev: NormEvent) => void = (ev) => bufferDoCatchUp.push(ev);
  const desassinar = aoVivo ? assinarCanalAoVivo(fixtureId, (ev) => entregar(ev)) : null;

  const fixture: Fixture | null = await createMatchRepo(db).findById(fixtureId);
  if (!fixture) {
    desassinar?.();
    await db.close?.();
    return null;
  }
  const eventos = await createEventRepo(db).listReplayByFixture(fixtureId);
  // Replay sem timeline é inválido; ao vivo pode começar sem eventos.
  if (!eventos.length && !aoVivo) {
    await db.close?.();
    return null;
  }

  // Odds vêm da projeção normalizada; ausência de preço não é chance zero.
  const odds: OddsEvent[] = await createOddsRepo(db).listReplayByFixture(fixtureId);
  // No empate de timestamp, o lance precede a cotação para preservar o contexto.
  const linhaDoTempo = mesclarLinhaDoTempo(eventos, odds);

  const ehLance = criarFiltroDeLances();
  // A política centraliza a diferença entre treino e partidas valendo XP.
  const politica = politicaDaSala(treino);
  const ports = politica.persiste ? createEnginePorts(db) : portsDeTreino();
  // Ao vivo sem eventos usa o kickoff; o primeiro evento real reancora o relógio.
  const cursor: ReplayCursor = {
    matchTs: linhaDoTempo.length ? linhaDoTempo[0]!.ts : fixture.startTime ?? Date.now(),
    realAt: Date.now(),
  };
  // Partida ao vivo sempre usa velocidade 1, independente da env de replay.
  const clock = cursorClock(cursor, aoVivo ? 1 : REPLAY_SPEED);
  // Replay limita a interpolação ao último relógio recebido; ao vivo não tem teto.
  const clockMaxSeconds = eventos.reduce<number | null>(
    (max, event) => typeof event.clockSeconds === 'number' ? Math.max(max ?? 0, event.clockSeconds) : max,
    null,
  );

  const state: RoomState = {
    fixtureId,
    teamA: fixture.p1,
    teamB: fixture.p2,
    // O selo ao vivo não é herdado de um possível cache pós-jogo.
    source: aoVivo
      ? 'txline-live'
      : (fixture as { cacheSource?: string }).cacheSource ?? 'txline-cache',
    score: { p1: 0, p2: 0 },
    minute: null,
    clockSeconds: null,
    replaySpeed: aoVivo ? 1 : REPLAY_SPEED,
    clockMaxSeconds: aoVivo ? null : clockMaxSeconds,
    finished: false,
    questions: [],
    feed: [],
    totals: { p1: {}, p2: {} },
    chances: [],
  };

  const sala: Room = {
    fixtureId,
    partyId,
    treino,
    fatos: new Map(),
    pct1x2: {},
    db,
    ports,
    cursor,
    clock,
    state,
    subs: new Set(),
    xpDaSala: new Map(),
    apelidos: new Map(),
    desligar: null,
    watchdog: null,
    engine: null as unknown as QuestionEngine,
    runner: null,
    encerrar: () => {},
  };

  /** Traduz uma mensagem do motor para o evento visível a este fã. */
  /** Só a sala explicitamente marcada como treino fica sem pagamento. */
  const semXpPara = (): boolean => !politica.pagaXp;

  const paraOFa = (msg: RoomMessage, userId: string | null): RoomMessage | null => {
    const ts = cursor.matchTs;

    if (msg.type === 'question_open') {
      const q = msg.question as Question;
      return {
        type: 'question_open',
        ts,
        questionId: q.id,
        // `type` já identifica o evento SSE; o tipo da pergunta segue em `qtype`.
        qtype: q.type,
        prompt: q.prompt,
        // Só `final_result` usa 1X2; opção ainda não cotada segue `null`.
        options: q.options.map((o) => ({
          id: o.id,
          label: o.label,
          pct:
            q.type === 'final_result' ? sala.pct1x2[o.id as keyof Pct1x2] ?? null : null,
        })),
        // O piso de XP vem do motor; treino sempre anuncia zero.
        xp: semXpPara() ? 0 : (XP_BASE[q.type as keyof typeof XP_BASE] ?? 0),
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
        // A UI recebe rótulos e fatos, não somente identificadores.
        options: q.options.map((o) => ({ id: o.id, label: o.label })),
        facts: sala.fatos.get(q.id) ?? null,
        qtype: q.type,
        // Sem palpite deste fã, o ganho é zero.
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

    // Mensagens internas do motor não são eventos de fã.
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

  /** Eventos SSE compartilhados por todos os assinantes. */
  const publicarBruto = (msg: RoomMessage) => {
    for (const sub of sala.subs) {
      try {
        sub.enviar(msg);
      } catch {
        // idem
      }
    }
  };

  let encerramentoPublicado = false;
  const finalizarSala = () => {
    if (encerramentoPublicado) return;
    encerramentoPublicado = true;
    state.finished = true;
    if (sala.watchdog) clearTimeout(sala.watchdog);
    sala.watchdog = null;
    publicarBruto({ type: 'replay_done', ts: cursor.matchTs, source: state.source });
    // O servidor fecha o lobby mesmo sem a aba do anfitrião.
    void createLobbyRepo(db).markFinishedBySystem(partyId).catch(() => {});
    void ports.flush().catch(() => {});
    if (sala.subs.size === 0) agendarLimpezaFinal(sala);
  };

  /** O core define as emissões de chance; a sala as armazena e transmite. */
  const explicador = new OddsExplainer({
    fixture,
    emit: (msg) => {
      if (msg.type !== 'odds_explain') return;
      const leitura: LeituraDeChance = {
        id: `${String(msg.messageId ?? msg.ts)}:${String(msg.priceName)}`,
        ts: msg.ts as number,
        minute: state.minute,
        priceName: msg.priceName as string,
        fromPct: msg.fromPct as number,
        toPct: msg.toPct as number,
        // Texto é fallback; a UI prefere os campos estruturados para traduzir.
        text: msg.text as string,
      };
      // Omitir contexto é diferente de serializar um valor inexistente.
      if (msg.contextAction) leitura.contextAction = msg.contextAction as string;
      registrarLeitura(state.chances, leitura);
      publicarBruto({ type: 'odds_explain', ...leitura });
    },
  });

  /** Acumula o XP decidido pelo motor, sem recalcular bônus na camada de sala. */
  const registrarNoRanking = (results: ResolvedResult[]) => {
    for (const r of results) {
      sala.xpDaSala.set(r.userId, (sala.xpDaSala.get(r.userId) ?? 0) + r.awardedXp);
      // Valores sentinela não apagam nem viram apelido público.
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
    // Só treino não paga; persistência mantém idempotência por pergunta.
    pagaXp: () => politica.pagaXp,
    emit: (msg) => {
      // Persiste abertura e desfecho: predictions dependem da pergunta e o estado final é auditável.
      if (msg.question && (msg.type === 'question_open' || msg.type === 'question_resolved' || msg.type === 'question_void')) {
        ports.saveQuestion(msg.question as Question);
      }
      if (msg.type === 'game_end') state.finished = true;
      state.questions = sala.engine.allQuestions();
      // Atualiza o ranking antes de publicar a resolução.
      if (msg.type === 'question_resolved' || msg.type === 'question_void') {
        registrarNoRanking((msg.results ?? []) as ResolvedResult[]);
        // Fatos da liquidação usam totais acumulados; escanteios ausentes seguem `null`.
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
      // Ao vivo encerra pelo feed, mas conserva o contrato SSE `replay_done`.
      if (msg.type === 'game_end' && aoVivo) {
        finalizarSala();
        void createMatchRepo(db)
          .setState(fixtureId, 'finished')
          .catch((e) =>
            console.warn(`[sala ${fixtureId}] setState finished falhou:`, e?.message ?? e),
          );
      }
    },
  });

  /** Processa eventos de replay e ao vivo pelo mesmo caminho. */
  const processarEvento = (ev: NormEvent): void => {
    // Atualize a âncora antes do motor calcular janelas.
    cursor.matchTs = ev.ts;
    cursor.realAt = Date.now();

    // Odds atualizam chances, nunca placar, totais ou perguntas.
    if (ev.kind === 'odds') {
      atualizarPct1x2(sala.pct1x2, ev);
      explicador.onOddsEvent(ev);
      return;
    }

    if (!ehScore(ev)) return;
    sala.engine.onScoreEvent(ev);
    // O explicador guarda o último lance como contexto.
    explicador.onScoreEvent(ev);

    // `hasScore` sem `Goals` não informa 0–0: evite regredir o placar com placeholders.
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

    // Totais do feed são parciais: faça merge por chave e nunca sobrescreva o mapa.
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
        // Sem relógio neste evento, o cliente conserva a âncora anterior.
        clockSeconds: typeof ev.clockSeconds === 'number' ? ev.clockSeconds : null,
        // `null` indica placar não informado neste evento, não zero.
        scoreA: mudou ? state.score.p1 : null,
        scoreB: mudou ? state.score.p2 : null,
        lance,
        // Envia o acumulado para a UI se recuperar de qualquer evento perdido.
        totals: state.totals,
      });
    }
  };

  if (!aoVivo) {
    sala.runner = new ReplayRunner(linhaDoTempo, REPLAY_SPEED, processarEvento, () => {
      finalizarSala();
    });
  }

  sala.encerrar = () => {
    if (sala.desligar) clearTimeout(sala.desligar);
    sala.desligar = null;
    if (sala.watchdog) clearTimeout(sala.watchdog);
    sala.watchdog = null;
    sala.runner?.stop();
    desassinar?.();
    const key = chaveDaSala(fixtureId, treino, partyId);
    salas.delete(key);
    resetLobby(key);
    void ports.flush().catch(() => {}).finally(() => void db.close?.());
  };

  if (aoVivo) {
    // Reaplica o snapshot pelo mesmo handler e deduplica kickoff antes do catch-up.
    const ehKickoffDuplicado = criarDedupeDeKickoff();
    const aoEvento = (ev: NormEvent): void => {
      if (ev.kind === 'score' && ehKickoffDuplicado(ev)) return;
      processarEvento(ev);
    };
    for (const ev of linhaDoTempo) aoEvento(ev);
    // Eventos recebidos durante a leitura são deduplicados por seq/messageId.
    const ultimoSeq = eventos.length ? eventos[eventos.length - 1]!.seq : -1;
    const oddsVistas = new Set(odds.map((o) => o.messageId).filter(Boolean));
    for (const ev of bufferDoCatchUp) {
      if (ev.kind === 'score' && ev.seq <= ultimoSeq) continue;
      if (ev.kind === 'odds' && ev.messageId && oddsVistas.has(ev.messageId)) continue;
      aoEvento(ev);
    }
    bufferDoCatchUp.length = 0;
    // Após o catch-up, eventos do canal seguem direto ao handler.
    entregar = aoEvento;
  } else {
    const runner = sala.runner!;
    runner.start();
    sala.watchdog = setTimeout(
      () => runner.finishNow(),
      Math.max(30_000, runner.estimatedDurationMs + WATCHDOG_MARGIN_MS),
    );
  }
  salas.set(chaveDaSala(fixtureId, treino, partyId), sala);
  return sala;
}

/** A sala desta partida, criando-a (e dando o apito inicial) na primeira visita. */
export async function abrirSala(
  fixtureId: number,
  treino = false,
  partyId = 'PUBLIC',
): Promise<Room | null> {
  const chave = chaveDaSala(fixtureId, treino, partyId);
  const aberta = salas.get(chave);
  if (aberta) return aberta;

  const existente = salasEmCriacao.get(chave);
  if (existente) return existente;

  const criacao = criarSala(fixtureId, treino, partyId).finally(() => {
    if (salasEmCriacao.get(chave) === criacao) salasEmCriacao.delete(chave);
  });
  salasEmCriacao.set(chave, criacao);
  return criacao;
}

/** Serializa uma pergunta com prazo convertido para milissegundos reais. */
function perguntaDoPacote(sala: Room, q: Question, semXp: boolean) {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    // Só `final_result` recebe 1X2; ausência de cotação segue `null`.
    options: q.options.map((o) => ({
      id: o.id,
      label: o.label,
      pct: q.type === 'final_result' ? sala.pct1x2[o.id as keyof Pct1x2] ?? null : null,
    })),
    // O piso vem do motor; treino anuncia zero.
    xp: semXp ? 0 : (XP_BASE[q.type as keyof typeof XP_BASE] ?? 0),
    state: q.state,
    closesAt: q.closesAt,
    // Prazo calculado pelo relógio autoritativo; pergunta fechada tem zero restante.
    closesInRealMs:
      q.state === 'open'
        ? Math.max(0, sala.clock.toRealMs(Math.max(0, q.closesAt - sala.clock.now())))
        : 0,
  };
}

/** Primeiro pacote personalizado: estado, recibos e resultados deste fã. */
export function estadoDaSalaPara(sala: Room, userId: string | null): RoomMessage {
  const respostas = userId ? sala.engine.respostasDe(userId) : [];
  const minhasPorId = new Set(respostas.map((r) => r.question.id));
  const semXp = sala.treino;

  // Mantém também perguntas fechadas respondidas para restaurar o recibo após reload.
  const questions = sala.engine
    .allQuestions()
    .filter((q) => q.state === 'open' || (q.state === 'closed' && minhasPorId.has(q.id)))
    .map((q) => perguntaDoPacote(sala, q, semXp));

  const minhas = respostas
    .filter((r) => r.question.state === 'open' || r.question.state === 'closed')
    .map((r) => ({ questionId: r.question.id, choice: r.prediction.choice }));

  // Resultados já liquidados, do mais recente para o mais antigo.
  const resultados = respostas
    .filter((r) => r.question.state === 'resolved' || r.question.state === 'void')
    .sort((a, b) => (b.question.resolvedAt ?? 0) - (a.question.resolvedAt ?? 0))
    .map((r) => ({
      questionId: r.question.id,
      prompt: r.question.prompt,
      qtype: r.question.type,
      correctOptionId: r.question.correct,
      voidReason: r.question.voidReason,
      // XP é o valor decidido pelo motor, nunca recalculado nesta camada.
      gained: r.prediction.awardedXp ?? 0,
      choice: r.prediction.choice,
      // Inclui rótulos e fatos para restaurar uma explicação completa.
      options: r.question.options.map((o) => ({ id: o.id, label: o.label })),
      facts: sala.fatos.get(r.question.id) ?? null,
    }));

  return {
    type: 'room_state',
    ts: sala.cursor.matchTs,
    state: { ...sala.state, questions },
    minhas,
    resultados,
    // A política da sala é a fonte de verdade do modo de treino.
    treino: semXp,
  };
}

/** Registra o apelido atual sem sobrescrever um valor conhecido por vazio. */
export function registrarApelido(sala: Room, userId: string, handle: string | null): void {
  if (handle) sala.apelidos.set(userId, handle);
}

/** Ranking personalizado; apenas apelidos públicos e `me` saem para o navegador. */
export function rankingDaSala(sala: Room, userId: string | null): RoomMessage {
  const rows = [...sala.xpDaSala.entries()]
    .map(([id, xp]) => ({
      name: sala.apelidos.get(id) ?? '',
      xp,
      me: userId !== null && id === userId,
    }))
    // Empates preservam a ordem de entrada, graças ao sort estável e ao Map.
    .sort((a, b) => b.xp - a.xp);
  return { type: 'ranking', ts: sala.cursor.matchTs, rows };
}

/** Mantém uma sala vazia durante a carência para que reload não reinicie a partida. */
export function assinar(sala: Room, sub: Sub): () => void {
  sala.subs.add(sub);
  cancelarEncerramento(sala);
  return () => {
    sala.subs.delete(sub);
    // O runner drena a partida se ninguém reconectar durante a carência.
    agendarEncerramentoSeVazia(sala);
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
  // Aguarda a escrita deste palpite; `flushDe` não entrega ao fã o erro de outro.
  await sala.ports.flushDe(r.prediction.id);
  return { ok: true };
}
