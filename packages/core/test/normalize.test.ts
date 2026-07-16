import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOdds, normalizeScore } from "../src/normalize.ts";

// Payloads de exemplo montados a partir do mapa de campos verificado pelo
// txline-spike contra a devnet. NÃO é payload da TxLINE versionado (§7): é
// exemplo mínimo escrito à mão a partir do mapa de campos, sem dado real.

const goalRaw = {
  FixtureId: 18241006,
  Seq: 42,
  Ts: 1789000000000,
  Id: 7,
  ConnectionId: "conn-1",
  GameState: "live",
  StatusId: 6,
  Clock: { Running: true, Seconds: 1830 },
  Action: "goal",
  Participant: 1,
  Score: {
    Participant1: {
      H1: { Goals: 1, Corners: 2, YellowCards: 0 },
      Total: { Goals: 2, Corners: 5, YellowCards: 1 },
    },
    Participant2: {
      H1: { Goals: 0, Corners: 1, YellowCards: 1 },
      Total: { Goals: 1, Corners: 3, YellowCards: 2 },
    },
  },
  Stats: { "1": 2, "2": 1, "3008": 3 },
  Data: { Scorer: "Kane" },
};

test("normalizeScore: evento de gol com Score aninhado", () => {
  const ev = normalizeScore(goalRaw);
  assert.ok(ev);
  assert.equal(ev.kind, "score");
  assert.equal(ev.fixtureId, 18241006);
  assert.equal(ev.seq, 42);
  assert.equal(ev.ts, 1789000000000);
  assert.equal(ev.action, "goal");
  assert.equal(ev.statusId, 6);
  assert.deepEqual(ev.goals, { p1: 2, p2: 1 });
  assert.deepEqual(ev.corners, { p1: 5, p2: 3 });
  assert.equal(ev.clockRunning, true);
  assert.equal(ev.clockSeconds, 1830);
  assert.deepEqual(ev.data, { Scorer: "Kane" });
  assert.equal(ev.raw, goalRaw);
});

test("normalizeScore: game_finalised (statusId=100, period=100) sem Score", () => {
  const ev = normalizeScore({
    FixtureId: 18241006,
    Seq: 999,
    Ts: 1789000900000,
    Action: "game_finalised",
    StatusId: 100,
    Period: 100,
  });
  assert.ok(ev);
  assert.equal(ev.action, "game_finalised");
  assert.equal(ev.statusId, 100);
  assert.equal(ev.period, 100);
  // Sem bloco Score, os totais caem para 0 (quem consome usa o último estado conhecido)
  assert.deepEqual(ev.goals, { p1: 0, p2: 0 });
  assert.deepEqual(ev.corners, { p1: 0, p2: 0 });
});

test("normalizeScore: Action vira lowercase", () => {
  const ev = normalizeScore({ FixtureId: 1, Seq: 1, Ts: 1, Action: "CORNER" });
  assert.ok(ev);
  assert.equal(ev.action, "corner");
});

test("normalizeScore: sem FixtureId numérico => null", () => {
  assert.equal(normalizeScore({}), null);
  assert.equal(normalizeScore({ Seq: 1, Ts: 1, Action: "goal" }), null);
  assert.equal(normalizeScore({ FixtureId: "abc" }), null);
  assert.equal(normalizeScore(null), null);
  assert.equal(normalizeScore("goal"), null);
});

// MessageId no formato ESTRUTURADO que o feed manda de verdade (mapa de campos
// do v0, G2). Um `555` aqui esconderia o bug: só o formato real prova o parser.
const MSG_ID = "1837922149:00003:000572-10021-stab";

const oddsRaw = {
  FixtureId: 18241006,
  MessageId: MSG_ID,
  Ts: 1789000000500,
  Bookmaker: "TXLineStablePriceDemargined",
  BookmakerId: 5001,
  InRunning: true,
  SuperOddsType: "OVERUNDER_PARTICIPANT_GOALS",
  MarketParameters: { line: "1.5" },
  MarketPeriod: 0,
  PriceNames: ["over", "under"],
  Prices: [2076, 1804],
  Pct: ["48.170", "55.430"],
};

test("normalizeOdds: Prices x1000 viram odds decimais, Pct string vira number", () => {
  const ev = normalizeOdds(oddsRaw);
  assert.ok(ev);
  assert.equal(ev.kind, "odds");
  assert.equal(ev.fixtureId, 18241006);
  assert.equal(ev.messageId, MSG_ID);
  assert.equal(ev.marketType, "OVERUNDER_PARTICIPANT_GOALS");
  assert.equal(ev.line, 1.5); // MarketParameters.line "1.5" -> 1.5
  assert.equal(ev.inRunning, true);
  assert.equal(ev.bookmaker, "TXLineStablePriceDemargined");
  assert.equal(ev.prices.length, 2);
  assert.deepEqual(ev.prices[0], { name: "over", odds: 2.076, pct: 48.17 });
  assert.deepEqual(ev.prices[1], { name: "under", odds: 1.804, pct: 55.43 });
});

test("normalizeOdds: sem Pct deriva probabilidade implícita da odd", () => {
  const ev = normalizeOdds({
    FixtureId: 1,
    Ts: 1,
    SuperOddsType: "X",
    PriceNames: ["over"],
    Prices: [2000],
  });
  assert.ok(ev);
  assert.equal(ev.prices[0].odds, 2);
  assert.equal(ev.prices[0].pct, 50);
});

test("normalizeOdds: MessageId estruturado sobrevive inteiro (chave de dedupe, G2)", () => {
  // Regressão do G2: num() devolvia NaN->undefined para TODO MessageId real, a
  // chave de dedupe sumia e 3.758 eventos colapsavam num só — calado.
  const a = normalizeOdds({ ...oddsRaw, MessageId: "1837922149:00003:000572-10021-stab" })!;
  const b = normalizeOdds({ ...oddsRaw, MessageId: "1837922149:00003:000573-10021-stab" })!;
  assert.equal(a.messageId, "1837922149:00003:000572-10021-stab");
  assert.notEqual(a.messageId, b.messageId, "ids distintos não podem colidir");

  const dedupe = new Map([a, b].map((e) => [e.messageId, e]));
  assert.equal(dedupe.size, 2, "dois eventos distintos => duas entradas");

  // Id numérico (fonte sintética) vira string, sem perder identidade.
  assert.equal(normalizeOdds({ ...oddsRaw, MessageId: 555 })!.messageId, "555");
  // Ausente continua ausente (não vira "undefined").
  const semId = { ...oddsRaw } as Record<string, unknown>;
  delete semId.MessageId;
  assert.equal(normalizeOdds(semId)!.messageId, undefined);
});

test("normalizeOdds: arrays paralelos desalinhados => null (sem preço fantasma, G8)", () => {
  // 3 nomes, 2 preços: names.map() inventava um 3º preço zerado e o explicador
  // anunciava "a chance caiu para 0.0%". Vazio ≠ zero — e ausente também não.
  assert.equal(
    normalizeOdds({
      FixtureId: 1, Ts: 1, SuperOddsType: "1X2_PARTICIPANT_RESULT",
      PriceNames: ["part1", "draw", "part2"],
      Prices: [2076, 3400],
    }),
    null
  );
  // Pct mais curto que os outros dois também desalinha.
  assert.equal(
    normalizeOdds({
      FixtureId: 1, Ts: 1, SuperOddsType: "1X2_PARTICIPANT_RESULT",
      PriceNames: ["part1", "draw", "part2"],
      Prices: [2076, 3400, 3200],
      Pct: ["48.170", "29.000"],
    }),
    null
  );
  // Prices vazio com PriceNames cheio (o G8 original) segue barrado.
  assert.equal(
    normalizeOdds({
      FixtureId: 1, Ts: 1, SuperOddsType: "1X2_PARTICIPANT_RESULT",
      PriceNames: ["part1", "draw", "part2"],
      Prices: [],
    }),
    null
  );
  // E o caso alinhado continua passando.
  const ok = normalizeOdds({
    FixtureId: 1, Ts: 1, SuperOddsType: "1X2_PARTICIPANT_RESULT",
    PriceNames: ["part1", "draw", "part2"],
    Prices: [2076, 3400, 3200],
    Pct: ["48.170", "29.000", "31.000"],
  });
  assert.ok(ok);
  assert.equal(ok.prices.length, 3);
});

test("normalizeOdds: preço ilegível some da lista, não vira 0% (ausente ≠ zero)", () => {
  const ev = normalizeOdds({
    FixtureId: 1, Ts: 1, SuperOddsType: "1X2_PARTICIPANT_RESULT",
    PriceNames: ["part1", "draw", "part2"],
    Prices: [2076, null, 3200], // alinhados 3/3, mas "draw" não tem preço legível
  });
  assert.ok(ev);
  assert.deepEqual(
    ev.prices.map((p) => p.name),
    ["part1", "part2"],
    "a linha sem preço sai; as outras continuam"
  );
  assert.ok(!ev.prices.some((p) => p.odds === 0 || p.pct === 0), "nenhum zero fantasma");

  // Nenhum preço legível => evento inteiro descartado.
  assert.equal(
    normalizeOdds({
      FixtureId: 1, Ts: 1, SuperOddsType: "X",
      PriceNames: ["over", "under"], Prices: [null, "n/a"],
    }),
    null
  );
});

test("normalizeOdds: payload inválido => null", () => {
  assert.equal(normalizeOdds({ Ts: 1, PriceNames: ["over"], Prices: [2000] }), null); // sem FixtureId
  assert.equal(normalizeOdds({ FixtureId: 1, PriceNames: "over", Prices: [2000] }), null); // PriceNames não-array
  assert.equal(normalizeOdds({ FixtureId: 1, PriceNames: ["over"], Prices: 2000 }), null); // Prices não-array
  assert.equal(normalizeOdds(null), null);
});
