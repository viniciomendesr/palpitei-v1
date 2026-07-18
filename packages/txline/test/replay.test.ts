import assert from "node:assert/strict";
import test from "node:test";

process.env.TXLINE_LOG_SILENT = "true";

import type { Fixture, NormEvent } from "@palpitei/core";
import { createInMemoryMatchCacheStore } from "../src/cache.ts";
import { generateDemoEvents } from "../src/ingest/demo.ts";
import { ReplayRunner, isMatchInProgress, maxReplayGapMs, replayDurationMs, hasRealMatchContent, loadReplayEvents } from "../src/ingest/replay.ts";

const FIXTURE: Fixture = {
  fixtureId: 18241006,
  p1: "França",
  p2: "Inglaterra",
  startTime: Date.UTC(2026, 6, 18, 21, 0, 0),
};

function score(ts: number, extra: Partial<NormEvent> = {}): any {
  return {
    kind: "score",
    fixtureId: FIXTURE.fixtureId,
    seq: ts,
    ts,
    action: "possession",
    hasScore: true,
    goals: { p1: 0, p2: 0 },
    corners: { p1: 0, p2: 0 },
    raw: {},
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// gap compression
// ---------------------------------------------------------------------------

test("maxReplayGapMs caps accelerated and real-time replay gaps (G3)", () => {
  assert.equal(maxReplayGapMs(60, false), 2_000);
  assert.equal(maxReplayGapMs(60, true), 2_000);
  assert.equal(maxReplayGapMs(1, false), 2_000, "pré-jogo no 1x continua comprimido");
  assert.equal(maxReplayGapMs(1, true), 60_000);
});

test("isMatchInProgress is true only while the match clock runs", () => {
  assert.equal(isMatchInProgress(score(1, { clockRunning: true })), true);
  assert.equal(isMatchInProgress(score(1, { clockRunning: false })), false);
  assert.equal(isMatchInProgress(score(1)), false, "metadado de pré-jogo não tem clock");
  assert.equal(isMatchInProgress({ kind: "odds", fixtureId: 1, ts: 1, marketType: "x", prices: [], raw: {} }), false);
});

test("ReplayRunner emite tudo, em ordem, e ancora o ts da partida", async () => {
  const events = [score(1000), score(2000), score(3000)];
  const vistos: number[] = [];
  const runner = new ReplayRunner(events, 1000, (e) => vistos.push(e.ts), () => {});
  runner.start();
  assert.equal(runner.startedAtMatchTs, 1000, "âncora do cursorClock é o 1º evento");

  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(vistos, [1000, 2000, 3000]);
});

test("ReplayRunner comprime o buraco gigante do feed", (t) => {
  // There are 3.6 days between pre-match metadata and kickoff. Without a cap,
  // replay would wait 5,184,000 ms (86 minutes wall-clock) even at 60x.
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const events = [score(0, { clockRunning: true }), score(311_040_000, { clockRunning: true })];
  const vistos: number[] = [];
  let fim = false;
  const runner = new ReplayRunner(events, 60, (e) => vistos.push(e.ts), () => {
    fim = true;
  });
  runner.start();

  t.mock.timers.tick(0);
  assert.deepEqual(vistos, [0], "1º evento sai imediatamente");

  t.mock.timers.tick(1_999);
  assert.equal(fim, false, "ainda dentro do teto");

  t.mock.timers.tick(1);
  assert.deepEqual(vistos, [0, 311_040_000], "o buraco foi comprimido a exatamente 2s");
  assert.equal(fim, true);
});

test("ReplayRunner: ts fora de ordem não vira delay negativo (A3)", async () => {
  // The snapshot is sampled and can include a `goal` timestamped before kickoff.
  const events = [score(5000), score(1000)];
  const vistos: number[] = [];
  const runner = new ReplayRunner(events, 1, (e) => vistos.push(e.ts), () => {});
  runner.start();
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(vistos, [5000, 1000], "emitiu na ordem da lista, sem travar");
});

test("stop() cala o runner", async () => {
  const events = [score(0, { clockRunning: true }), score(60_000, { clockRunning: true })];
  const vistos: number[] = [];
  const runner = new ReplayRunner(events, 1, (e) => vistos.push(e.ts), () => {});
  runner.start();
  await new Promise((r) => setTimeout(r, 10));
  runner.stop();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(vistos.length, 1, "o 2º evento não saiu depois do stop");
});

test("ReplayRunner com lista vazia chama onDone e não trava", async () => {
  let pronto = false;
  new ReplayRunner([], 60, () => {}, () => {
    pronto = true;
  }).start();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(pronto, true);
});

test("finishNow drena eventos reais restantes e conclui uma única vez", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events = [
    score(0, { clockRunning: true }),
    score(60_000, { clockRunning: true }),
    score(120_000, { clockRunning: true, action: "game_finalised" }),
  ];
  const vistos: number[] = [];
  let finais = 0;
  const runner = new ReplayRunner(events, 1, (e) => vistos.push(e.ts), () => finais++);
  runner.start();
  t.mock.timers.tick(0);
  runner.finishNow();
  runner.finishNow();

  assert.deepEqual(vistos, [0, 60_000, 120_000]);
  assert.equal(finais, 1);
  assert.equal(runner.isRunning, false);
});

test("estimativa usa exatamente os mesmos tetos do runner", () => {
  const events = [
    score(0),
    score(6_000, { clockRunning: true }),
    score(606_000, { clockRunning: true }),
  ];
  assert.equal(replayDurationMs(events, 60), 2_010);
});

// ---------------------------------------------------------------------------
// real match content
// ---------------------------------------------------------------------------

test("hasRealMatchContent exige apito, finalização e volume", () => {
  assert.equal(hasRealMatchContent([]), false);
  assert.equal(
    hasRealMatchContent([score(1, { action: "kickoff" }), score(2, { action: "game_finalised" })]),
    false,
    "2 eventos não são uma partida"
  );
  const partida = [
    score(1, { action: "kickoff" }),
    score(2),
    score(3),
    score(4),
    score(5, { action: "game_finalised" }),
  ];
  assert.equal(hasRealMatchContent(partida), true);
  assert.equal(
    hasRealMatchContent(partida.map((e) => ({ ...e, action: "possession" }))),
    false,
    "sem apito não é partida"
  );
});

// ---------------------------------------------------------------------------
// source chain
// ---------------------------------------------------------------------------

test("cache primeiro: nem toca na API, e o badge diz txline-cache", async () => {
  const store = createInMemoryMatchCacheStore([
    {
      fixtureId: FIXTURE.fixtureId,
      p1: "França",
      p2: "Inglaterra",
      startTime: FIXTURE.startTime!,
      gravadoEm: Date.now(),
      fonte: "txline-updates",
      scores: [
        { FixtureId: FIXTURE.fixtureId, Seq: 2, Ts: 1000, Action: "kickoff" },
        { FixtureId: FIXTURE.fixtureId, Seq: 3, Ts: 2000, Action: "possession" },
        { FixtureId: FIXTURE.fixtureId, Seq: 4, Ts: 3000, Action: "corner" },
        { FixtureId: FIXTURE.fixtureId, Seq: 5, Ts: 4000, Action: "shot" },
        { FixtureId: FIXTURE.fixtureId, Seq: 6, Ts: 5000, Action: "game_finalised" },
      ],
      odds: [],
    },
  ]);

  // An unreachable TXLINE_API_BASE_URL makes an accidental network request fail.
  const load = await loadReplayEvents(FIXTURE, { cache: store });
  assert.equal(load.source, "txline-cache");
  assert.equal(load.fromTxline, true, "cache é dado real da TxLINE, só gravado");
  assert.equal(load.events.length, 5);
  assert.equal(load.events[0]!.ts, 1000);
});

test("o sintético é opt-in: sem allowSynthetic, erra em vez de inventar partida", async () => {
  const store = createInMemoryMatchCacheStore(); // empty
  process.env.TXLINE_API_BASE_URL = "http://127.0.0.1:1/api"; // unreachable port
  process.env.TXLINE_JWT = "x";

  await assert.rejects(
    () => loadReplayEvents({ ...FIXTURE, startTime: undefined }, { cache: store }),
    /a devnet não tem dados de partida|ECONNREFUSED|fetch failed/
  );
});

// ---------------------------------------------------------------------------
// synthetic (development only)
// ---------------------------------------------------------------------------

test("gerador sintético é determinístico por fixtureId", () => {
  const agora = Date.UTC(2026, 6, 16, 12, 0, 0);
  const a = generateDemoEvents(FIXTURE, agora);
  const b = generateDemoEvents(FIXTURE, agora);
  assert.deepEqual(
    a.map((e) => `${e.kind}:${e.ts}`),
    b.map((e) => `${e.kind}:${e.ts}`),
    "mesmo id + mesmo relógio => mesma partida (bug em replay sintético é reproduzível)"
  );

  const acoes = (evs: NormEvent[]): string[] =>
    evs.filter((e) => e.kind === "score").map((e) => e.action);
  const outro = generateDemoEvents({ ...FIXTURE, fixtureId: 999 }, agora);
  assert.notDeepEqual(acoes(a), acoes(outro), "fixtureId diferente => partida diferente");
});

test("a partida sintética tem apito e fim — e passa no teste de conteúdo real", () => {
  const events = generateDemoEvents(FIXTURE, Date.UTC(2026, 6, 16, 12, 0, 0));
  assert.equal(hasRealMatchContent(events), true);
  const scores = events.filter((e) => e.kind === "score");
  assert.ok(scores.some((e) => e.action === "game_finalised"));
  assert.ok(events.some((e) => e.kind === "odds"), "gera odds para o explicador ter o que ler");
});
