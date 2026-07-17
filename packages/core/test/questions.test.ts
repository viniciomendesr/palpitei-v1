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
    hasScore: true,
    goals: { p1: 0, p2: 0 },
    corners: { p1: 0, p2: 0 },
    raw: {},
    ...over,
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

test("abre final_result no 1º evento; kickoff fecha a janela e abre next_goal", () => {
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
  assert.ok(ng, "next_goal deveria abrir no kickoff");
  assert.equal(ng!.closesAt, T0 + 5000 + 60_000);
});

test("place: ok, opção inválida, duplicado, janela fechada, pergunta inexistente", () => {
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

  clock.set(T0 + 70_000); // além do closesAt (T0+65000), sem sweep
  const late = engine.place(userB, ng.id, "p1");
  assert.deepEqual(late, { ok: false, error: "janela fechada" });

  const missing = engine.place(userB, "q_nope", "p1");
  assert.deepEqual(missing, { ok: false, error: "pergunta não existe" });
});

test("gol com a janela ABERTA anula a pergunta (regra de justiça) e reabre outra", () => {
  const { engine, clock, emitted, createUser } = makeEngine();
  const user = createUser("carla_q");

  engine.onScoreEvent(ev(1, T0));
  clock.set(T0 + 5000);
  engine.onScoreEvent(ev(2, T0 + 5000, { action: "kickoff" }));
  const ng1 = engine.openQuestions().find((q) => q.type === "next_goal")!;

  clock.set(T0 + 6000);
  assert.ok(engine.place(user, ng1.id, "p1").ok);

  const xpBefore = user.xp;
  // gol aos 30s — janela (65s) ainda aberta => void
  engine.onScoreEvent(ev(3, T0 + 30_000, { action: "goal", goals: { p1: 1, p2: 0 } }));

  assert.equal(engine.questionById(ng1.id)!.state, "void");
  assert.equal(engine.questionById(ng1.id)!.voidReason, FAIRNESS_VOID_REASON);
  const voidMsg = emitted.find((m) => m.type === "question_void");
  assert.ok(voidMsg);
  assert.equal(voidMsg!.reason, FAIRNESS_VOID_REASON);
  assert.equal(user.xp, xpBefore, "void não dá XP");

  const ng2 = engine.openQuestions().find((q) => q.type === "next_goal");
  assert.ok(ng2, "nova next_goal deve abrir após o gol");
  assert.equal(ng2!.opensAt, T0 + 30_000);
});

test("gol com a janela fechada resolve e paga XP com bônus de velocidade", () => {
  const { engine, clock, emitted, createUser } = makeEngine();
  const fast = createUser("dani_q");
  const slow = createUser("edu_q");

  engine.onScoreEvent(ev(1, T0));
  clock.set(T0 + 5000);
  engine.onScoreEvent(ev(2, T0 + 5000, { action: "kickoff" }));
  const ng = engine.openQuestions().find((q) => q.type === "next_goal")!;
  // janela: T0+5000 .. T0+65000; metade = T0+35000

  clock.set(T0 + 10_000);
  assert.ok(engine.place(fast, ng.id, "p2").ok); // rápido + certo => 150

  clock.set(T0 + 50_000);
  assert.ok(engine.place(slow, ng.id, "p1").ok); // lento + errado => 0

  engine.onScoreEvent(ev(3, T0 + 70_000)); // sweep fecha a janela
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

test("hilo_corners: 'yes' dentro do horizonte; 'no' via sweep após o deadline", () => {
  const { engine, clock, createUser } = makeEngine();
  const user = createUser("fabi_q");

  engine.onScoreEvent(ev(1, T0));
  clock.set(T0 + 5000);
  engine.onScoreEvent(ev(2, T0 + 5000, { action: "kickoff" }));

  // 1º escanteio abre a hilo (janela 45s, horizonte 10 min)
  engine.onScoreEvent(ev(3, T0 + 100_000, { action: "corner", corners: { p1: 1, p2: 0 } }));
  const hilo1 = engine.openQuestions().find((q) => q.type === "hilo_corners")!;
  assert.equal(hilo1.closesAt, T0 + 145_000);

  clock.set(T0 + 110_000);
  assert.ok(engine.place(user, hilo1.id, "yes").ok);

  engine.onScoreEvent(ev(4, T0 + 150_000)); // fecha a janela
  assert.equal(engine.questionById(hilo1.id)!.state, "closed");

  // 2º escanteio dentro do horizonte => "yes" e abre nova hilo
  engine.onScoreEvent(ev(5, T0 + 300_000, { action: "corner", corners: { p1: 1, p2: 1 } }));
  const q1 = engine.questionById(hilo1.id)!;
  assert.equal(q1.state, "resolved");
  assert.equal(q1.correct, "yes");
  assert.equal(user.xp, 75); // floor(50 * 1.5), palpite na primeira metade

  const hilo2 = engine.openQuestions().find((q) => q.type === "hilo_corners")!;
  assert.equal(hilo2.opensAt, T0 + 300_000);

  // nenhum escanteio até o deadline (T0+900000) => sweep resolve "no"
  engine.onScoreEvent(ev(6, T0 + 901_000));
  const q2 = engine.questionById(hilo2.id)!;
  assert.equal(q2.state, "resolved");
  assert.equal(q2.correct, "no");
});

test("halftime_finalised resolve next_goal fechada como 'none'", () => {
  const { engine } = makeEngine();

  engine.onScoreEvent(ev(1, T0, { action: "kickoff" }));
  const ng = engine.openQuestions().find((q) => q.type === "next_goal")!;

  engine.onScoreEvent(ev(2, T0 + 70_000)); // fecha a janela
  engine.onScoreEvent(ev(3, T0 + 80_000, { action: "halftime_finalised" }));

  const q = engine.questionById(ng.id)!;
  assert.equal(q.state, "resolved");
  assert.equal(q.correct, "none");
});

test("game_finalised com a final_result ABERTA anula (regra de justiça), não paga", () => {
  // Sem kickoff que feche a janela, o fim de jogo chegava com a final_result
  // ainda aberta e a RESOLVIA — pagando XP a quem palpitou com a janela aberta.
  // next_goal e hilo já anulavam nesse caso; a final_result era a exceção calada.
  const { engine, clock, emitted, createUser } = makeEngine();
  const user = createUser("ivo_q");

  engine.onScoreEvent(ev(1, T0)); // abre final_result (fecha em T0+600_000)
  const final = engine.openQuestions().find((q) => q.type === "final_result")!;

  clock.set(T0 + 1000);
  assert.ok(engine.place(user, final.id, "p1").ok);

  // Fim de jogo aos 200s, SEM kickoff: janela ainda aberta.
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
  assert.equal(user.xp, 0, "anulada não paga XP nem quando o palpite acertou");
  assert.ok(
    emitted.some((m) => m.type === "question_void" && m.question.id === final.id)
  );
  // O jogo termina do mesmo jeito.
  assert.equal(engine.finished, true);
  assert.equal(emitted[emitted.length - 1].type, "game_end");
});

test("game_finalised resolve tudo pelo placar e emite game_end por último", () => {
  const { engine, clock, emitted, createUser } = makeEngine();
  const userA = createUser("gil_q");
  const userB = createUser("hugo_q");

  engine.onScoreEvent(ev(1, T0));
  const final = engine.openQuestions().find((q) => q.type === "final_result")!;
  clock.set(T0 + 1000);
  assert.ok(engine.place(userA, final.id, "p1").ok); // primeira metade => bônus

  clock.set(T0 + 5000);
  engine.onScoreEvent(ev(2, T0 + 5000, { action: "kickoff" }));

  // gol com janela aberta => void da NG1, abre NG2
  engine.onScoreEvent(ev(3, T0 + 30_000, { action: "goal", goals: { p1: 1, p2: 0 } }));
  const ng2 = engine.openQuestions().find((q) => q.type === "next_goal")!;

  clock.set(T0 + 40_000);
  assert.ok(engine.place(userB, ng2.id, "none").ok); // primeira metade => bônus

  engine.onScoreEvent(ev(4, T0 + 100_000)); // fecha NG2

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

test("pagaXp falso vira modo treino: o veredito sai, o XP não", () => {
  const emitted: RoomMessage[] = [];
  const clock = manualClock(T0);
  const fake = makeFakeStore();
  const treino = fake.createUser("rejogando");
  const novato = fake.createUser("primeira_vez");
  const engine = new QuestionEngine({
    fixture: FX,
    clock,
    emit: (m) => emitted.push(m),
    ports: fake.ports,
    // replay já jogado: este fã não recebe XP — os outros seguem normais
    pagaXp: (userId) => userId !== treino.id,
  });

  engine.onScoreEvent(ev(1, T0));
  clock.set(T0 + 5000);
  engine.onScoreEvent(ev(2, T0 + 5000, { action: "kickoff" }));
  const ng = engine.openQuestions().find((q) => q.type === "next_goal")!;

  clock.set(T0 + 10_000);
  assert.ok(engine.place(treino, ng.id, "p2").ok);
  assert.ok(engine.place(novato, ng.id, "p2").ok);

  engine.onScoreEvent(ev(3, T0 + 70_000)); // fecha a janela
  engine.onScoreEvent(ev(4, T0 + 120_000, { action: "goal", goals: { p1: 0, p2: 1 } }));

  // os dois ACERTARAM; só o novato é pago
  assert.equal(novato.xp, 150, "quem joga pela primeira vez leva o bônus normal");
  assert.equal(treino.xp, 0, "treino não paga XP");

  const resolved = emitted.find(
    (m) => m.type === "question_resolved" && m.question.id === ng.id,
  )!;
  const rTreino = resolved.results.find((r: { userId: string }) => r.userId === treino.id)!;
  const rNovato = resolved.results.find((r: { userId: string }) => r.userId === novato.id)!;
  assert.equal(rTreino.result, "won", "o veredito continua sendo dele — só o pagamento muda");
  assert.equal(rTreino.awardedXp, 0);
  assert.equal(rNovato.awardedXp, 150);

  // e o banco recebe o 0 — recibo honesto, não omissão
  const predTreino = [...fake.predictions.values()].find((p) => p.userId === treino.id)!;
  assert.equal(predTreino.result, "won");
  assert.equal(predTreino.awardedXp, 0);
});

test("respostasDe devolve as perguntas DESTE fã — abertas e liquidadas, nunca as dos outros", () => {
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

  engine.onScoreEvent(ev(3, T0 + 70_000)); // sweep fecha a janela da ng1
  engine.onScoreEvent(ev(4, T0 + 120_000, { action: "goal", goals: { p1: 1, p2: 0 } }));

  // ana: final (fechada, sem veredito) + ng1 (resolvida, ganhou). bob não vaza.
  const daAna = engine.respostasDe(ana.id);
  assert.equal(daAna.length, 2);
  // ordem de palpite: quem palpitou primeiro vem primeiro
  assert.equal(daAna[0].question.id, final.id);
  assert.equal(daAna[0].prediction.choice, "p1");
  assert.equal(daAna[0].prediction.result, undefined, "final ainda não liquidou");
  assert.equal(daAna[1].question.id, ng1.id);
  assert.equal(daAna[1].prediction.result, "won");
  assert.ok((daAna[1].prediction.awardedXp ?? 0) > 0);
  assert.equal(daAna[1].question.correct, "p1");

  const doBob = engine.respostasDe(bob.id);
  assert.equal(doBob.length, 1);
  assert.equal(doBob[0].prediction.choice, "p2");

  assert.deepEqual(engine.respostasDe("ninguem"), []);
});
