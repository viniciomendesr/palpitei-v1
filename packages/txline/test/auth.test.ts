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

test("startGuestSession pega o token e guarda em memória", async () => {
  const jwt = await startGuestSession();
  assert.equal(jwt, "jwt-1");
  assert.equal(getCredentials().jwt, "jwt-1");
});

test("startGuestSession falha alto quando a resposta não traz token", async () => {
  process.env.TXLINE_JWT_URL = `${base}/auth/guest/sem-token`;
  await assert.rejects(() => startGuestSession(), /sem token na resposta/);
  process.env.TXLINE_JWT_URL = `${base}/auth/guest/start`;
});

test("ensureJwt abre sessão só quando não há JWT em memória", async () => {
  await ensureJwt();
  await ensureJwt();
  await ensureJwt();
  assert.equal(sessoesGuest, 1);
});

test("as credenciais vêm do ambiente e podem ser injetadas em memória", async () => {
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

test("txlineGet manda Authorization e X-Api-Token, e resolve o path contra o baseUrl", async () => {
  setCredentials({ apiToken: "tok-abc" });
  await ensureJwt();
  await txlineGet("/dados");

  assert.equal(recebidos.length, 1);
  assert.equal(recebidos[0]!.url, "/api/dados", "o path entra relativo ao baseUrl, sem duplicar /api");
  assert.equal(recebidos[0]!.auth, "Bearer jwt-1");
  assert.equal(recebidos[0]!.apiToken, "tok-abc");
});

test("401 renova o JWT e repete a requisição", async () => {
  await startGuestSession(); // tokenValido = jwt-1
  setCredentials({ jwt: "expirado" }); // the server rejects it

  const r = await txlineGet<{ ok: boolean }>("/dados");
  assert.equal(r.ok, true);
  assert.equal(sessoesGuest, 2, "abriu exatamente uma sessão nova");
  assert.equal(getCredentials().jwt, "jwt-2");
});

test("N requisições que tomam 401 juntas renovam o JWT UMA vez (single-flight)", async () => {
  await startGuestSession();
  setCredentials({ jwt: "expirado" });
  // Delay guest-session creation so requests overlap in the refresh window.
  atrasoGuestMs = 50;

  const rs = await Promise.all(
    Array.from({ length: 8 }, (_, i) => txlineGet<{ ok: boolean }>(`/dados?i=${i}`))
  );

  assert.ok(rs.every((r) => r.ok));
  assert.equal(sessoesGuest, 2, "1 sessão inicial + 1 única renovação para as 8");
});

test("erro que não é 401 vira TxlineHttpError com o status", async () => {
  await ensureJwt();
  await assert.rejects(
    () => txlineGet("/explode"),
    (e: unknown) => e instanceof TxlineHttpError && e.status === 500
  );
});

test("401 que persiste depois da renovação não vira loop", async () => {
  await ensureJwt(); // one session
  recusaTudo = true; // even a fresh JWT is rejected

  await assert.rejects(
    () => txlineGet("/dados"),
    (e: unknown) => e instanceof TxlineHttpError && e.status === 401
  );
  assert.equal(sessoesGuest, 2, "renovou UMA vez e desistiu — sem repetir para sempre");
});
