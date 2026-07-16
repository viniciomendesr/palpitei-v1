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

test("delta abaixo de 3 p.p. não emite, mas atualiza o cache", () => {
  const { ex, emitted } = makeExplainer();

  ex.onOddsEvent(odds(T0, [{ name: "over", odds: 2.08, pct: 48.0 }]));
  ex.onOddsEvent(odds(T0 + 1000, [{ name: "over", odds: 2.0, pct: 50.0 }])); // +2.0
  assert.equal(emitted.length, 0);

  // +3.2 em relação ao ÚLTIMO valor (50.0), não ao primeiro
  ex.onOddsEvent(odds(T0 + 2000, [{ name: "over", odds: 1.88, pct: 53.2 }]));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].fromPct, 50.0);
  assert.equal(emitted[0].toPct, 53.2);
});

test("delta >= 3 p.p. emite explicação com linha do mercado e contexto do gol", () => {
  const { ex, emitted } = makeExplainer();

  ex.onOddsEvent(odds(T0, [{ name: "over", odds: 2.08, pct: 48.0 }]));
  ex.onScoreEvent(goal(T0 + 30_000));
  ex.onOddsEvent(odds(T0 + 60_000, [{ name: "over", odds: 1.88, pct: 53.2 }]));

  assert.equal(emitted.length, 1);
  const m = emitted[0];
  assert.equal(m.type, "odds_explain");
  assert.ok(m.text.includes("mais de 1.5 gols"), `texto: ${m.text}`);
  assert.ok(m.text.includes("subiu de 48.0% para 53.2%"), `texto: ${m.text}`);
  assert.ok(m.text.includes("depois do gol"), `texto: ${m.text}`);
});

test("sem lance recente (>180s) não anexa contexto; queda usa 'caiu'", () => {
  const { ex, emitted } = makeExplainer();

  ex.onScoreEvent(goal(T0 - 300_000)); // gol velho demais
  ex.onOddsEvent(odds(T0, [{ name: "under", odds: 1.92, pct: 52.0 }]));
  ex.onOddsEvent(odds(T0 + 1000, [{ name: "under", odds: 2.1, pct: 47.5 }])); // -4.5

  assert.equal(emitted.length, 1);
  assert.ok(emitted[0].text.includes("caiu de 52.0% para 47.5%"));
  // "depois" solto: o contexto agora sai contraído ("depois do gol"), então
  // procurar "depois de" deixaria de pegar a regressão.
  assert.ok(!emitted[0].text.includes("depois"), `texto: ${emitted[0].text}`);
  assert.ok(emitted[0].text.includes("menos de 1.5 gols"));
});

test("mercado 1X2 traduz price names para nomes dos times e 'empate'", () => {
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
