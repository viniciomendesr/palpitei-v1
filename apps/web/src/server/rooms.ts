/** Authoritative room: server anchors time to the feed and decides XP. */

import { randomUUID } from 'node:crypto';
import {
  OddsExplainer,
  QuestionEngine,
  XP_BASE,
  cursorClock,
  type Clock,
  type QuestionEngineSnapshot,
  type QuestionTemplateRef,
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
  createGameSessionRepo,
  createLobbyRepo,
  createMatchRepo,
  createOddsRepo,
  createPredictionRepo,
  createQuestionTemplateRepo,
  createTrophyRepo,
} from '@palpitei/db';
import type { Db, EnginePorts } from '@palpitei/db';
import { createKickoffDeduper, createMatchEventFilter } from './lances';
import { assinarCanalAoVivo, garantirCanalAoVivo } from './live';
import {
  update1x2Percentages,
  mergeTimeline,
  recordChanceReading,
  type ChanceReading,
  type Pct1x2,
} from './chances';
import { createDb } from './db';
import { resetLobby } from './lobbies';
import { roomKey, roomPolicy } from './room-id';
import { roomMode, type RoomMode } from './room-mode';
import { canAwardDebutTrophy } from './trophy-rules';
import {
  WATCHDOG_MARGIN_MS,
  scheduleShutdownIfEmpty,
  scheduleFinishedRoomCleanup,
  cancelShutdown,
} from './room-lifecycle';

export { roomKey, parsePartyId, parseRoomId } from './room-id';

/** 60 game minutes per real second, matching the TxLINE configuration default. */
const REPLAY_SPEED = Number(process.env.REPLAY_SPEED ?? 60) || 60;

export type RoomState = {
  fixtureId: number;
  teamA: string;
  teamB: string;
  source: string;
  score: { p1: number; p2: number };
  /** Feed clock minute; `null` before kickoff. */
  minute: number | null;
  /** Game seconds from the latest clocked event; the client interpolates from this anchor. */
  clockSeconds: number | null;
  /** Game minutes per real second: standard replay is 12, live is 1. */
  replaySpeed: number;
  /** Last known timeline clock; UI must not interpolate beyond it. */
  clockMaxSeconds: number | null;
  finished: boolean;
  questions: Question[];
  feed: { minute: number | null; action: string; goals: { p1: number; p2: number } | null }[];
  /** Feed totals accumulated by key; missing keys never become zero. */
  totals: { p1: Record<string, number>; p2: Record<string, number> };
  /** Emitted odds readings, newest first, capped to 60. */
  chances: ChanceReading[];
};

/** Individual subscriber; personalized messages do not expose other users' results. */
type Sub = { userId: string | null; enviar: (msg: RoomMessage) => void };

type Room = {
  fixtureId: number;
  /** How the room was built. The debut trophy needs a genuinely live room. */
  mode: RoomMode;
  /** Party code keeps invitations for the same fixture on separate runners. */
  partyId: string;
  /** Training neither persists state nor awards XP. */
  training: boolean;
  /** Feed facts at settlement time, used by UI explanations. */
  fatos: Map<string, FatosDaResolucao>;
  /** Latest 1X2 value by option; missing values stay `null` in UI. */
  pct1x2: Pct1x2;
  engine: QuestionEngine;
  /** `null` for live rooms: the channel feeder, not the runner, supplies events. */
  runner: ReplayRunner | null;
  ports: EnginePorts;
  db: Db;
  cursor: ReplayCursor;
  /** Clock used by the engine and to convert deadlines to real time. */
  clock: Clock;
  state: RoomState;
  subs: Set<Sub>;
  /** XP for this room, not the user's global total. */
  xpDaSala: Map<string, number>;
  /** Public nicknames only; email and internal identifiers never reach UI. */
  apelidos: Map<string, string>;
  /** Grace-period timer keeps an empty room alive through a reload. */
  shutdownTimer: ReturnType<typeof setTimeout> | null;
  /** Guard against stalled timers and zombie processes. */
  watchdog: ReturnType<typeof setTimeout> | null;
  /** Cleans up when the last user leaves or the fixture ends. */
  close: () => void;
  /** Serialized execution checkpoint; no-op in training. */
  checkpoint: () => void;
  sessionId: string | null;
  lastScoreSeq: number | null;
  lastOddsTs: number | null;
  lastOddsMessageId: string | null;
};

type SnapshotDaSessao = {
  engine?: QuestionEngineSnapshot;
  room?: RoomState;
  cursor?: ReplayCursor;
  fatos?: [string, FatosDaResolucao][];
  xp?: [string, number][];
  apelidos?: [string, string][];
  pct1x2?: Pct1x2;
};

function objeto(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function snapshotDaSessao(value: Record<string, unknown>): SnapshotDaSessao | null {
  const snapshot = objeto(value);
  return snapshot as SnapshotDaSessao | null;
}

function templatesPorTipo(
  templates: { id: string; version: number; questionType: Question['type'] }[],
): Partial<Record<Question['type'], QuestionTemplateRef>> {
  const out: Partial<Record<Question['type'], QuestionTemplateRef>> = {};
  for (const template of templates) out[template.questionType] = { id: template.id, version: template.version };
  return out;
}

function templatesDoSnapshot(value: Record<string, unknown>): Partial<Record<Question['type'], QuestionTemplateRef>> {
  const out: Partial<Record<Question['type'], QuestionTemplateRef>> = {};
  for (const type of ['final_result', 'next_goal', 'hilo_corners'] as const) {
    const ref = objeto(value[type]);
    if (ref && typeof ref.id === 'string' && typeof ref.version === 'number' && Number.isInteger(ref.version) && ref.version > 0) {
      out[type] = { id: ref.id, version: ref.version };
    }
  }
  return out;
}

/** Game facts at question settlement; `null` means the feed did not provide them. */
export type FatosDaResolucao = {
  minute: number | null;
  score: { p1: number; p2: number };
  /** Derived from accumulated totals; `null` when the feed omitted the key. */
  corners: { p1: number; p2: number } | null;
};

const salas = new Map<string, Room>();
/** In-flight promises prevent concurrent creation of the same room. */
const salasEmCriacao = new Map<string, Promise<Room | null>>();

const ehScore = (ev: NormEvent): ev is ScoreEvent => ev.kind === 'score';

/** Training ports exercise the engine without persisting questions, predictions, or XP. */
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

async function createRoom(fixtureId: number, training: boolean, partyId: string): Promise<Room | null> {
  const db = createDb();
  // Policy centralizes the distinction between training and XP-bearing rooms.
  const politica = roomPolicy(training);

  // The active persisted channel, not raw environment configuration, selects live ingest or replay.
  const aoVivo = await garantirCanalAoVivo(fixtureId);

  // Subscribe before reading so events are not lost between snapshot and catch-up.
  const bufferDoCatchUp: NormEvent[] = [];
  let entregar: (ev: NormEvent) => void = (ev) => bufferDoCatchUp.push(ev);
  const desassinar = aoVivo ? assinarCanalAoVivo(fixtureId, (ev) => entregar(ev)) : null;

  const fixture: Fixture | null = await createMatchRepo(db).findById(fixtureId);
  if (!fixture) {
    desassinar?.();
    await db.close?.();
    return null;
  }
  // The party's own run decides whether a finished match is a replay or a result screen.
  const partySession = politica.persists
    ? await createGameSessionRepo(db).findLatestByParty(fixtureId, partyId, training)
    : null;
  const mode = roomMode({
    // `state` and `cacheSource` come from the repo row, not the core Fixture type.
    matchState: (fixture as { state?: string }).state,
    liveChannel: aoVivo,
    hasPartySession: Boolean(partySession),
  });
  /** Live and finished rooms share provenance and clock; only replay is rewound. */
  const liveLike = mode !== 'replay';

  const eventos = await createEventRepo(db).listReplayByFixture(fixtureId);
  // Replay requires a timeline; live rooms may begin before any event arrives,
  // and a finished room reads its state from the session snapshot.
  if (!eventos.length && mode === 'replay') {
    await db.close?.();
    return null;
  }

  // Odds use the normalized projection; a missing price is not zero probability.
  const odds: OddsEvent[] = await createOddsRepo(db).listReplayByFixture(fixtureId);
  // On timestamp ties, score events precede odds to preserve context.
  const linhaDoTempo = mergeTimeline(eventos, odds);

  const ehLance = createMatchEventFilter();
  // Sessions pin template versions so catalog changes cannot alter announced questions, XP, or settlement.
  const templatesAtivos = politica.persists && mode === 'live' ? await createQuestionTemplateRepo(db).listActive() : [];
  const templates = templatesPorTipo(templatesAtivos);
  const templateSet = Object.fromEntries(
    Object.entries(templates).map(([type, ref]) => [type, ref]),
  );
  const session = politica.persists && mode === 'live'
    ? await createGameSessionRepo(db).findOrCreateActive({
      fixtureId,
      partyId,
      treino: training,
      engineVersion: 'questions-v2',
      templateSet,
    })
    : null;
  // A finished room reopens the party's last run — it never opens a new one.
  const baseSession = session ?? (mode === 'finished' ? partySession : null);
  const templatesFixados = baseSession ? templatesDoSnapshot(baseSession.templateSet) : templates;
  const recuperado = baseSession ? snapshotDaSessao(baseSession.snapshot) : null;
  /**
   * Identity of THIS execution, stamped on every prediction it persists.
   *
   * Live reuses the session id, so a room rebuilt from its checkpoint after a
   * restart keeps writing into the same participation. Replay has no session by
   * design (`roomMode` reads a session as "this party already played", and a
   * replay that gets one comes back as a dead `finished` room instead of
   * replaying), so it gets a fresh id per run — which is exactly what makes a
   * second replay distinguishable from the first.
   */
  const runId = baseSession?.id ?? randomUUID();
  const ports = politica.persists ? createEnginePorts(db, { runId }) : portsDeTreino();
  // Live rooms use kickoff until the first real event reanchors the clock.
  const cursor: ReplayCursor = {
    matchTs: recuperado?.cursor?.matchTs ?? (linhaDoTempo.length ? linhaDoTempo[0]!.ts : fixture.startTime ?? Date.now()),
    realAt: recuperado?.cursor?.realAt ?? Date.now(),
  };
  // Live fixtures always run at speed 1, independent of replay configuration.
  const clock = cursorClock(cursor, liveLike ? 1 : REPLAY_SPEED);
  // Replay bounds interpolation to its last clock; live does not.
  const clockMaxSeconds = eventos.reduce<number | null>(
    (max, event) => typeof event.clockSeconds === 'number' ? Math.max(max ?? 0, event.clockSeconds) : max,
    null,
  );

  const state: RoomState = recuperado?.room && recuperado.room.fixtureId === fixtureId ? recuperado.room : {
    fixtureId,
    teamA: fixture.p1,
    teamB: fixture.p2,
    // Live provenance must not inherit a possible post-match cache label.
    source: liveLike
      ? 'txline-live'
      : (fixture as { cacheSource?: string }).cacheSource ?? 'txline-cache',
    score: { p1: 0, p2: 0 },
    minute: null,
    clockSeconds: null,
    replaySpeed: liveLike ? 1 : REPLAY_SPEED,
    clockMaxSeconds: liveLike ? null : clockMaxSeconds,
    finished: false,
    questions: [],
    feed: [],
    totals: { p1: {}, p2: {} },
    chances: [],
  };

  const sala: Room = {
    fixtureId,
    mode,
    partyId,
    training,
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
    shutdownTimer: null,
    watchdog: null,
    engine: null as unknown as QuestionEngine,
    runner: null,
    close: () => {},
    checkpoint: () => {},
    sessionId: baseSession?.id ?? null,
    lastScoreSeq: baseSession?.lastScoreSeq ?? null,
    lastOddsTs: baseSession?.lastOddsTs ?? null,
    lastOddsMessageId: baseSession?.lastOddsMessageId ?? null,
  };

  if (recuperado?.fatos) sala.fatos = new Map(recuperado.fatos);
  if (recuperado?.xp) sala.xpDaSala = new Map(recuperado.xp);
  if (recuperado?.apelidos) sala.apelidos = new Map(recuperado.apelidos);
  if (recuperado?.pct1x2) sala.pct1x2 = { ...recuperado.pct1x2 };

  /** Training rooms are the only rooms that do not award XP. */
  const semXpPara = (): boolean => !politica.paysXp;

  const paraOFa = (msg: RoomMessage, userId: string | null): RoomMessage | null => {
    const ts = cursor.matchTs;

    if (msg.type === 'question_open') {
      const q = msg.question as Question;
      return {
        type: 'question_open',
        ts,
        questionId: q.id,
        // `type` identifies the SSE event; question type is carried in `qtype`.
        qtype: q.type,
        prompt: q.prompt,
        // Only `final_result` uses 1X2; unquoted options remain `null`.
        options: q.options.map((o) => ({
          id: o.id,
          label: o.label,
          pct:
            q.type === 'final_result' ? sala.pct1x2[o.id as keyof Pct1x2] ?? null : null,
        })),
        // Base XP comes from the engine; training always emits zero.
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
        // UI receives labels and facts, not only identifiers.
        options: q.options.map((o) => ({ id: o.id, label: o.label })),
        facts: sala.fatos.get(q.id) ?? null,
        qtype: q.type,
        // Users without a prediction receive zero XP.
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

    // Internal engine messages are not client events.
    return null;
  };

  const publicar = (msg: RoomMessage) => {
    for (const sub of sala.subs) {
      const dele = paraOFa(msg, sub.userId);
      if (!dele) continue;
      try {
        sub.enviar(dele);
      } catch {
        // A stale subscriber must not disrupt other room members.
      }
    }
  };

  /** SSE events shared by every subscriber. */
  const publicarBruto = (msg: RoomMessage) => {
    for (const sub of sala.subs) {
      try {
        sub.enviar(msg);
      } catch {
        // Isolate stale subscribers.
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
    // Server closes the lobby even without the host tab.
    void createLobbyRepo(db).markFinishedBySystem(partyId).catch(() => {});
    sala.checkpoint();
    if (sala.sessionId) void createGameSessionRepo(db).finish(sala.sessionId).catch(() => {});
    void ports.flush().catch(() => {});
    if (sala.subs.size === 0) scheduleFinishedRoomCleanup(sala);
  };

  /** Core emits chance readings; the room stores and broadcasts them. */
  const explicador = new OddsExplainer({
    fixture,
    emit: (msg) => {
      if (msg.type !== 'odds_explain') return;
      const leitura: ChanceReading = {
        id: `${String(msg.messageId ?? msg.ts)}:${String(msg.priceName)}`,
        ts: msg.ts as number,
        minute: state.minute,
        priceName: msg.priceName as string,
        fromPct: msg.fromPct as number,
        toPct: msg.toPct as number,
        // Text is fallback only; UI localizes structured fields.
        text: msg.text as string,
      };
      // Omitted context differs from serializing a nonexistent value.
      if (msg.contextAction) leitura.contextAction = msg.contextAction as string;
      recordChanceReading(state.chances, leitura);
      publicarBruto({ type: 'odds_explain', ...leitura });
    },
  });

  /** Accumulates engine-decided XP without recalculating room-level bonuses. */
  const registrarNoRanking = (results: ResolvedResult[]) => {
    for (const r of results) {
      sala.xpDaSala.set(r.userId, (sala.xpDaSala.get(r.userId) ?? 0) + r.awardedXp);
      // Sentinel values neither clear nor become public nicknames.
      if (r.handle && r.handle !== '?') sala.apelidos.set(r.userId, r.handle);
    }
  };

  /** Ranking is personalized because `me` is subscriber-specific. */
  const publicarRanking = () => {
    for (const sub of sala.subs) {
      try {
        sub.enviar(roomRanking(sala, sub.userId));
      } catch {
        // Isolate stale subscribers.
      }
    }
  };

  sala.engine = new QuestionEngine({
    fixture,
    clock,
    ports,
    ...(baseSession ? {
      sessionId: baseSession.id,
      templates: templatesFixados,
      questionId: (type: Question['type'], triggerKey: string) =>
        `q_${baseSession.id.replace(/-/g, '')}_${type}_${triggerKey.replace(/[^a-zA-Z0-9_:-]/g, '_')}`,
    } : {}),
    // Only training does not award XP; persistence keeps questions idempotent.
    pagaXp: () => politica.paysXp,
    emit: (msg) => {
      // Persist opens and outcomes: predictions depend on questions and final state remains auditable.
      if (msg.question && (msg.type === 'question_open' || msg.type === 'question_resolved' || msg.type === 'question_void')) {
        ports.saveQuestion(msg.question as Question);
      }
      if (msg.type === 'game_end') state.finished = true;
      state.questions = sala.engine.allQuestions();
      // Update ranking before broadcasting settlement.
      if (msg.type === 'question_resolved' || msg.type === 'question_void') {
        registrarNoRanking((msg.results ?? []) as ResolvedResult[]);
        // Settlement facts use accumulated totals; missing corners stay `null`.
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
      // Live ends from the feed while preserving the `replay_done` SSE contract.
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

  if (recuperado?.engine) {
    sala.engine.restore(recuperado.engine);
    // Rehydrate persisted predictions after restart; they may have committed before the checkpoint.
    const predictions = await Promise.all(
      sala.engine.allQuestions().map((question) => createPredictionRepo(db).listByQuestion(question.id)),
    );
    sala.engine.hydratePredictions(predictions.flat());
    state.questions = sala.engine.allQuestions();
  }

  /** Checkpoint cursor and engine state together; recovery resumes the same question IDs. */
  sala.checkpoint = () => {
    if (!session) return;
    const snapshot: SnapshotDaSessao = {
      engine: sala.engine.snapshot(),
      room: state,
      cursor: { ...cursor },
      fatos: [...sala.fatos.entries()],
      xp: [...sala.xpDaSala.entries()],
      apelidos: [...sala.apelidos.entries()],
      pct1x2: { ...sala.pct1x2 },
    };
    void createGameSessionRepo(db)
      .checkpoint(session.id, snapshot as Record<string, unknown>, {
        lastScoreSeq: sala.lastScoreSeq,
        lastOddsTs: sala.lastOddsTs,
        lastOddsMessageId: sala.lastOddsMessageId,
      })
      .catch((e: unknown) => console.warn(`[sala ${fixtureId}] checkpoint falhou:`, e instanceof Error ? e.message : e));
  };

  /** Processes replay and live events through the same path. */
  const processarEvento = (ev: NormEvent): void => {
    // Redis Pub/Sub is ephemeral; durable cursors make redelivery forward-only.
    if (ev.kind === 'score' && sala.lastScoreSeq !== null && ev.seq <= sala.lastScoreSeq) return;
    if (
      ev.kind === 'odds' &&
      sala.lastOddsTs !== null &&
      (ev.ts < sala.lastOddsTs || (ev.ts === sala.lastOddsTs && (ev.messageId ?? null) === sala.lastOddsMessageId))
    ) return;

    // Update the anchor before the engine evaluates windows.
    cursor.matchTs = ev.ts;
    cursor.realAt = Date.now();

    // Odds update chances only, never score, totals, or questions.
    if (ev.kind === 'odds') {
      sala.lastOddsTs = ev.ts;
      sala.lastOddsMessageId = ev.messageId ?? null;
      update1x2Percentages(sala.pct1x2, ev);
      explicador.onOddsEvent(ev);
      sala.checkpoint();
      return;
    }

    if (!ehScore(ev)) return;
    sala.lastScoreSeq = ev.seq;
    sala.engine.onScoreEvent(ev);
    // Explainer retains the latest play as context.
    explicador.onScoreEvent(ev);

    // `hasScore` without `Goals` does not mean 0–0; never regress score from placeholders.
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

    // Feed totals are partial: merge by key and never replace the map.
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
        // Without a clock, the client keeps its previous anchor.
        clockSeconds: typeof ev.clockSeconds === 'number' ? ev.clockSeconds : null,
        // `null` means score unavailable in this event, not zero.
        scoreA: mudou ? state.score.p1 : null,
        scoreB: mudou ? state.score.p2 : null,
        lance,
        // Send accumulated totals so UI can recover from missed events.
        totals: state.totals,
      });
    }
    sala.checkpoint();
  };

  if (mode === 'replay') {
    sala.runner = new ReplayRunner(linhaDoTempo, REPLAY_SPEED, processarEvento, () => {
      finalizarSala();
    });
  }

  sala.close = () => {
    if (sala.shutdownTimer) clearTimeout(sala.shutdownTimer);
    sala.shutdownTimer = null;
    if (sala.watchdog) clearTimeout(sala.watchdog);
    sala.watchdog = null;
    sala.runner?.stop();
    desassinar?.();
    const key = roomKey(fixtureId, training, partyId);
    salas.delete(key);
    resetLobby(key);
    void ports.flush().catch(() => {}).finally(() => void db.close?.());
  };

  if (mode === 'live') {
    // Reapply the snapshot through the same handler and dedupe kickoff before catch-up.
    const ehKickoffDuplicado = createKickoffDeduper();
    const aoEvento = (ev: NormEvent): void => {
      if (ev.kind === 'score' && ehKickoffDuplicado(ev)) return;
      processarEvento(ev);
    };
    const jaNoCheckpoint = (ev: NormEvent): boolean => {
      if (!baseSession) return false;
      if (ev.kind === 'score') return sala.lastScoreSeq !== null && ev.seq <= sala.lastScoreSeq;
      if (sala.lastOddsTs === null) return false;
      return ev.ts < sala.lastOddsTs || (ev.ts === sala.lastOddsTs && ev.messageId === sala.lastOddsMessageId);
    };
    for (const ev of linhaDoTempo) {
      if (!jaNoCheckpoint(ev)) aoEvento(ev);
    }
    // Events received during reads are deduplicated by sequence/message ID.
    let ultimoSeq = Math.max(sala.lastScoreSeq ?? -1, eventos.length ? eventos[eventos.length - 1]!.seq : -1);
    const oddsVistas = new Set(odds.map((o) => o.messageId).filter(Boolean));
    for (const ev of bufferDoCatchUp) {
      if (ev.kind === 'score' && ev.seq <= ultimoSeq) continue;
      if (ev.kind === 'odds' && ev.messageId && oddsVistas.has(ev.messageId)) continue;
      aoEvento(ev);
      // Update marks inside the buffer to deduplicate repeated redelivery before the final handler is installed.
      if (ev.kind === 'score') ultimoSeq = ev.seq;
      else if (ev.messageId) oddsVistas.add(ev.messageId);
    }
    bufferDoCatchUp.length = 0;
    // After catch-up, channel events go directly to the handler.
    entregar = aoEvento;
  } else if (mode === 'replay') {
    const runner = sala.runner!;
    runner.start();
    sala.watchdog = setTimeout(
      () => runner.finishNow(),
      Math.max(30_000, runner.estimatedDurationMs + WATCHDOG_MARGIN_MS),
    );
  } else {
    // Lazy reconciliation: the match is over and this party already ran. Restore
    // the snapshot and close the books — no runner, no channel, no new session.
    // `finalizarSala` is the same idempotent path the whistle takes, so it also
    // finishes a lobby and a session that a restart left open.
    finalizarSala();
  }
  salas.set(roomKey(fixtureId, training, partyId), sala);
  return sala;
}

/** Returns the fixture room, creating and starting it on first access. */
export async function openRoom(
  fixtureId: number,
  training = false,
  partyId = 'PUBLIC',
): Promise<Room | null> {
  const key = roomKey(fixtureId, training, partyId);
  const aberta = salas.get(key);
  if (aberta) return aberta;

  const existente = salasEmCriacao.get(key);
  if (existente) return existente;

  const criacao = createRoom(fixtureId, training, partyId).finally(() => {
    if (salasEmCriacao.get(key) === criacao) salasEmCriacao.delete(key);
  });
  salasEmCriacao.set(key, criacao);
  return criacao;
}

/** Serializes a question with its deadline converted to real milliseconds. */
function perguntaDoPacote(sala: Room, q: Question, semXp: boolean) {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    // Only `final_result` receives 1X2; missing quotes remain `null`.
    options: q.options.map((o) => ({
      id: o.id,
      label: o.label,
      pct: q.type === 'final_result' ? sala.pct1x2[o.id as keyof Pct1x2] ?? null : null,
    })),
    // Base XP comes from the engine; training emits zero.
    xp: semXp ? 0 : (XP_BASE[q.type as keyof typeof XP_BASE] ?? 0),
    state: q.state,
    closesAt: q.closesAt,
    // Deadline uses the authoritative clock; closed questions have no remaining time.
    closesInRealMs:
      q.state === 'open'
        ? Math.max(0, sala.clock.toRealMs(Math.max(0, q.closesAt - sala.clock.now())))
        : 0,
  };
}

/** First personalized packet: state, receipts, and this user's results. */
export function roomStateFor(sala: Room, userId: string | null): RoomMessage {
  const respostas = userId ? sala.engine.respostasDe(userId) : [];
  const minhasPorId = new Set(respostas.map((r) => r.question.id));
  const semXp = sala.training;

  // Keep answered closed questions to restore receipts after reload.
  const questions = sala.engine
    .allQuestions()
    .filter((q) => q.state === 'open' || (q.state === 'closed' && minhasPorId.has(q.id)))
    .map((q) => perguntaDoPacote(sala, q, semXp));

  const minhas = respostas
    .filter((r) => r.question.state === 'open' || r.question.state === 'closed')
    .map((r) => ({ questionId: r.question.id, choice: r.prediction.choice }));

  // Settled results, newest first.
  const resultados = respostas
    .filter((r) => r.question.state === 'resolved' || r.question.state === 'void')
    .sort((a, b) => (b.question.resolvedAt ?? 0) - (a.question.resolvedAt ?? 0))
    .map((r) => ({
      questionId: r.question.id,
      prompt: r.question.prompt,
      qtype: r.question.type,
      correctOptionId: r.question.correct,
      voidReason: r.question.voidReason,
      // XP is decided by the engine and never recalculated here.
      gained: r.prediction.awardedXp ?? 0,
      choice: r.prediction.choice,
      // Include labels and facts to restore a complete explanation.
      options: r.question.options.map((o) => ({ id: o.id, label: o.label })),
      facts: sala.fatos.get(r.question.id) ?? null,
    }));

  return {
    type: 'room_state',
    ts: sala.cursor.matchTs,
    state: { ...sala.state, questions },
    minhas,
    resultados,
    // Room policy is the source of truth for training mode.
    training: semXp,
  };
}

/** Registers the current nickname without overwriting a known value with empty input. */
export function registerHandle(sala: Room, userId: string, handle: string | null): void {
  if (handle) sala.apelidos.set(userId, handle);
}

/** Personalized ranking exposes only public nicknames and `me`. */
export function roomRanking(sala: Room, userId: string | null): RoomMessage {
  const rows = [...sala.xpDaSala.entries()]
    .map(([id, xp]) => ({
      name: sala.apelidos.get(id) ?? '',
      xp,
      me: userId !== null && id === userId,
    }))
    // Stable sort and Map preserve insertion order for ties.
    .sort((a, b) => b.xp - a.xp);
  return { type: 'ranking', ts: sala.cursor.matchTs, rows };
}

/** Keeps an empty room during the grace period so reloads do not restart the fixture. */
export function subscribe(sala: Room, sub: Sub): () => void {
  sala.subs.add(sub);
  cancelShutdown(sala);
  return () => {
    sala.subs.delete(sub);
    // Runner drains the fixture when nobody reconnects during the grace period.
    scheduleShutdownIfEmpty(sala);
  };
}

/** Places a prediction; the engine decides the outcome. */
export async function placePrediction(
  sala: Room,
  user: User,
  questionId: string,
  choice: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = sala.engine.place(user, questionId, choice);
  if (!r.ok) return r;
  // Wait for this prediction only; `flushDe` does not surface another user's error.
  await sala.ports.flushDe(r.prediction.id);
  sala.checkpoint();
  await awardDebutTrophy(sala, user);
  return { ok: true };
}

/**
 * Grants the one debut trophy, after the prediction is durable.
 *
 * Order matters: the trophy commemorates a prediction that exists, so it is
 * awarded only once `flushDe` has confirmed the write. A failure here must never
 * fail the prediction the fan just made, so it is logged and swallowed; the
 * unique index means a later attempt is still exactly-once.
 *
 * No XP is written here. A trophy is not XP.
 */
async function awardDebutTrophy(sala: Room, user: User): Promise<void> {
  if (!canAwardDebutTrophy({ roomMode: sala.mode, training: sala.training, privyDid: user.privyId })) return;
  try {
    const awarded = await createTrophyRepo(sala.db).awardDebut(user.id, String(sala.fixtureId));
    if (awarded) console.log(`[sala ${sala.fixtureId}] troféu de estreia concedido ao fã ${user.id}`);
  } catch (e) {
    console.warn(
      `[sala ${sala.fixtureId}] troféu de estreia falhou:`,
      e instanceof Error ? e.message : e,
    );
  }
}
