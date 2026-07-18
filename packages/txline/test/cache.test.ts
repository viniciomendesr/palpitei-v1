import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.TXLINE_LOG_SILENT = "true";

import {
  adaptDbCacheStore,
  hasUsableMatchCache,
  createFileMatchCacheStore,
  createInMemoryMatchCacheStore,
  type MatchCacheRecord,
} from "../src/cache.ts";
import { loadReplayEvents } from "../src/ingest/replay.ts";

function registro(fixtureId: number, scores: unknown[] = [{ Seq: 2 }]): MatchCacheRecord {
  return {
    fixtureId,
    p1: "França",
    p2: "Inglaterra",
    startTime: Date.UTC(2026, 6, 18, 21, 0, 0),
    gravadoEm: Date.now(),
    fonte: "txline-updates",
    scores,
    odds: [],
  };
}

test("store em memória: guarda, lê e lista", async () => {
  const store = createInMemoryMatchCacheStore();
  assert.equal(await store.get(1), null);

  await store.put(registro(1));
  const lido = await store.get(1);
  assert.equal(lido?.p1, "França");
  assert.deepEqual(await store.list?.(), [1]);
});

test("hasUsableMatchCache rejects records without score events", () => {
  assert.equal(hasUsableMatchCache(null), false);
  assert.equal(hasUsableMatchCache(registro(1, [])), false, "sem scores não há linha do tempo");
  assert.equal(hasUsableMatchCache(registro(1)), true);
});

// ---------------------------------------------------------------------------
// The DB store exposes load/save/list while this port expects get/put/list.
// Dynamic imports bypass type checking, so the adapter prevents a missing method
// from being silently treated as an unavailable cache.

/** Mirrors the public createPalpitei().cache surface from @palpitei/db. */
function fakeDbStore(inicial: MatchCacheRecord[] = []) {
  const mapa = new Map<number, MatchCacheRecord>(inicial.map((r) => [r.fixtureId, r]));
  const store = {
    async load(fixtureId: number) {
      return mapa.get(fixtureId) ?? null;
    },
    async save(cache: MatchCacheRecord) {
      mapa.set(cache.fixtureId, cache);
      return { fixtureId: cache.fixtureId, scoresGravados: cache.scores.length };
    },
    async list() {
      return [...mapa.keys()];
    },
    async has(fixtureId: number) {
      return mapa.has(fixtureId);
    },
    async stats() {
      return {};
    },
  };
  return Object.assign(store, {
    salvarCache: store.save,
    lerCache: store.load,
    listarCache: store.list,
  });
}

test("o store do db NÃO satisfaz a porta cru — é preciso adaptar", () => {
  const cru = fakeDbStore() as any;
  assert.equal(typeof cru.get, "undefined", "db não tem get — loadReplayEvents chamaria undefined");
  assert.equal(typeof cru.put, "undefined", "db não tem put — cache-match morreria após 144 requisições");
});

test("adaptDbCacheStore traduz load/save/list para get/put/list", async () => {
  const store = adaptDbCacheStore(fakeDbStore([registro(7)]));
  const lido = await store.get(7);
  assert.equal(lido?.p1, "França");
  assert.equal(await store.get(999), null, "ausente vira null, não explode");

  await store.put(registro(8));
  assert.equal((await store.get(8))?.fixtureId, 8);
  assert.deepEqual((await store.list?.())?.sort(), [7, 8]);
});

test("adaptDbCacheStore aceita o vocabulário do v0 (lerCache/salvarCache)", async () => {
  const so_v0 = {
    lerCache: async (id: number) => (id === 1 ? registro(1) : null),
    salvarCache: async () => ({}),
    listarCache: async () => [1],
  };
  const store = adaptDbCacheStore(so_v0);
  assert.equal((await store.get(1))?.fixtureId, 1);
  assert.deepEqual(await store.list?.(), [1]);
});

test("adaptDbCacheStore explode alto no objeto errado, em vez de falhar mudo depois", () => {
  assert.throws(() => adaptDbCacheStore(null), /não é um store do @palpitei\/db/);
  assert.throws(() => adaptDbCacheStore({}), /não é um store do @palpitei\/db/);
  // A disconnected createMatchCacheStore() is truthy; reject it before a later put fails.
  assert.throws(() => adaptDbCacheStore({ has: () => true, stats: () => ({}) }), /esperava load\/save/);
});

test("com o adaptador, o replay usa o cache do db e o badge diz txline-cache", async () => {
  const partida = registro(18241006, [
    { FixtureId: 18241006, Seq: 2, Ts: 1000, Action: "kickoff" },
    { FixtureId: 18241006, Seq: 3, Ts: 2000, Action: "possession" },
    { FixtureId: 18241006, Seq: 4, Ts: 3000, Action: "corner" },
    { FixtureId: 18241006, Seq: 5, Ts: 4000, Action: "shot" },
    { FixtureId: 18241006, Seq: 6, Ts: 5000, Action: "game_finalised" },
  ]);
  // An unreachable port ensures this test fails if it unexpectedly reaches the network.
  process.env.TXLINE_API_BASE_URL = "http://127.0.0.1:1/api";
  process.env.TXLINE_JWT = "x";

  const load = await loadReplayEvents(
    { fixtureId: 18241006, p1: "França", p2: "Inglaterra", startTime: partida.startTime },
    { cache: adaptDbCacheStore(fakeDbStore([partida])) }
  );
  assert.equal(load.source, "txline-cache");
  assert.equal(load.events.length, 5);
});

test("store em arquivo: ida e volta, e ENOENT vira null", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palpitei-cache-"));
  try {
    const store = createFileMatchCacheStore(dir);
    assert.equal(await store.get(42), null, "fixture ausente não explode");

    await store.put(registro(42, [{ Seq: 2 }, { Seq: 3 }]));
    const lido = await store.get(42);
    assert.equal(lido?.fixtureId, 42);
    assert.equal(lido?.scores.length, 2);
    assert.deepEqual(await store.list?.(), [42]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
