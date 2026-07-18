import type {
  EngineEmit,
  Fixture,
  Prediction,
  Question,
  QuestionOption,
  QuestionTemplateRef,
  QuestionType,
  ScoreEvent,
  User,
} from "./types.ts";
import type { Clock } from "./clock.ts";
import type { EnginePorts } from "./ports.ts";
import { addXp } from "./ranking.ts";

export const WINDOW_NEXT_GOAL_MS = 60_000;
export const WINDOW_HILO_MS = 45_000;
// Minimum real-time window for accelerated replays; see windowMs().
export const MIN_REAL_WINDOW_MS = 8_000;
export const HILO_HORIZON_MS = 600_000; // 10 minutes
export const WINDOW_FINAL_MS = 600_000;

export const FAIRNESS_VOID_REASON =
  "evento resolvedor chegou com a janela aberta (regra de justiça)";

/** Single source of truth for base XP; early predictions receive a 1.5x bonus. */
export const XP_BASE: Record<QuestionType, number> = {
  final_result: 150,
  next_goal: 100,
  hilo_corners: 50,
};

export type ResolvedResult = {
  userId: string;
  handle: string;
  choice: string;
  result: "won" | "lost" | "void";
  awardedXp: number;
};

type Tracked = {
  question: Question;
  predictions: Prediction[];
  users: Map<string, User>;
  deadline?: number; // hilo_corners resolution horizon (opensAt + 10 minutes)
};

/** Serializable engine state used to restore a session after restart. */
export type QuestionEngineSnapshot = {
  finished: boolean;
  finalGoals: { p1: number; p2: number } | null;
  kickoffTs: number | null;
  prevGoals: { p1: number; p2: number } | null;
  prevCorners: { p1: number; p2: number } | null;
  sawMatchStart: boolean;
  tracked: { question: Question; predictions: Prediction[]; deadline?: number }[];
};

/**
 * Event-driven question engine. Event timestamps drive both live and replay
 * timelines; an event received before a window closes voids that question.
 */
export class QuestionEngine {
  finished = false;
  finalGoals: { p1: number; p2: number } | null = null;
  kickoffTs: number | null = null;

  private fixture: Fixture;
  private clock: Clock;
  private emit: EngineEmit;
  private ports: EnginePorts;
  private onResolvedCb?: (q: Question, results: ResolvedResult[]) => void;
  private pagaXp: (userId: string) => boolean;

  private tracked = new Map<string, Tracked>();
  private prevGoals: { p1: number; p2: number } | null = null;
  private prevCorners: { p1: number; p2: number } | null = null;
  private sawMatchStart = false;

  // At most one unresolved question is tracked per type.
  private pendingFinal: Tracked | null = null;
  private pendingNextGoal: Tracked | null = null;
  private pendingHilo: Tracked | null = null;
  private sessionId?: string;
  private templates: Partial<Record<QuestionType, QuestionTemplateRef>>;
  private questionId?: (type: QuestionType, triggerKey: string) => string;

  constructor(opts: {
    fixture: Fixture;
    clock: Clock;
    emit: EngineEmit;
    ports: EnginePorts;
    onResolved?: (q: Question, results: ResolvedResult[]) => void;
    /** Controls XP eligibility without changing the prediction verdict. */
    pagaXp?: (userId: string) => boolean;
    /** Persisted execution identity separates groups sharing a fixture. */
    sessionId?: string;
    /** Templates pinned when the session starts; the database does not execute rules. */
    templates?: Partial<Record<QuestionType, QuestionTemplateRef>>;
    /** Deterministic IDs make a repeated trigger idempotent. */
    questionId?: (type: QuestionType, triggerKey: string) => string;
  }) {
    this.fixture = opts.fixture;
    this.clock = opts.clock;
    this.emit = opts.emit;
    this.ports = opts.ports;
    this.onResolvedCb = opts.onResolved;
    this.pagaXp = opts.pagaXp ?? (() => true);
    this.sessionId = opts.sessionId;
    this.templates = opts.templates ?? {};
    this.questionId = opts.questionId;
  }

  onScoreEvent(ev: ScoreEvent): void {
    if (this.finished) return;
    this.sweep(ev.ts);

    const isEnd =
      ev.action === "game_finalised" || (ev.statusId === 100 && ev.period === 100);

    // Do not open questions from pre-match metadata; wait for match start.
    const matchStarted = ev.action === "kickoff" || ev.clockRunning === true;
    if (!this.sawMatchStart && matchStarted) {
      this.sawMatchStart = true;
      if (!isEnd) this.openFinal(ev.ts);
    }

    if (isEnd) {
      this.handleGameEnd(ev);
      return;
    }

    // Events without Score use placeholder values and must not create deltas.
    if (ev.hasScore && this.prevGoals && this.prevCorners) {
      const goalRegress =
        ev.goals.p1 < this.prevGoals.p1 || ev.goals.p2 < this.prevGoals.p2;
      const cornerRegress =
        ev.corners.p1 < this.prevCorners.p1 || ev.corners.p2 < this.prevCorners.p2;
      if (goalRegress || cornerRegress) {
        // Score regressions are logged; already settled predictions are immutable.
        this.emit({
          type: "log",
          level: "warn",
          fixtureId: this.fixture.fixtureId,
          text: `Placar regrediu no seq ${ev.seq} (possível anulação por VAR) — resoluções anteriores não são desfeitas`,
        });
      }
      if (!goalRegress) {
        if (ev.goals.p1 > this.prevGoals.p1) this.handleGoal("p1", ev);
        if (ev.goals.p2 > this.prevGoals.p2) this.handleGoal("p2", ev);
      }
      if (!cornerRegress) {
        const now = ev.corners.p1 + ev.corners.p2;
        const before = this.prevCorners.p1 + this.prevCorners.p2;
        if (now > before) this.handleCorner(ev);
      }
    }

    if (ev.action === "kickoff") this.handleKickoff(ev);
    // A next-goal question spans halftime and opens after the initial window closes.
    if (
      this.sawMatchStart &&
      !this.pendingNextGoal &&
      this.pendingFinal?.question.state !== "open"
    ) {
      this.openNextGoal(ev.ts);
    }

    if (ev.hasScore) {
      this.prevGoals = { ...ev.goals };
      this.prevCorners = { ...ev.corners };
    }
  }

  /** Closes elapsed windows and resolves expired hilo horizons. */
  sweep(ts: number): void {
    for (const t of this.tracked.values()) {
      const q = t.question;
      if (q.state === "open" && q.closesAt <= ts) {
        q.state = "closed";
        this.emit({
          type: "question_closed",
          fixtureId: this.fixture.fixtureId,
          questionId: q.id,
        });
      }
      if (
        q.type === "hilo_corners" &&
        q.state === "closed" &&
        t.deadline !== undefined &&
        t.deadline < ts
      ) {
        this.resolveQuestion(t, "no", ts);
        if (this.pendingHilo === t) this.pendingHilo = null;
      }
    }
  }

  place(
    user: User,
    questionId: string,
    choice: string
  ): { ok: true; prediction: Prediction } | { ok: false; error: string } {
    const t = this.tracked.get(questionId);
    if (!t) return { ok: false, error: "pergunta não existe" };
    const q = t.question;
    if (q.state !== "open" || this.clock.now() > q.closesAt) {
      return { ok: false, error: "janela fechada" };
    }
    if (!q.options.some((o) => o.id === choice)) {
      return { ok: false, error: "opção inválida" };
    }
    if (t.predictions.some((p) => p.userId === user.id)) {
      return { ok: false, error: "você já palpitou nesta pergunta" };
    }
    const prediction: Prediction = {
      id: this.ports.uid("pred"),
      userId: user.id,
      questionId: q.id,
      choice,
      placedAt: this.clock.now(),
    };
    t.predictions.push(prediction);
    t.users.set(user.id, user);
    this.ports.savePrediction(prediction);
    return { ok: true, prediction };
  }

  openQuestions(): Question[] {
    return [...this.tracked.values()]
      .map((t) => t.question)
      .filter((q) => q.state === "open");
  }

  questionById(id: string): Question | undefined {
    return this.tracked.get(id)?.question;
  }

  allQuestions(): Question[] {
    return [...this.tracked.values()].map((t) => t.question);
  }

  snapshot(): QuestionEngineSnapshot {
    return {
      finished: this.finished,
      finalGoals: this.finalGoals ? { ...this.finalGoals } : null,
      kickoffTs: this.kickoffTs,
      prevGoals: this.prevGoals ? { ...this.prevGoals } : null,
      prevCorners: this.prevCorners ? { ...this.prevCorners } : null,
      sawMatchStart: this.sawMatchStart,
      tracked: [...this.tracked.values()].map((t) => ({
        question: { ...t.question, options: t.question.options.map((o) => ({ ...o })) },
        predictions: t.predictions.map((p) => ({ ...p })),
        ...(t.deadline === undefined ? {} : { deadline: t.deadline }),
      })),
    };
  }

  /** Restores a session without reopening questions or changing their IDs. */
  restore(snapshot: QuestionEngineSnapshot): void {
    this.finished = Boolean(snapshot.finished);
    this.finalGoals = snapshot.finalGoals ? { ...snapshot.finalGoals } : null;
    this.kickoffTs = snapshot.kickoffTs ?? null;
    this.prevGoals = snapshot.prevGoals ? { ...snapshot.prevGoals } : null;
    this.prevCorners = snapshot.prevCorners ? { ...snapshot.prevCorners } : null;
    this.sawMatchStart = Boolean(snapshot.sawMatchStart);
    this.tracked.clear();
    this.pendingFinal = null;
    this.pendingNextGoal = null;
    this.pendingHilo = null;
    for (const saved of snapshot.tracked ?? []) {
      const tracked: Tracked = {
        question: { ...saved.question, options: (saved.question.options ?? []).map((o) => ({ ...o })) },
        predictions: (saved.predictions ?? []).map((p) => ({ ...p })),
        users: new Map(),
        ...(saved.deadline === undefined ? {} : { deadline: saved.deadline }),
      };
      this.tracked.set(tracked.question.id, tracked);
      if (tracked.question.state === 'resolved' || tracked.question.state === 'void') continue;
      if (tracked.question.type === 'final_result') this.pendingFinal = tracked;
      if (tracked.question.type === 'next_goal') this.pendingNextGoal = tracked;
      if (tracked.question.type === 'hilo_corners') this.pendingHilo = tracked;
    }
  }

  /** Reconciles a checkpoint with predictions committed before a crash. */
  hydratePredictions(predictions: Prediction[]): void {
    for (const prediction of predictions) {
      const tracked = this.tracked.get(prediction.questionId);
      if (!tracked || tracked.predictions.some((p) => p.id === prediction.id || p.userId === prediction.userId)) continue;
      tracked.predictions.push({ ...prediction });
    }
  }

  /** Returns a user's predictions in placement order for rejoin state. */
  respostasDe(userId: string): { question: Question; prediction: Prediction }[] {
    const minhas: { question: Question; prediction: Prediction }[] = [];
    for (const t of this.tracked.values()) {
      const p = t.predictions.find((pred) => pred.userId === userId);
      if (p) minhas.push({ question: t.question, prediction: p });
    }
    return minhas.sort((a, b) => a.prediction.placedAt - b.prediction.placedAt);
  }

  private handleKickoff(ev: ScoreEvent): void {
    if (this.kickoffTs === null) this.kickoffTs = ev.ts;
    const f = this.pendingFinal;
    // Preserve the minimum real-time window when final_result opens at kickoff.
    const teveTempoMinimoNoReplay =
      this.clock.speed <= 1 ||
      ev.ts - (f?.question.opensAt ?? ev.ts) >= MIN_REAL_WINDOW_MS * this.clock.speed;
    if (
      f &&
      f.question.state === "open" &&
      f.question.opensAt < ev.ts &&
      teveTempoMinimoNoReplay
    ) {
      f.question.state = "closed";
      this.emit({
        type: "question_closed",
        fixtureId: this.fixture.fixtureId,
        questionId: f.question.id,
      });
    }
    if (!this.pendingNextGoal && f?.question.state !== "open") this.openNextGoal(ev.ts);
  }

  private handleGoal(scorer: "p1" | "p2", ev: ScoreEvent): void {
    const t = this.pendingNextGoal;
    if (t) {
      if (t.question.state === "open") {
        this.voidQuestion(t, FAIRNESS_VOID_REASON, ev.ts);
      } else if (t.question.state === "closed") {
        this.resolveQuestion(t, scorer, ev.ts, ev.seq);
      }
      this.pendingNextGoal = null;
    }
    if (!this.finished && this.pendingFinal?.question.state !== "open") {
      this.openNextGoal(ev.ts);
    }
  }

  private handleCorner(ev: ScoreEvent): void {
    const t = this.pendingHilo;
    if (t && t.deadline !== undefined && ev.ts <= t.deadline) {
      if (t.question.state === "open") {
        this.voidQuestion(t, FAIRNESS_VOID_REASON, ev.ts);
      } else if (t.question.state === "closed") {
        this.resolveQuestion(t, "yes", ev.ts, ev.seq);
      }
      this.pendingHilo = null;
    }
    if (!this.pendingHilo) this.openHilo(ev.ts);
  }

  private handleGameEnd(ev: ScoreEvent): void {
    // Final events may omit Score; use the latest known score in that case.
    const goals = ev.hasScore ? ev.goals : this.prevGoals ?? ev.goals;
    const fin = this.pendingFinal;
    if (fin) {
      // Resolution events received during the open window must void, not settle.
      if (fin.question.state === "open") {
        this.voidQuestion(fin, FAIRNESS_VOID_REASON, ev.ts);
      } else {
        const correct =
          goals.p1 > goals.p2 ? "p1" : goals.p2 > goals.p1 ? "p2" : "draw";
        this.resolveQuestion(fin, correct, ev.ts, ev.seq);
      }
      this.pendingFinal = null;
    }
    const ng = this.pendingNextGoal;
    if (ng) {
      if (ng.question.state === "open") {
        this.voidQuestion(ng, FAIRNESS_VOID_REASON, ev.ts);
      } else if (ng.question.state === "closed") {
        this.resolveQuestion(ng, "none", ev.ts, ev.seq);
      }
      this.pendingNextGoal = null;
    }
    const hilo = this.pendingHilo;
    if (hilo) {
      if (hilo.question.state === "open") {
        this.voidQuestion(hilo, FAIRNESS_VOID_REASON, ev.ts);
      } else if (hilo.question.state === "closed") {
        this.resolveQuestion(hilo, "no", ev.ts, ev.seq);
      }
      this.pendingHilo = null;
    }
    this.finished = true;
    this.finalGoals = { ...goals };
    this.emit({
      type: "game_end",
      fixtureId: this.fixture.fixtureId,
      goals: this.finalGoals,
    });
  }

  /** Keeps windows usable when match time is accelerated in replay. */
  private windowMs(baseMatchMs: number): number {
    return Math.max(baseMatchMs, MIN_REAL_WINDOW_MS * this.clock.speed);
  }

  private openFinal(ts: number): void {
    this.pendingFinal = this.openQuestion(
      "final_result",
      `Como termina ${this.fixture.p1} x ${this.fixture.p2}?`,
      [
        { id: "p1", label: this.fixture.p1 },
        { id: "draw", label: "Empate" },
        { id: "p2", label: this.fixture.p2 },
      ],
      ts,
      ts + this.windowMs(WINDOW_FINAL_MS)
    );
  }

  private openNextGoal(ts: number): void {
    this.pendingNextGoal = this.openQuestion(
      "next_goal",
      "Quem marca o próximo gol?",
      [
        { id: "p1", label: this.fixture.p1 },
        { id: "p2", label: this.fixture.p2 },
        { id: "none", label: "Ninguém até o fim" },
      ],
      ts,
      ts + this.windowMs(WINDOW_NEXT_GOAL_MS)
    );
  }

  private openHilo(ts: number): void {
    this.pendingHilo = this.openQuestion(
      "hilo_corners",
      "Sai outro escanteio em até 10 minutos?",
      [
        { id: "yes", label: "Sim" },
        { id: "no", label: "Não" },
      ],
      ts,
      // Never close after the resolution horizon.
      ts + Math.min(this.windowMs(WINDOW_HILO_MS), HILO_HORIZON_MS),
      ts + HILO_HORIZON_MS
    );
  }

  private openQuestion(
    type: QuestionType,
    prompt: string,
    options: QuestionOption[],
    opensAt: number,
    closesAt: number,
    deadline?: number
  ): Tracked {
    const triggerKey = `${type}:${opensAt}`;
    const question: Question = {
      id: this.questionId?.(type, triggerKey) ?? this.ports.uid("q"),
      fixtureId: this.fixture.fixtureId,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.templates[type] ? { template: this.templates[type] } : {}),
      ...(this.sessionId ? { triggerKey } : {}),
      type,
      prompt,
      options,
      opensAt,
      closesAt,
      state: "open",
    };
    const t: Tracked = { question, predictions: [], users: new Map(), deadline };
    this.tracked.set(question.id, t);
    this.emit({
      type: "question_open",
      fixtureId: this.fixture.fixtureId,
      question,
      closesInRealMs: Math.max(0, this.clock.toRealMs(closesAt - this.clock.now())),
    });
    return t;
  }

  private resolveQuestion(t: Tracked, correct: string, ts: number, seq?: number): void {
    const q = t.question;
    q.state = "resolved";
    q.correct = correct;
    q.resolvedAt = ts;
    if (seq !== undefined) q.resolvedBySeq = seq;

    const results: ResolvedResult[] = t.predictions.map((p) => {
      const won = p.choice === correct;
      // Predictions in the first half of the window receive a 1.5x bonus.
      const fast = p.placedAt <= q.opensAt + (q.closesAt - q.opensAt) / 2;
      // Training keeps the verdict but awards no XP.
      const awardedXp =
        won && this.pagaXp(p.userId) ? Math.floor(XP_BASE[q.type] * (fast ? 1.5 : 1)) : 0;
      p.result = won ? "won" : "lost";
      p.awardedXp = awardedXp;
      const user = t.users.get(p.userId);
      if (user && awardedXp > 0) {
        addXp(user, awardedXp);
        this.ports.saveUser?.(user);
      }
      this.ports.savePrediction(p);
      return {
        userId: p.userId,
        handle: t.users.get(p.userId)?.handle ?? "?",
        choice: p.choice,
        result: p.result,
        awardedXp,
      };
    });

    this.emit({
      type: "question_resolved",
      fixtureId: this.fixture.fixtureId,
      question: q,
      results,
    });
    this.onResolvedCb?.(q, results);
  }

  private voidQuestion(t: Tracked, reason: string, ts: number): void {
    const q = t.question;
    q.state = "void";
    q.voidReason = reason;
    q.resolvedAt = ts;

    const results: ResolvedResult[] = t.predictions.map((p) => {
      p.result = "void";
      p.awardedXp = 0;
      this.ports.savePrediction(p);
      return {
        userId: p.userId,
        handle: t.users.get(p.userId)?.handle ?? "?",
        choice: p.choice,
        result: "void" as const,
        awardedXp: 0,
      };
    });

    this.emit({
      type: "question_void",
      fixtureId: this.fixture.fixtureId,
      question: q,
      reason,
    });
    this.onResolvedCb?.(q, results);
  }
}
