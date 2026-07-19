import { test } from "node:test";
import assert from "node:assert/strict";
import { manualClock } from "../src/clock.ts";
import { FAIRNESS_VOID_REASON, QuestionEngine } from "../src/questions.ts";
import type { Fixture, RoomMessage, ScoreEvent } from "../src/types.ts";
import { makeFakeStore } from "./fake-store.ts";

const FX: Fixture = { fixtureId: 111, p1: "Brasil", p2: "Argentina" };
const T0 = 1_000_000;

function ev(seq: number, ts: number, over: Partial<ScoreEvent> = {}): ScoreEvent {
  return {
    kind: "score",
    fixtureId: 111,
    seq,
    ts,
    action: "status",
    clockRunning: true,
    hasScore: true,
    goals: { p1: 0, p2: 0 },
    corners: { p1: 0, p2: 0 },
    raw: {},
    ...over,
  };
}

function acceleratedClock(start: number, speed: number) {
  let current = start;
  return {
    now: () => current,
    speed,
    toRealMs: (matchMs: number) => matchMs / speed,
    set(ts: number) {
      current = ts;
    },
  };
}

function makeEngine() {
  const emitted: RoomMessage[] = [];
  const clock = manualClock(T0);
  const fake = makeFakeStore();
  const engine = new QuestionEngine({
    fixture: FX,
    clock,
    emit: (m) => emitted.push(m),
    ports: fake.ports,
  });
  return { engine, clock, emitted, createUser: fake.createUser, fake };
}

test("opens final_result on the first in-play event; kickoff closes it and opens next_goal", () => {
  const { engine, clock, emitted } = makeEngine();

  engine.onScoreEvent(ev(1, T0));
  const opens = emitted.filter((m) => m.type === "question_open");
  assert.equal(opens.length, 1);
  assert.equal(opens[0].question.type, "final_result");
  assert.equal(opens[0].question.opensAt, T0);
  assert.equal(opens[0].question.closesAt, T0 + 600_000);
  assert.match(opens[0].question.prompt, /Brasil x Argentina/);

  clock.set(T0 + 5000);
  engine.onScoreEvent(ev(2, T0 + 5000, { action: "kickoff" }));

  const final = engine.allQuestions().find((q) => q.type === "final_result")!;
  assert.equal(final.state, "closed");
  assert.ok(
    emitted.some((m) => m.type === "question_closed" && m.questionId === final.id)
  );
  assert.equal(engine.kickoffTs, T0 + 5000);

  const ng = engine.openQuestions().find((q) => q.type === "next_goal");
  assert.ok(ng, "next_goal should open at kickoff");
  assert.equal(ng!.closesAt, T0 + 5000 + 60_000);
});

test("a replay ignores pre-match and opens the first question at kickoff with a short real deadline", () => {
  const emitted: RoomMessage[] = [];
  const speed = 60;
  const kickoffTs = T0 + 15_300_000;
  const clock = acceleratedClock(T0, speed);
  const fake = makeFakeStore();
  const engine = new QuestionEngine({
    fixture: { ...FX, startTime: kickoffTs },
    clock,
    emit: (m) => emitted.push(m),
    ports: fake.ports,
  });

  // Regression case: (kickoff + 10 minutes - first event) / 60.
  engine.onScoreEvent(ev(1, T0, { clockRunning: false }));
  assert.equal(engine.openQuestions().length, 0, "pre-match metadata does not open a challenge");

  clock.set(kickoffTs);
  engine.onScoreEvent(ev(2, kickoffTs, { action: "kickoff", clockRunning: true }));

  const opens = emitted.filter((m) => m.type === "question_open");
  assert.equal(opens.length, 1, "the first frame does not stack final result and next goal");
  assert.equal(opens[0].question.type, "final_result");
  assert.equal(opens[0].question.opensAt, kickoffTs);
  assert.equal(opens[0].closesInRealMs, 10_000);
  assert.ok(opens[0].closesInRealMs >= 8_000);
  assert.ok(opens[0].closesInRealMs < 30_000, "it does not carry the pre-match gap");

  clock.set(kickoffTs + 600_001);
  engine.onScoreEvent(ev(3, kickoffTs + 600_001));
  const final = engine.allQuestions().find((q) => q.type === "final_result")!;
  assert.equal(final.state, "closed", "it closes before the event that will resolve it at the end");
  assert.ok(engine.openQuestions().some((q) => q.type === "next_goal"));
});

test("place: ok, invalid option, duplicate, closed window, nonexistent question", () => {
  const { engine, clock, createUser } = makeEngine();
  const userA = createUser("ana_q");
  const userB = createUser("bob_q");

  engine.onScoreEvent(ev(1, T0));
  clock.set(T0 + 5000);
  engine.onScoreEvent(ev(2, T0 + 5000, { action: "kickoff" }));
  const ng = engine.openQuestions().find((q) => q.type === "next_goal")!;

  clock.set(T0 + 10_000);
  const ok = engine.place(userA, ng.id, "p1");
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.prediction.placedAt, T0 + 10_000);

  const dup = engine.place(userA, ng.id, "p2");
  assert.deepEqual(dup, { ok: false, error: "você já palpitou nesta pergunta" });

  const badOpt = engine.place(userB, ng.id, "zz");
  assert.deepEqual(badOpt, { ok: false, error: "opção inválida" });

  clock.set(T0 + 70_000); // Past closesAt (T0+65000), without a sweep.
  const late = engine.place(userB, ng.id, "p1");
  assert.deepEqual(late, { ok: false, error: "janela fechada" });

  const missing = engine.place(userB, "q_nope", "p1");
  assert.deepEqual(missing, { ok: false, error: "pergunta não existe" });
});

test("a goal with the window OPEN voids the question (fairness rule) and reopens another", () => {
  const { engine, clock, emitted, createUser } = makeEngine();
  const user = createUser("carla_q");

  engine.onScoreEvent(ev(1, T0));
  clock.set(T0 + 5000);
  engine.onScoreEvent(ev(2, T0 + 5000, { action: "kickoff" }));
  const ng1 = engine.openQuestions().find((q) => q.type === "next_goal")!;

  clock.set(T0 + 6000);
  assert.ok(engine.place(user, ng1.id, "p1").ok);

  const xpBefore = user.xp;
  // A goal at 30s arrives while the 65s window is still open, so void it.
  engine.onScoreEvent(ev(3, T0 + 30_000, { action: "goal", goals: { p1: 1, p2: 0 } }));

  assert.equal(engine.questionById(ng1.id)!.state, "void");
  assert.equal(engine.questionById(ng1.id)!.voidReason, FAIRNESS_VOID_REASON);
  const voidMsg = emitted.find((m) => m.type === "question_void");
  assert.ok(voidMsg);
  assert.equal(voidMsg!.reason, FAIRNESS_VOID_REASON);
  assert.equal(user.xp, xpBefore, "a void grants no XP");

  const ng2 = engine.openQuestions().find((q) => q.type === "next_goal");
  assert.ok(ng2, "a new next_goal must open after the goal");
  assert.equal(ng2!.opensAt, T0 + 30_000);
});

test("a goal with the window closed resolves and pays XP with the speed bonus", () => {
  const { engine, clock, emitted, createUser } = makeEngine();
  const fast = createUser("dani_q");
  const slow = createUser("edu_q");

  engine.onScoreEvent(ev(1, T0));
  clock.set(T0 + 5000);
  engine.onScoreEvent(ev(2, T0 + 5000, { action: "kickoff" }));
  const ng = engine.openQuestions().find((q) => q.type === "next_goal")!;
  // Window: T0+5000 through T0+65000; midpoint = T0+35000.

  clock.set(T0 + 10_000);
  assert.ok(engine.place(fast, ng.id, "p2").ok); // Fast and correct => 150.

  clock.set(T0 + 50_000);
  assert.ok(engine.place(slow, ng.id, "p1").ok); // Slow and incorrect => 0.

  engine.onScoreEvent(ev(3, T0 + 70_000)); // Sweep closes the window.
  assert.equal(engine.questionById(ng.id)!.state, "closed");

  engine.onScoreEvent(ev(4, T0 + 120_000, { action: "goal", goals: { p1: 0, p2: 1 } }));

  const q = engine.questionById(ng.id)!;
  assert.equal(q.state, "resolved");
  assert.equal(q.correct, "p2");
  assert.equal(q.resolvedBySeq, 4);

  const resolved = emitted.find(
    (m) => m.type === "question_resolved" && m.question.id === ng.id
  )!;
  const rFast = resolved.results.find((r: any) => r.userId === fast.id);
  const rSlow = resolved.results.find((r: any) => r.userId === slow.id);
  assert.equal(rFast.result, "won");
  assert.equal(rFast.awardedXp, 150); // floor(100 * 1.5)
  assert.equal(rSlow.result, "lost");
  assert.equal(rSlow.awardedXp, 0);
  assert.equal(fast.xp, 150);
  assert.equal(fast.level, 2); // floor(sqrt(150/100)) + 1
});

test("hilo_corners: 'yes' within the horizon; 'no' via sweep after the deadline", () => {
  const { engine, clock, createUser } = makeEngine();
  const user = createUser("fabi_q");

  engine.onScoreEvent(ev(1, T0));
  clock.set(T0 + 5000);
  engine.onScoreEvent(ev(2, T0 + 5000, { action: "kickoff" }));

  // First corner opens hilo (45s window, 10-minute horizon).
  engine.onScoreEvent(ev(3, T0 + 100_000, { action: "corner", corners: { p1: 1, p2: 0 } }));
  const hilo1 = engine.openQuestions().find((q) => q.type === "hilo_corners")!;
  assert.equal(hilo1.closesAt, T0 + 145_000);

  clock.set(T0 + 110_000);
  assert.ok(engine.place(user, hilo1.id, "yes").ok);

  engine.onScoreEvent(ev(4, T0 + 150_000)); // Closes the window.
  assert.equal(engine.questionById(hilo1.id)!.state, "closed");

  // A second corner within the horizon resolves "yes" and opens another hilo.
  engine.onScoreEvent(ev(5, T0 + 300_000, { action: "corner", corners: { p1: 1, p2: 1 } }));
  const q1 = engine.questionById(hilo1.id)!;
  assert.equal(q1.state, "resolved");
  assert.equal(q1.correct, "yes");
  assert.equal(user.xp, 75); // floor(50 * 1.5), palpite in the first half

  const hilo2 = engine.openQuestions().find((q) => q.type === "hilo_corners")!;
  assert.equal(hilo2.opensAt, T0 + 300_000);

  // No corner until the deadline (T0+900000), so sweep resolves "no".
  engine.onScoreEvent(ev(6, T0 + 901_000));
  const q2 = engine.questionById(hilo2.id)!;
  assert.equal(q2.state, "resolved");
  assert.equal(q2.correct, "no");
});

test("next_goal survives half-time and lands on p1 when p1 scores the next goal", () => {
  const { engine, clock, emitted, createUser } = makeEngine();
  const user = createUser("intervalo_q");

  engine.onScoreEvent(ev(1, T0));
  clock.set(T0 + 5_000);
  engine.onScoreEvent(ev(2, T0 + 5_000, { action: "kickoff" }));
  const ng = engine.openQuestions().find((q) => q.type === "next_goal")!;

  clock.set(T0 + 10_000);
  assert.ok(engine.place(user, ng.id, "p1").ok);

  engine.onScoreEvent(ev(3, T0 + 70_000)); // Closes the window.
  engine.onScoreEvent(ev(4, T0 + 80_000, { action: "halftime_finalised" }));

  assert.equal(
    engine.questionById(ng.id)!.state,
    "closed",
    "half-time does not mean 'nobody until the end'",
  );

  engine.onScoreEvent(ev(5, T0 + 100_000, { action: "kickoff", period: 2 }));
  assert.equal(
    engine.allQuestions().filter((q) => q.type === "next_goal").length,
    1,
    "the second half continues the same question instead of opening another",
  );

  engine.onScoreEvent(
    ev(6, T0 + 120_000, {
      action: "goal",
      period: 2,
      goals: { p1: 1, p2: 0 },
    }),
  );

  const q = engine.questionById(ng.id)!;
  assert.equal(q.state, "resolved");
  assert.equal(q.correct, "p1");
  assert.equal(q.resolvedBySeq, 6);
  assert.equal(user.xp, 150);

  const resolved = emitted.find(
    (m) => m.type === "question_resolved" && m.question.id === ng.id,
  )!;
  assert.equal(resolved.results[0].choice, "p1");
  assert.equal(resolved.results[0].result, "won");
});

test("game_finalised with final_result OPEN voids it (fairness rule) and pays nothing", () => {
  // A final result that remains open at game end must be voided for fairness.
  const { engine, clock, emitted, createUser } = makeEngine();
  const user = createUser("ivo_q");

  engine.onScoreEvent(ev(1, T0)); // Opens final_result (closes at T0+600_000).
  const final = engine.openQuestions().find((q) => q.type === "final_result")!;

  clock.set(T0 + 1000);
  assert.ok(engine.place(user, final.id, "p1").ok);

  // Game ends at 200s without kickoff, while the window is still open.
  clock.set(T0 + 200_000);
  engine.onScoreEvent(
    ev(2, T0 + 200_000, {
      action: "game_finalised",
      statusId: 100,
      period: 100,
      goals: { p1: 1, p2: 0 },
    })
  );

  const q = engine.questionById(final.id)!;
  assert.equal(q.state, "void");
  assert.equal(q.voidReason, FAIRNESS_VOID_REASON);
  assert.equal(user.xp, 0, "a voided question pays no XP even when the palpite was right");
  assert.ok(
    emitted.some((m) => m.type === "question_void" && m.question.id === final.id)
  );
  // The game still ends.
  assert.equal(engine.finished, true);
  assert.equal(emitted[emitted.length - 1].type, "game_end");
});

test("game_finalised resolves everything by the score and emits game_end last", () => {
  const { engine, clock, emitted, createUser } = makeEngine();
  const userA = createUser("gil_q");
  const userB = createUser("hugo_q");

  engine.onScoreEvent(ev(1, T0));
  const final = engine.openQuestions().find((q) => q.type === "final_result")!;
  clock.set(T0 + 1000);
  assert.ok(engine.place(userA, final.id, "p1").ok); // First half => bonus.

  clock.set(T0 + 5000);
  engine.onScoreEvent(ev(2, T0 + 5000, { action: "kickoff" }));

  // A goal during the open window voids NG1 and opens NG2.
  engine.onScoreEvent(ev(3, T0 + 30_000, { action: "goal", goals: { p1: 1, p2: 0 } }));
  const ng2 = engine.openQuestions().find((q) => q.type === "next_goal")!;

  clock.set(T0 + 40_000);
  assert.ok(engine.place(userB, ng2.id, "none").ok); // First half => bonus.

  engine.onScoreEvent(ev(4, T0 + 100_000)); // Closes NG2.

  engine.onScoreEvent(
    ev(5, T0 + 200_000, {
      action: "game_finalised",
      statusId: 100,
      period: 100,
      goals: { p1: 1, p2: 0 },
    })
  );

  assert.equal(engine.finished, true);
  assert.deepEqual(engine.finalGoals, { p1: 1, p2: 0 });

  const fq = engine.questionById(final.id)!;
  assert.equal(fq.state, "resolved");
  assert.equal(fq.correct, "p1");
  assert.equal(userA.xp, 225); // floor(150 * 1.5)

  const nq = engine.questionById(ng2.id)!;
  assert.equal(nq.state, "resolved");
  assert.equal(nq.correct, "none");
  assert.equal(userB.xp, 150); // floor(100 * 1.5)

  assert.equal(emitted[emitted.length - 1].type, "game_end");
  assert.deepEqual(emitted[emitted.length - 1].goals, { p1: 1, p2: 0 });
});

test("two scoring runs pay the same fan; explicit treino gives a verdict with zero XP", () => {
  const fake = makeFakeStore();
  const fa = fake.createUser("rejogando");

  const executar = (treino: boolean, deslocamento: number) => {
    const emitted: RoomMessage[] = [];
    const inicio = T0 + deslocamento;
    const clock = manualClock(inicio);
    const engine = new QuestionEngine({
      fixture: FX,
      clock,
      emit: (m) => emitted.push(m),
      ports: fake.ports,
      ...(treino ? { pagaXp: () => false } : {}),
    });

    engine.onScoreEvent(ev(1, inicio));
    clock.set(inicio + 5000);
    engine.onScoreEvent(ev(2, inicio + 5000, { action: "kickoff" }));
    const ng = engine.openQuestions().find((q) => q.type === "next_goal")!;
    clock.set(inicio + 10_000);
    assert.ok(engine.place(fa, ng.id, "p2").ok);
    engine.onScoreEvent(ev(3, inicio + 70_000));
    engine.onScoreEvent(
      ev(4, inicio + 120_000, { action: "goal", goals: { p1: 0, p2: 1 } }),
    );

    const resolved = emitted.find(
      (m) => m.type === "question_resolved" && m.question.id === ng.id,
    )!;
    return {
      questionId: ng.id,
      result: resolved.results.find((r: { userId: string }) => r.userId === fa.id)!,
    };
  };

  const primeira = executar(false, 0);
  const segunda = executar(false, 1_000_000);
  assert.notEqual(primeira.questionId, segunda.questionId, "each runner creates fresh questionIds");
  assert.equal(primeira.result.awardedXp, 150);
  assert.equal(segunda.result.awardedXp, 150);
  assert.equal(fa.xp, 300, "replaying the fixture for real stays XP-eligible");

  const pratica = executar(true, 2_000_000);
  assert.equal(pratica.result.result, "won", "treino keeps the verdict correct");
  assert.equal(pratica.result.awardedXp, 0, "only explicit treino forces zero XP");
  assert.equal(fa.xp, 300);
});

test("respostasDe returns THIS fan's questions — open and settled, never other fans'", () => {
  const { engine, clock, createUser } = makeEngine();
  const ana = createUser("ana_r");
  const bob = createUser("bob_r");

  engine.onScoreEvent(ev(1, T0));
  const final = engine.openQuestions().find((q) => q.type === "final_result")!;
  clock.set(T0 + 1000);
  assert.ok(engine.place(ana, final.id, "p1").ok);
  assert.ok(engine.place(bob, final.id, "p2").ok);

  clock.set(T0 + 5000);
  engine.onScoreEvent(ev(2, T0 + 5000, { action: "kickoff" }));
  const ng1 = engine.openQuestions().find((q) => q.type === "next_goal")!;
  clock.set(T0 + 10_000);
  assert.ok(engine.place(ana, ng1.id, "p1").ok);

  engine.onScoreEvent(ev(3, T0 + 70_000)); // the sweep closes ng1's window
  engine.onScoreEvent(ev(4, T0 + 120_000, { action: "goal", goals: { p1: 1, p2: 0 } }));

  // Ana sees final (closed, unresolved) and ng1 (resolved); Bob's data never leaks.
  const daAna = engine.respostasDe(ana.id);
  assert.equal(daAna.length, 2);
  // Prediction order is preserved.
  assert.equal(daAna[0].question.id, final.id);
  assert.equal(daAna[0].prediction.choice, "p1");
  assert.equal(daAna[0].prediction.result, undefined, "the final result has not settled yet");
  assert.equal(daAna[1].question.id, ng1.id);
  assert.equal(daAna[1].prediction.result, "won");
  assert.ok((daAna[1].prediction.awardedXp ?? 0) > 0);
  assert.equal(daAna[1].question.correct, "p1");

  const doBob = engine.respostasDe(bob.id);
  assert.equal(doBob.length, 1);
  assert.equal(doBob[0].prediction.choice, "p2");

  assert.deepEqual(engine.respostasDe("ninguem"), []);
});

test("a snapshot restores the same session question, without swapping ids or forgetting the palpite", () => {
  const first = makeEngine();
  const user = first.createUser("restaura");
  const ids = (type: string, trigger: string) => `q_session1_${type}_${trigger}`;
  const engine = new QuestionEngine({
    fixture: FX,
    clock: first.clock,
    emit: () => {},
    ports: first.fake.ports,
    sessionId: 'session1',
    templates: { next_goal: { id: 'next-goal', version: 1 } },
    questionId: ids,
  });
  engine.onScoreEvent(ev(1, T0));
  const question = engine.openQuestions()[0]!;
  assert.equal(question.id, 'q_session1_final_result_final_result:1000000');
  assert.equal(question.sessionId, 'session1');
  assert.ok(engine.place(user, question.id, 'p1').ok);

  const restored = new QuestionEngine({
    fixture: FX,
    clock: first.clock,
    emit: () => {},
    ports: first.fake.ports,
    sessionId: 'session1',
    questionId: ids,
  });
  const checkpoint = engine.snapshot();
  const persisted = checkpoint.tracked[0]!.predictions;
  checkpoint.tracked[0]!.predictions = [];
  restored.restore(checkpoint);
  restored.hydratePredictions(persisted);
  assert.equal(restored.questionById(question.id)?.id, question.id);
  assert.equal(restored.respostasDe(user.id)[0]?.prediction.choice, 'p1');
});
