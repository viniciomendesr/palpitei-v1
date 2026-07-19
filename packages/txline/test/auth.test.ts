import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before, beforeEach } from "node:test";

process.env.TXLINE_LOG_SILENT = "true";

import {
  ensureJwt,
  getCredentials,
  resetCredentials,
  setCredentials,
  startGuestSession,
  txlineGet,
} from "../src/auth.ts";
import { TxlineHttpError } from "../src/errors.ts";

// Local server that emulates guest sessions and the protected TxLINE route.

let server: http.Server;
let base: string;
let sessoesGuest = 0;
let tokenValido = "";
let recebidos: { auth?: string; apiToken?: string; url: string }[] = [];
let atrasoGuestMs = 0;
// Rejects even a refreshed JWT to emulate an unrecoverable credential failure.
let recusaTudo = false;

before(async () => {
  server = http.createServer(async (req, res) => {
    const url = req.url ?? "";

    if (req.method === "POST" && url === "/auth/guest/start") {
      sessoesGuest += 1;
      tokenValido = `jwt-${sessoesGuest}`;
      if (atrasoGuestMs) await new Promise((r) => setTimeout(r, atrasoGuestMs));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: tokenValido }));
      return;
    }

    if (url === "/auth/guest/sem-token") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ nada: true }));
      return;
    }

    recebidos.push({
      auth: req.headers["authorization"] as string | undefined,
      apiToken: req.headers["x-api-token"] as string | undefined,
      url,
    });

    if (recusaTudo || req.headers["authorization"] !== `Bearer ${tokenValido}`) {
      res.writeHead(401);
      res.end("token velho");
      return;
    }
    if (url.startsWith("/api/explode")) {
      res.writeHead(500);
      res.end("boom");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, url }));
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
  sessoesGuest = 0;
  tokenValido = "";
  recebidos = [];
  atrasoGuestMs = 0;
  recusaTudo = false;
  process.env.TXLINE_JWT = "";
  process.env.TXLINE_API_TOKEN = "";
  resetCredentials();
});

test("startGuestSession fetches the token and keeps it in memory", async () => {
  const jwt = await startGuestSession();
  assert.equal(jwt, "jwt-1");
  assert.equal(getCredentials().jwt, "jwt-1");
});

test("startGuestSession fails loud when the response carries no token", async () => {
  process.env.TXLINE_JWT_URL = `${base}/auth/guest/sem-token`;
  await assert.rejects(() => startGuestSession(), /sem token na resposta/);
  process.env.TXLINE_JWT_URL = `${base}/auth/guest/start`;
});

test("ensureJwt only opens a session when there is no JWT in memory", async () => {
  await ensureJwt();
  await ensureJwt();
  await ensureJwt();
  assert.equal(sessoesGuest, 1);
});

test("credentials come from the environment and can be injected in memory", async () => {
  process.env.TXLINE_JWT = "do-ambiente";
  process.env.TXLINE_API_TOKEN = "token-do-ambiente";
  resetCredentials();

  assert.equal(getCredentials().jwt, "do-ambiente");
  assert.equal(getCredentials().apiToken, "token-do-ambiente");

  // Runtime injection supports token rotation without a restart.
  setCredentials({ apiToken: "token-novo" });
  assert.equal(getCredentials().apiToken, "token-novo");
  assert.equal(getCredentials().jwt, "do-ambiente");
});

test("txlineGet sends Authorization and X-Api-Token, and resolves the path against baseUrl", async () => {
  setCredentials({ apiToken: "tok-abc" });
  await ensureJwt();
  await txlineGet("/dados");

  assert.equal(recebidos.length, 1);
  assert.equal(recebidos[0]!.url, "/api/dados", "the path goes in relative to baseUrl, without duplicating /api");
  assert.equal(recebidos[0]!.auth, "Bearer jwt-1");
  assert.equal(recebidos[0]!.apiToken, "tok-abc");
});

test("a 401 renews the JWT and repeats the request", async () => {
  await startGuestSession(); // tokenValido = jwt-1
  setCredentials({ jwt: "expirado" }); // the server rejects it

  const r = await txlineGet<{ ok: boolean }>("/dados");
  assert.equal(r.ok, true);
  assert.equal(sessoesGuest, 2, "it opened exactly one new session");
  assert.equal(getCredentials().jwt, "jwt-2");
});

test("N requests that hit 401 together renew the JWT ONCE (single-flight)", async () => {
  await startGuestSession();
  setCredentials({ jwt: "expirado" });
  // Delay guest-session creation so requests overlap in the refresh window.
  atrasoGuestMs = 50;

  const rs = await Promise.all(
    Array.from({ length: 8 }, (_, i) => txlineGet<{ ok: boolean }>(`/dados?i=${i}`))
  );

  assert.ok(rs.every((r) => r.ok));
  assert.equal(sessoesGuest, 2, "1 initial session + a single renewal for all 8");
});

test("a non-401 error becomes a TxlineHttpError carrying the status", async () => {
  await ensureJwt();
  await assert.rejects(
    () => txlineGet("/explode"),
    (e: unknown) => e instanceof TxlineHttpError && e.status === 500
  );
});

test("a 401 that persists after renewal does not become a loop", async () => {
  await ensureJwt(); // one session
  recusaTudo = true; // even a fresh JWT is rejected

  await assert.rejects(
    () => txlineGet("/dados"),
    (e: unknown) => e instanceof TxlineHttpError && e.status === 401
  );
  assert.equal(sessoesGuest, 2, "it renewed ONCE and gave up — no retrying forever");
});
