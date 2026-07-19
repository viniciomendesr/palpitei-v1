import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOdds, normalizeScore } from "../src/normalize.ts";

// Handwritten example payloads derived from a field map verified against devnet.
// They do not contain versioned TxLINE data.

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

test("normalizeScore: goal event with a nested Score", () => {
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

test("normalizeScore: game_finalised (statusId=100, period=100) with no Score", () => {
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
  // Without Score, totals are zero placeholders; consumers retain the last known state.
  assert.deepEqual(ev.goals, { p1: 0, p2: 0 });
  assert.deepEqual(ev.corners, { p1: 0, p2: 0 });
});

test("normalizeScore: Action is lowercased", () => {
  const ev = normalizeScore({ FixtureId: 1, Seq: 1, Ts: 1, Action: "CORNER" });
  assert.ok(ev);
  assert.equal(ev.action, "corner");
});

test("normalizeScore: no numeric FixtureId => null", () => {
  assert.equal(normalizeScore({}), null);
  assert.equal(normalizeScore({ Seq: 1, Ts: 1, Action: "goal" }), null);
  assert.equal(normalizeScore({ FixtureId: "abc" }), null);
  assert.equal(normalizeScore(null), null);
  assert.equal(normalizeScore("goal"), null);
});

// Use the structured MessageId format emitted by the feed; a numeric ID would
// not exercise the parser's production shape.
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

test("normalizeOdds: Prices x1000 become decimal odds, a Pct string becomes a number", () => {
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

test("normalizeOdds: with no Pct it derives the implied probability from the price", () => {
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

test("normalizeOdds: a structured MessageId survives whole (dedupe key, G2)", () => {
  // Regression: structured IDs must remain distinct deduplication keys.
  const a = normalizeOdds({ ...oddsRaw, MessageId: "1837922149:00003:000572-10021-stab" })!;
  const b = normalizeOdds({ ...oddsRaw, MessageId: "1837922149:00003:000573-10021-stab" })!;
  assert.equal(a.messageId, "1837922149:00003:000572-10021-stab");
  assert.notEqual(a.messageId, b.messageId, "distinct ids must not collide");

  const dedupe = new Map([a, b].map((e) => [e.messageId, e]));
  assert.equal(dedupe.size, 2, "two distinct events => two entries");

  // A numeric synthetic-source ID becomes a string without losing identity.
  assert.equal(normalizeOdds({ ...oddsRaw, MessageId: 555 })!.messageId, "555");
  // An absent ID remains absent rather than becoming the string "undefined".
  const semId = { ...oddsRaw } as Record<string, unknown>;
  delete semId.MessageId;
  assert.equal(normalizeOdds(semId)!.messageId, undefined);
});

test("normalizeOdds: misaligned parallel arrays => null (no phantom price, G8)", () => {
  // Mismatched parallel arrays must not invent a zero-priced third outcome.
  assert.equal(
    normalizeOdds({
      FixtureId: 1, Ts: 1, SuperOddsType: "1X2_PARTICIPANT_RESULT",
      PriceNames: ["part1", "draw", "part2"],
      Prices: [2076, 3400],
    }),
    null
  );
  // A shorter Pct array is also misaligned.
  assert.equal(
    normalizeOdds({
      FixtureId: 1, Ts: 1, SuperOddsType: "1X2_PARTICIPANT_RESULT",
      PriceNames: ["part1", "draw", "part2"],
      Prices: [2076, 3400, 3200],
      Pct: ["48.170", "29.000"],
    }),
    null
  );
  // Empty Prices with populated PriceNames remains invalid.
  assert.equal(
    normalizeOdds({
      FixtureId: 1, Ts: 1, SuperOddsType: "1X2_PARTICIPANT_RESULT",
      PriceNames: ["part1", "draw", "part2"],
      Prices: [],
    }),
    null
  );
  // Aligned arrays remain valid.
  const ok = normalizeOdds({
    FixtureId: 1, Ts: 1, SuperOddsType: "1X2_PARTICIPANT_RESULT",
    PriceNames: ["part1", "draw", "part2"],
    Prices: [2076, 3400, 3200],
    Pct: ["48.170", "29.000", "31.000"],
  });
  assert.ok(ok);
  assert.equal(ok.prices.length, 3);
});

test("normalizeOdds: an unreadable price drops from the list, it never becomes 0% (absent != zero)", () => {
  const ev = normalizeOdds({
    FixtureId: 1, Ts: 1, SuperOddsType: "1X2_PARTICIPANT_RESULT",
    PriceNames: ["part1", "draw", "part2"],
    Prices: [2076, null, 3200], // Aligned 3/3, but "draw" has no readable price.
  });
  assert.ok(ev);
  assert.deepEqual(
    ev.prices.map((p) => p.name),
    ["part1", "part2"],
    "the row with no price leaves; the others remain"
  );
  assert.ok(!ev.prices.some((p) => p.odds === 0 || p.pct === 0), "no phantom zero");

  // No readable price means the full event is discarded.
  assert.equal(
    normalizeOdds({
      FixtureId: 1, Ts: 1, SuperOddsType: "X",
      PriceNames: ["over", "under"], Prices: [null, "n/a"],
    }),
    null
  );
});

test("normalizeOdds: invalid payload => null", () => {
  assert.equal(normalizeOdds({ Ts: 1, PriceNames: ["over"], Prices: [2000] }), null); // Missing FixtureId.
  assert.equal(normalizeOdds({ FixtureId: 1, PriceNames: "over", Prices: [2000] }), null); // PriceNames is not an array.
  assert.equal(normalizeOdds({ FixtureId: 1, PriceNames: ["over"], Prices: 2000 }), null); // Prices is not an array.
  assert.equal(normalizeOdds(null), null);
});
