import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before, beforeEach } from "node:test";

process.env.TXLINE_LOG_SILENT = "true";
// Minimum window: one hour means 12 buckets per feed. Keep the test fast without
// changing the behavior under test.
process.env.TXLINE_SWEEP_HOURS_BEFORE = "0";
process.env.TXLINE_SWEEP_HOURS_AFTER = "0";

import {
  createTimeBuckets,
  fetchFixtures,
  findSequenceGaps,
  fetchOddsUpdates,
  fetchScoresUpdates,
} from "../src/api.ts";
import { resetCredentials } from "../src/auth.ts";
import { TxlineSweepError } from "../src/errors.ts";

const FIXTURE = 18241006;
// 2026-07-18T21:00:00Z — the live-demo window.
const KICKOFF = Date.UTC(2026, 6, 18, 21, 0, 0);

let server: http.Server;
let base: string;
let rotasPedidas: string[] = [];
let responder: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: [] });

before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/auth/guest/start") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: "jwt-teste" }));
      return;
    }
    rotasPedidas.push(url);
    const { status, body } = responder(url);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  process.env.TXLINE_API_BASE_URL = `${base}/api`;
  process.env.TXLINE_JWT_URL = `${base}/auth/guest/start`;
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  rotasPedidas = [];
  process.env.TXLINE_JWT = "jwt-teste";
  process.env.TXLINE_API_TOKEN = "tok";
  resetCredentials();
});

// ---------------------------------------------------------------------------
// buckets
// ---------------------------------------------------------------------------

test("createTimeBuckets covers the full UTC-hour window", () => {
  const bs = createTimeBuckets(KICKOFF, 1, 4);
  assert.equal(bs.length, 6, "1h before + kickoff + 4h after = 6 hours");
  assert.deepEqual(
    bs.map((b) => b.hour),
    [20, 21, 22, 23, 0, 1],
    "it rolls over the day in UTC"
  );
  assert.equal(bs[0]!.day, Math.floor((KICKOFF - 3600_000) / 86400_000));
  // Crossing midnight must advance epochDay or the final match hour is fetched
  // from the wrong day and silently returns no data.
  assert.equal(bs[5]!.day, bs[0]!.day + 1);
});

test("the sweep requests all 12 five-minute intervals of every hour (G1)", async () => {
  responder = () => ({ status: 200, body: [] });
  await fetchScoresUpdates(FIXTURE, KICKOFF);

  const dia = Math.floor(KICKOFF / 86400_000);
  const esperadas = Array.from({ length: 12 }, (_, iv) => `/api/scores/updates/${dia}/21/${iv}`);
  assert.deepEqual(rotasPedidas.sort(), esperadas.sort());
  // Sweeping only 0..9 would silently omit 10 minutes from every hour.
  assert.ok(rotasPedidas.includes(`/api/scores/updates/${dia}/21/10`));
  assert.ok(rotasPedidas.includes(`/api/scores/updates/${dia}/21/11`));
});

// ---------------------------------------------------------------------------
// score updates
// ---------------------------------------------------------------------------

test("fetchScoresUpdates dedupes by Seq, sorts, and filters out other fixtures", async () => {
  responder = (url) => {
    if (url.endsWith("/0")) {
      return {
        status: 200,
        body: [
          { FixtureId: FIXTURE, Seq: 3, Action: "goal" },
          { FixtureId: FIXTURE, Seq: 2, Action: "kickoff" },
          { FixtureId: 999, Seq: 7, Action: "goal" }, // another fixture
        ],
      };
    }
    if (url.endsWith("/1")) {
      // Duplicate bucket: the same Seq 3 appears again.
      return { status: 200, body: [{ FixtureId: FIXTURE, Seq: 3, Action: "goal" }] };
    }
    return { status: 200, body: [] };
  };

  const lista = await fetchScoresUpdates(FIXTURE, KICKOFF);
  assert.deepEqual(
    lista.map((r) => r.Seq),
    [2, 3]
  );
});

test("it tolerates a response wrapped in { updates } and in { rows }", async () => {
  responder = (url) => {
    if (url.endsWith("/0")) return { status: 200, body: { updates: [{ FixtureId: FIXTURE, Seq: 2 }] } };
    if (url.endsWith("/1")) return { status: 200, body: { rows: [{ FixtureId: FIXTURE, Seq: 3 }] } };
    return { status: 200, body: [] };
  };
  const lista = await fetchScoresUpdates(FIXTURE, KICKOFF);
  assert.deepEqual(lista.map((r) => r.Seq), [2, 3]);
});

test("a 404 on a bucket is normal and does not bring the sweep down", async () => {
  responder = (url) =>
    url.endsWith("/0")
      ? { status: 200, body: [{ FixtureId: FIXTURE, Seq: 2 }] }
      : { status: 404, body: { erro: "sem dados" } };

  const lista = await fetchScoresUpdates(FIXTURE, KICKOFF);
  assert.equal(lista.length, 1);
});

test("a sweep that fails 100% with a real error FAILS LOUD — it never returns a silent []", async () => {
  // A blanket `catch {}` would turn an expired token into an indistinguishable
  // empty event list.
  responder = () => ({ status: 401, body: { erro: "token morto" } });

  await assert.rejects(
    () => fetchScoresUpdates(FIXTURE, KICKOFF),
    (e: unknown) =>
      e instanceof TxlineSweepError &&
      /falhou em TODAS/.test(e.message) &&
      /TXLINE_API_TOKEN/.test(e.message)
  );
});

// ---------------------------------------------------------------------------
// sequences
// ---------------------------------------------------------------------------

test("findSequenceGaps finds events that did not arrive", () => {
  assert.deepEqual(findSequenceGaps([{ Seq: 2 }, { Seq: 3 }, { Seq: 4 }]), []);
  assert.deepEqual(findSequenceGaps([{ Seq: 2 }, { Seq: 5 }, { Seq: 6 }]), [{ from: 2, to: 5 }]);
  assert.deepEqual(findSequenceGaps([]), []);
});

// ---------------------------------------------------------------------------
// odds updates
// ---------------------------------------------------------------------------

test("fetchOddsUpdates filters down to the full-match 1X2 market (G2)", async () => {
  responder = (url) =>
    url.endsWith("/0")
      ? {
          status: 200,
          body: [
            { FixtureId: FIXTURE, MessageId: "a", SuperOddsType: "1X2_PARTICIPANT_RESULT", Ts: 1 },
            // Noise: 35k events / 12 MB that the product does not use.
            { FixtureId: FIXTURE, MessageId: "b", SuperOddsType: "OVERUNDER_PARTICIPANT_GOALS", Ts: 2 },
            { FixtureId: FIXTURE, MessageId: "c", SuperOddsType: "ASIAN_HANDICAP", Ts: 3 },
            // A period 1X2 market (first half) is not the full-match market.
            {
              FixtureId: FIXTURE,
              MessageId: "d",
              SuperOddsType: "1X2_PARTICIPANT_RESULT",
              MarketPeriod: 1,
              Ts: 4,
            },
          ],
        }
      : { status: 200, body: [] };

  const lista = await fetchOddsUpdates(FIXTURE, KICKOFF);
  assert.deepEqual(lista.map((r) => r.MessageId), ["a"]);
});

test("MessageId is a STRING: the series must not collapse into a single record", async () => {
  // Parsing this string as a number produces NaN, which previously collapsed
  // every row to one Map entry and silently discarded the full series.
  const ids = [
    "1837922149:00003:000572-10021-stab",
    "1837922149:00004:000573-10021-stab",
    "1837922149:00005:000574-10021-stab",
  ];
  responder = (url) =>
    url.endsWith("/0")
      ? {
          status: 200,
          body: ids.map((MessageId, i) => ({
            FixtureId: FIXTURE,
            MessageId,
            SuperOddsType: "1X2_PARTICIPANT_RESULT",
            Ts: 100 - i * 10, // intentionally out of order
          })),
        }
      : { status: 200, body: [] };

  const lista = await fetchOddsUpdates(FIXTURE, KICKOFF);
  assert.equal(lista.length, 3, "3 distinct messages stay 3");
  assert.deepEqual(lista.map((r) => r.Ts), [80, 90, 100], "sorted by Ts");
});

test("the same MessageId repeated across neighbouring buckets becomes a single event", async () => {
  const linha = {
    FixtureId: FIXTURE,
    MessageId: "1837922149:00003:000572-10021-stab",
    SuperOddsType: "1X2_PARTICIPANT_RESULT",
    Ts: 50,
  };
  responder = (url) =>
    url.endsWith("/0") || url.endsWith("/1") ? { status: 200, body: [linha] } : { status: 200, body: [] };

  const lista = await fetchOddsUpdates(FIXTURE, KICKOFF);
  assert.equal(lista.length, 1);
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

// The devnet dataset rotates: the competition that used to fill the snapshot
// eventually disappears from it. On 2026-07-20 competition 72 returned zero and
// the six remaining fixtures were all competition 430, so a name filter left the
// app with an empty match list.
const FORA_DA_COPA = {
  FixtureId: 18272873,
  Participant1: "Azerbaijan",
  Participant2: "Tajikistan",
  Competition: "Friendlies",
  CompetitionId: 430,
  StartTime: Date.UTC(2026, 8, 23, 15, 0, 0),
  GameState: 0,
};

test("o nome da competição vem do feed e não é presumido (G6)", async () => {
  process.env.TXLINE_COMPETITION_ID = "";
  responder = () => ({ status: 200, body: [FORA_DA_COPA] });

  const [fx] = await fetchFixtures();
  // The snapshot carries the real name. Dropping it makes the room label fall
  // back to an invented competition — provenance that lies is the G6.
  assert.equal(fx!.competition, "Friendlies");
  assert.equal(fx!.competitionId, 430);
});

test("a competição configurada vazia cai para o snapshot inteiro sem filtrar por nome", async () => {
  process.env.TXLINE_COMPETITION_ID = "72";
  responder = (url) =>
    url.includes("competitionId=") ? { status: 200, body: [] } : { status: 200, body: [FORA_DA_COPA] };

  const fixtures = await fetchFixtures();
  assert.equal(fixtures.length, 1, "a fixture fora da Copa não pode ser descartada");
  assert.equal(fixtures[0]!.fixtureId, 18272873);
  assert.equal(fixtures[0]!.p1, "Azerbaijan");
});

test("a competição configurada, quando devolve linhas, é a que vale", async () => {
  process.env.TXLINE_COMPETITION_ID = "430";
  responder = (url) =>
    url.includes("competitionId=430") ? { status: 200, body: [FORA_DA_COPA] } : { status: 200, body: [] };

  const fixtures = await fetchFixtures();
  assert.equal(fixtures.length, 1);
  assert.ok(
    rotasPedidas.every((u) => !u.includes("snapshot?") || u.includes("competitionId=")),
    "não deve buscar o snapshot inteiro quando a competição já respondeu",
  );
});
