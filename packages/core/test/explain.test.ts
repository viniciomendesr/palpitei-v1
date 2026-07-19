import { test } from "node:test";
import assert from "node:assert/strict";
import { OddsExplainer } from "../src/explain.ts";
import type { Fixture, OddsEvent, RoomMessage, ScoreEvent } from "../src/types.ts";

const FX: Fixture = { fixtureId: 333, p1: "Espanha", p2: "Inglaterra" };
const T0 = 5_000_000;

function odds(
  ts: number,
  prices: { name: string; odds: number; pct: number }[],
  over: Partial<OddsEvent> = {}
): OddsEvent {
  return {
    kind: "odds",
    fixtureId: 333,
    ts,
    marketType: "OVERUNDER_PARTICIPANT_GOALS",
    line: 1.5,
    prices,
    raw: {},
    ...over,
  };
}

function goal(ts: number): ScoreEvent {
  return {
    kind: "score",
    fixtureId: 333,
    seq: 1,
    ts,
    action: "goal",
    hasScore: true,
    goals: { p1: 1, p2: 0 },
    corners: { p1: 0, p2: 0 },
    raw: {},
  };
}

function makeExplainer() {
  const emitted: RoomMessage[] = [];
  const ex = new OddsExplainer({ fixture: FX, emit: (m) => emitted.push(m) });
  return { ex, emitted };
}

test("the message carries the structured CONTEXT (contextAction) so the screen can write bilingually", () => {
  const { ex, emitted } = makeExplainer();

  // With a goal inside the context window: contextAction = 'goal'
  ex.onOddsEvent(odds(T0, [{ name: "over", odds: 2.08, pct: 48.0 }]));
  ex.onScoreEvent(goal(T0 + 30_000));
  ex.onOddsEvent(odds(T0 + 60_000, [{ name: "over", odds: 1.88, pct: 53.2 }]));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].contextAction, "goal");

  // Without a play in the window, contextAction stays absent and the UI invents no cause.
  const { ex: ex2, emitted: em2 } = makeExplainer();
  ex2.onOddsEvent(odds(T0, [{ name: "over", odds: 2.08, pct: 48.0 }]));
  ex2.onOddsEvent(odds(T0 + 1000, [{ name: "over", odds: 1.88, pct: 53.2 }]));
  assert.equal(em2.length, 1);
  assert.equal(em2[0].contextAction, undefined);
});

test("small variations accumulate since the last published reading", () => {
  const { ex, emitted } = makeExplainer();

  ex.onOddsEvent(odds(T0, [{ name: "over", odds: 2.08, pct: 48.0 }]));
  ex.onOddsEvent(odds(T0 + 1000, [{ name: "over", odds: 2.0, pct: 50.0 }])); // +2.0
  assert.equal(emitted.length, 0);

  // The reference remains at 48.0 until a published change, so cumulative
  // movement is measured instead of resetting on every replay tick.
  ex.onOddsEvent(odds(T0 + 2000, [{ name: "over", odds: 1.88, pct: 53.2 }]));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].fromPct, 48.0);
  assert.equal(emitted[0].toPct, 53.2);
});

test("a replay does not need a single 3 p.p. swing to show the first half", () => {
  const { ex, emitted } = makeExplainer();

  // Reduced reproduction of the production series: each first-half tick is
  // below 3 p.p., while the total movement is material. Previously, Chances only woke
  // up at the first second-half goal, when a huge jump finally arrived.
  ex.onOddsEvent(odds(T0, [{ name: "1", odds: 2.78, pct: 35.945 }]));
  ex.onOddsEvent(odds(T0 + 1_000, [{ name: "1", odds: 2.88, pct: 34.722 }]));
  ex.onOddsEvent(odds(T0 + 2_000, [{ name: "1", odds: 2.95, pct: 33.898 }]));
  assert.equal(emitted.length, 0);

  ex.onOddsEvent(odds(T0 + 3_000, [{ name: "1", odds: 3.038, pct: 32.916 }]));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].fromPct, 35.945);
  assert.equal(emitted[0].toPct, 32.916);
});

test("a delta >= 3 p.p. emits an explanation with the market line and the goal context", () => {
  const { ex, emitted } = makeExplainer();

  ex.onOddsEvent(odds(T0, [{ name: "over", odds: 2.08, pct: 48.0 }]));
  ex.onScoreEvent(goal(T0 + 30_000));
  ex.onOddsEvent(odds(T0 + 60_000, [{ name: "over", odds: 1.88, pct: 53.2 }], { messageId: "odds-2" }));

  assert.equal(emitted.length, 1);
  const m = emitted[0];
  assert.equal(m.type, "odds_explain");
  assert.equal(m.messageId, "odds-2");
  assert.ok(m.text.includes("mais de 1.5 gols"), `text: ${m.text}`);
  assert.ok(m.text.includes("subiu de 48.0% para 53.2%"), `text: ${m.text}`);
  assert.ok(m.text.includes("depois do gol"), `text: ${m.text}`);
});

test("a play with a ts later than the price never becomes context for the past", () => {
  const { ex, emitted } = makeExplainer();
  ex.onOddsEvent(odds(T0, [{ name: "over", odds: 2.08, pct: 48.0 }]));
  ex.onScoreEvent(goal(T0 + 60_000));
  ex.onOddsEvent(odds(T0 + 30_000, [{ name: "over", odds: 1.88, pct: 53.2 }]));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].contextAction, undefined);
});

test("with no recent play (>180s) no context is attached; a fall uses 'caiu'", () => {
  const { ex, emitted } = makeExplainer();

  ex.onScoreEvent(goal(T0 - 300_000)); // a goal that is far too old
  ex.onOddsEvent(odds(T0, [{ name: "under", odds: 1.92, pct: 52.0 }]));
  ex.onOddsEvent(odds(T0 + 1000, [{ name: "under", odds: 2.1, pct: 47.5 }])); // -4.5

  assert.equal(emitted.length, 1);
  assert.ok(emitted[0].text.includes("caiu de 52.0% para 47.5%"));
  // Context is now contracted ("after the goal"), so the assertion must not
  // rely on the longer phrase that preceded the regression.
  assert.ok(!emitted[0].text.includes("depois"), `text: ${emitted[0].text}`);
  assert.ok(emitted[0].text.includes("menos de 1.5 gols"));
});

test("the 1X2 market translates price names into team names and 'empate'", () => {
  const { ex, emitted } = makeExplainer();
  const mk = { marketType: "MATCH_RESULT", line: undefined };

  ex.onOddsEvent(
    odds(T0, [
      { name: "1", odds: 2.5, pct: 40.0 },
      { name: "x", odds: 3.4, pct: 29.0 },
      { name: "2", odds: 3.2, pct: 31.0 },
    ], mk)
  );
  ex.onOddsEvent(
    odds(T0 + 1000, [
      { name: "1", odds: 2.0, pct: 50.0 }, // +10
      { name: "x", odds: 4.0, pct: 25.0 }, // -4
      { name: "2", odds: 4.0, pct: 25.0 }, // -6
    ], mk)
  );

  assert.equal(emitted.length, 3);
  assert.ok(emitted[0].text.includes("Espanha"));
  assert.ok(emitted[1].text.includes("empate"));
  assert.ok(emitted[2].text.includes("Inglaterra"));
});
