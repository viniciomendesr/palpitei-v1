import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before, beforeEach } from "node:test";

process.env.TXLINE_LOG_SILENT = "true";
// Janela mínima: 1 hora => 12 baldes por feed. Mantém o teste rápido sem mudar
// a lógica sob teste.
process.env.TXLINE_SWEEP_HOURS_BEFORE = "0";
process.env.TXLINE_SWEEP_HOURS_AFTER = "0";

import { baldes, buracosDeSeq, fetchOddsUpdates, fetchScoresUpdates } from "../src/api.ts";
import { resetCredentials } from "../src/auth.ts";
import { TxlineSweepError } from "../src/errors.ts";

const FIXTURE = 18241006;
// 2026-07-18T21:00:00Z — a janela da demo ao vivo.
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
// baldes
// ---------------------------------------------------------------------------

test("baldes cobre a janela inteira em horas UTC", () => {
  const bs = baldes(KICKOFF, 1, 4);
  assert.equal(bs.length, 6, "1h antes + kickoff + 4h depois = 6 horas");
  assert.deepEqual(
    bs.map((b) => b.hora),
    [20, 21, 22, 23, 0, 1],
    "vira o dia em UTC"
  );
  assert.equal(bs[0]!.dia, Math.floor((KICKOFF - 3600_000) / 86400_000));
  // A virada de meia-noite tem de avançar o epochDay, senão a última hora do
  // jogo é buscada no dia errado e volta vazia — em silêncio.
  assert.equal(bs[5]!.dia, bs[0]!.dia + 1);
});

test("a varredura pede os 12 intervalos de 5 min de cada hora (G1)", async () => {
  responder = () => ({ status: 200, body: [] });
  await fetchScoresUpdates(FIXTURE, KICKOFF);

  const dia = Math.floor(KICKOFF / 86400_000);
  const esperadas = Array.from({ length: 12 }, (_, iv) => `/api/scores/updates/${dia}/21/${iv}`);
  assert.deepEqual(rotasPedidas.sort(), esperadas.sort());
  // Varrer só 0..9 perderia 10 min por hora sem erro nenhum.
  assert.ok(rotasPedidas.includes(`/api/scores/updates/${dia}/21/10`));
  assert.ok(rotasPedidas.includes(`/api/scores/updates/${dia}/21/11`));
});

// ---------------------------------------------------------------------------
// scores/updates
// ---------------------------------------------------------------------------

test("fetchScoresUpdates dedupa por Seq, ordena e filtra outras fixtures", async () => {
  responder = (url) => {
    if (url.endsWith("/0")) {
      return {
        status: 200,
        body: [
          { FixtureId: FIXTURE, Seq: 3, Action: "goal" },
          { FixtureId: FIXTURE, Seq: 2, Action: "kickoff" },
          { FixtureId: 999, Seq: 7, Action: "goal" }, // outra partida
        ],
      };
    }
    if (url.endsWith("/1")) {
      // balde repetido: o mesmo Seq 3 aparece de novo
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

test("tolera resposta embrulhada em { updates } e em { rows }", async () => {
  responder = (url) => {
    if (url.endsWith("/0")) return { status: 200, body: { updates: [{ FixtureId: FIXTURE, Seq: 2 }] } };
    if (url.endsWith("/1")) return { status: 200, body: { rows: [{ FixtureId: FIXTURE, Seq: 3 }] } };
    return { status: 200, body: [] };
  };
  const lista = await fetchScoresUpdates(FIXTURE, KICKOFF);
  assert.deepEqual(lista.map((r) => r.Seq), [2, 3]);
});

test("404 de balde é normal e não derruba a varredura", async () => {
  responder = (url) =>
    url.endsWith("/0")
      ? { status: 200, body: [{ FixtureId: FIXTURE, Seq: 2 }] }
      : { status: 404, body: { erro: "sem dados" } };

  const lista = await fetchScoresUpdates(FIXTURE, KICKOFF);
  assert.equal(lista.length, 1);
});

test("varredura 100% com erro real FALHA ALTO — não devolve [] silencioso", async () => {
  // Este é o buraco do v0: `catch {}` em todo balde. Token morto => 144×401 =>
  // "0 eventos", indistinguível de "a devnet não tem essa partida".
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
// seq
// ---------------------------------------------------------------------------

test("buracosDeSeq encontra o evento que existiu e não chegou", () => {
  assert.deepEqual(buracosDeSeq([{ Seq: 2 }, { Seq: 3 }, { Seq: 4 }]), []);
  assert.deepEqual(buracosDeSeq([{ Seq: 2 }, { Seq: 5 }, { Seq: 6 }]), [{ de: 2, ate: 5 }]);
  assert.deepEqual(buracosDeSeq([]), []);
});

// ---------------------------------------------------------------------------
// odds/updates
// ---------------------------------------------------------------------------

test("fetchOddsUpdates filtra ao mercado 1X2 de jogo inteiro (G2)", async () => {
  responder = (url) =>
    url.endsWith("/0")
      ? {
          status: 200,
          body: [
            { FixtureId: FIXTURE, MessageId: "a", SuperOddsType: "1X2_PARTICIPANT_RESULT", Ts: 1 },
            // ruído: 35 mil eventos / 12 MB que o produto não usa
            { FixtureId: FIXTURE, MessageId: "b", SuperOddsType: "OVERUNDER_PARTICIPANT_GOALS", Ts: 2 },
            { FixtureId: FIXTURE, MessageId: "c", SuperOddsType: "ASIAN_HANDICAP", Ts: 3 },
            // 1X2 de um PERÍODO (1º tempo) não é o mercado de jogo inteiro
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

test("MessageId é STRING: a série não pode colapsar num registro só", async () => {
  // O bug real: `num("1837922149:00003:000572-10021-stab")` => NaN => -1 para
  // TODAS as linhas => o Map guardava uma só. A série inteira sumia sem erro.
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
            Ts: 100 - i * 10, // fora de ordem de propósito
          })),
        }
      : { status: 200, body: [] };

  const lista = await fetchOddsUpdates(FIXTURE, KICKOFF);
  assert.equal(lista.length, 3, "3 mensagens distintas continuam 3");
  assert.deepEqual(lista.map((r) => r.Ts), [80, 90, 100], "ordenadas por Ts");
});

test("a mesma MessageId repetida em baldes vizinhos vira um evento só", async () => {
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
