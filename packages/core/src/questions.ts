import type {
  EngineEmit,
  Fixture,
  Prediction,
  Question,
  QuestionOption,
  QuestionType,
  ScoreEvent,
  User,
} from "./types.ts";
import type { Clock } from "./clock.ts";
import type { EnginePorts } from "./ports.ts";
import { addXp } from "./ranking.ts";

export const WINDOW_NEXT_GOAL_MS = 60_000;
export const WINDOW_HILO_MS = 45_000;
// Mínimo de tempo REAL de janela em replay acelerado (ver windowMs()).
export const MIN_REAL_WINDOW_MS = 8_000;
export const HILO_HORIZON_MS = 600_000; // 10 min
export const WINDOW_FINAL_MS = 600_000;

export const FAIRNESS_VOID_REASON =
  "evento resolvedor chegou com a janela aberta (regra de justiça)";

/**
 * O que cada tipo de pergunta vale. Exportado porque a TELA precisa dizer ao fã
 * quanto está em jogo ANTES de ele palpitar — e a única alternativa era copiar a
 * tabela no servidor da sala, que é como duas verdades nascem.
 *
 * O valor final ainda pode ser MAIOR: quem palpita na primeira metade da janela
 * leva 1.5x (ver `fast`, abaixo). Este é o piso, não o teto — e por isso mostrar
 * este número na abertura não mente: o resultado revela o que de fato saiu.
 */
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
  deadline?: number; // hilo_corners: horizonte de resolução (opensAt + 10 min)
};

/**
 * Motor de perguntas dirigido por eventos. A linha do tempo é o ts DOS EVENTOS
 * do feed — por isso o mesmo motor roda idêntico ao vivo e em replay.
 * Regra de justiça: a janela de palpite fecha ANTES do evento que resolve;
 * se o evento resolvedor chega com a janela ainda aberta, a pergunta é anulada.
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
  private sawFirstEvent = false;

  // no máximo 1 pergunta pendente (não resolvida) por tipo
  private pendingFinal: Tracked | null = null;
  private pendingNextGoal: Tracked | null = null;
  private pendingHilo: Tracked | null = null;

  constructor(opts: {
    fixture: Fixture;
    clock: Clock;
    emit: EngineEmit;
    ports: EnginePorts;
    onResolved?: (q: Question, results: ResolvedResult[]) => void;
    /**
     * Modo treino: `false` para um fã = o veredito dele sai normal (won/lost),
     * mas o XP pago é SEMPRE 0 — replay rejogado com gabarito decorado não pode
     * valer ranking. Ausente = todo mundo é pago (o caminho ao vivo não muda).
     * A decisão de QUEM é treino é da aplicação; o motor só obedece — uma
     * tabela de pagamento, um pagador.
     */
    pagaXp?: (userId: string) => boolean;
  }) {
    this.fixture = opts.fixture;
    this.clock = opts.clock;
    this.emit = opts.emit;
    this.ports = opts.ports;
    this.onResolvedCb = opts.onResolved;
    this.pagaXp = opts.pagaXp ?? (() => true);
  }

  onScoreEvent(ev: ScoreEvent): void {
    if (this.finished) return;
    this.sweep(ev.ts);

    const isEnd =
      ev.action === "game_finalised" || (ev.statusId === 100 && ev.period === 100);

    if (!this.sawFirstEvent) {
      this.sawFirstEvent = true;
      if (!isEnd) this.openFinal(ev.ts);
    }

    if (isEnd) {
      this.handleGameEnd(ev);
      return;
    }

    // Eventos sem bloco Score (kickoff, lineups, comment…) trazem goals/corners
    // placeholder 0 — processar delta neles criaria gols/anulações fantasma (A4:
    // ausente ≠ zero).
    if (ev.hasScore && this.prevGoals && this.prevCorners) {
      const goalRegress =
        ev.goals.p1 < this.prevGoals.p1 || ev.goals.p2 < this.prevGoals.p2;
      const cornerRegress =
        ev.corners.p1 < this.prevCorners.p1 || ev.corners.p2 < this.prevCorners.p2;
      if (goalRegress || cornerRegress) {
        // Placar regrediu (VAR anulou?): limitação assumida — não desfazemos
        // resoluções já pagas, só registramos e seguimos com o novo placar.
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
    else if (ev.action === "halftime_finalised") this.handlePeriodEnd(ev);

    if (ev.hasScore) {
      this.prevGoals = { ...ev.goals };
      this.prevCorners = { ...ev.corners };
    }
  }

  /** Fecha janelas vencidas e resolve hilos cujo horizonte expirou. */
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

  /**
   * O que ESTE fã respondeu, pergunta a pergunta — aberta, fechada ou liquidada.
   *
   * Existe para o rejoin: um F5 derruba a tela, mas não o palpite. Sem isto o
   * recibo e o histórico viviam só no estado do React e morriam no reload — o fã
   * voltava, via a pergunta aberta de novo, tocava e ouvia "você já palpitou".
   * A ordem é a de palpite (placedAt), que é a ordem em que ele viveu o jogo.
   */
  respostasDe(userId: string): { question: Question; prediction: Prediction }[] {
    const minhas: { question: Question; prediction: Prediction }[] = [];
    for (const t of this.tracked.values()) {
      const p = t.predictions.find((pred) => pred.userId === userId);
      if (p) minhas.push({ question: t.question, prediction: p });
    }
    return minhas.sort((a, b) => a.prediction.placedAt - b.prediction.placedAt);
  }

  // -------------------------------------------------------------------------
  // Gatilhos
  // -------------------------------------------------------------------------

  private handleKickoff(ev: ScoreEvent): void {
    if (this.kickoffTs === null) this.kickoffTs = ev.ts;
    const f = this.pendingFinal;
    // A janela do resultado final encerra no apito inicial. Se a pergunta abriu
    // NESTE mesmo evento (replay começando no kickoff), deixamos a janela padrão.
    if (f && f.question.state === "open" && f.question.opensAt < ev.ts) {
      f.question.state = "closed";
      this.emit({
        type: "question_closed",
        fixtureId: this.fixture.fixtureId,
        questionId: f.question.id,
      });
    }
    // Abre next_goal em qualquer kickoff sem pendente (cobre também o 2º tempo).
    if (!this.pendingNextGoal) this.openNextGoal(ev.ts);
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
    if (!this.finished) this.openNextGoal(ev.ts);
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

  private handlePeriodEnd(ev: ScoreEvent): void {
    const t = this.pendingNextGoal;
    if (t) {
      if (t.question.state === "open") {
        this.voidQuestion(t, FAIRNESS_VOID_REASON, ev.ts);
      } else if (t.question.state === "closed") {
        this.resolveQuestion(t, "none", ev.ts, ev.seq);
      }
      this.pendingNextGoal = null;
    }
  }

  private handleGameEnd(ev: ScoreEvent): void {
    // Se o registro final não trouxer Score, usa o último placar conhecido.
    const goals = ev.hasScore ? ev.goals : this.prevGoals ?? ev.goals;
    const fin = this.pendingFinal;
    if (fin) {
      // Mesma regra de justiça que a next_goal e a hilo já seguiam: se o evento
      // que RESOLVE chega com a janela aberta, anula — não resolve. Quem fecha a
      // final_result normalmente é o apito inicial (handleKickoff), mas o feed
      // não garante um `kickoff` utilizável (no v0 ele reaparecia como recomeço
      // pós-gol, F2) e o replay por snapshot é um amostrador de 37 linhas (A1).
      // Sem esta guarda, o fim de jogo pagava XP a quem palpitou com a janela
      // ainda aberta — exatamente o que a regra existe para impedir.
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

  // -------------------------------------------------------------------------
  // Abertura / resolução
  // -------------------------------------------------------------------------

  /**
   * Janela em ms de PARTIDA, garantindo um mínimo de tempo REAL para reagir
   * em replay acelerado (a 60x, 60s de jogo = 1s real — injogável). O preço
   * da janela maior é mais anulações pela regra de justiça; trade-off aceito.
   */
  private windowMs(baseMatchMs: number): number {
    return Math.max(baseMatchMs, MIN_REAL_WINDOW_MS * this.clock.speed);
  }

  private openFinal(ts: number): void {
    // "Como termina?" é pergunta de PRÉ-JOGO: abre no 1º evento e quem fecha é
    // o apito inicial. A janela é ancorada no horário da partida, não no 1º
    // evento — o feed real começa a publicar (venue, clima, escalação, cotação)
    // até 44 min antes do kickoff, e ancorar no 1º evento fazia a janela
    // expirar ANTES de a bola rolar: o desafio nascia fechado e ninguém
    // palpitava. Só aparecia com dado real; no sintético o 1º evento é colado
    // no apito. Ver achado G4. O teto continua valendo se o apito nunca vier.
    const referencia = Math.max(ts, this.fixture.startTime ?? ts);
    this.pendingFinal = this.openQuestion(
      "final_result",
      `Como termina ${this.fixture.p1} x ${this.fixture.p2}?`,
      [
        { id: "p1", label: this.fixture.p1 },
        { id: "draw", label: "Empate" },
        { id: "p2", label: this.fixture.p2 },
      ],
      ts,
      referencia + this.windowMs(WINDOW_FINAL_MS)
    );
  }

  private openNextGoal(ts: number): void {
    this.pendingNextGoal = this.openQuestion(
      "next_goal",
      "Quem marca o próximo gol?",
      [
        { id: "p1", label: this.fixture.p1 },
        { id: "p2", label: this.fixture.p2 },
        { id: "none", label: "Ninguém até o fim do tempo" },
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
      // hilo nunca fecha depois do próprio horizonte de resolução
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
    const question: Question = {
      id: this.ports.uid("q"),
      fixtureId: this.fixture.fixtureId,
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
      // Bônus de velocidade: palpite na primeira metade da janela vale 1.5x.
      const fast = p.placedAt <= q.opensAt + (q.closesAt - q.opensAt) / 2;
      // Treino (pagaXp=false): acertou, o veredito diz "won" — e o XP é 0.
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
