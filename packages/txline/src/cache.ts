// Match-timeline cache. TxLINE payloads are licensed for the hackathon and must
// remain in Postgres, never in versioned local files. This module defines ports;
// SQL lives in @palpitei/db.

import { info, warn } from "./log.ts";

/**
 * Source of persisted data. Keep this union aligned with @palpitei/db CacheSource
 * so origin labels remain accurate.
 */
export type MatchCacheSource =
  | "txline-updates"
  | "txline-cache"
  | "txline-historical"
  | "txline-snapshot"
  | "txline-live"
  | "synthetic";

export type MatchCacheRecord = {
  fixtureId: number;
  p1: string;
  p2: string;
  startTime: number;
  gravadoEm: number;
  fonte: MatchCacheSource;
  /** Raw TxLINE payloads, normalized by core when read. */
  scores: unknown[];
  odds: unknown[];
};

/**
 * Port implemented by @palpitei/db. This package never executes SQL.
 */
export type MatchCacheStore = {
  get(fixtureId: number): Promise<MatchCacheRecord | null>;
  put(record: MatchCacheRecord): Promise<void>;
  /** Cached IDs for listing offline-capable replays. */
  list?(): Promise<number[]>;
};

/** A record requires score events to represent a usable timeline. */
export function hasUsableMatchCache(c: MatchCacheRecord | null): c is MatchCacheRecord {
  if (!c) return false;
  if (!Array.isArray(c.scores) || c.scores.length === 0) {
    warn(`[cache] fixture ${c.fixtureId} sem eventos de placar — ignorando`);
    return false;
  }
  return true;
}

/**
 * Adapts @palpitei/db's load/save/list vocabulary to this get/put/list port.
 * Validate method presence eagerly because dynamic imports bypass type checking.
 */
export function adaptDbCacheStore(dbStore: any): MatchCacheStore {
  const ler = dbStore?.load ?? dbStore?.lerCache;
  const gravar = dbStore?.save ?? dbStore?.salvarCache;
  const listar = dbStore?.list ?? dbStore?.listarCache;

  if (typeof ler !== "function" || typeof gravar !== "function") {
    throw new TypeError(
      "[cache] o objeto passado para adaptDbCacheStore() não é um store do @palpitei/db: " +
        `esperava load/save (ou lerCache/salvarCache), achei [${Object.keys(dbStore ?? {}).join(", ") || "nada"}]. ` +
        "Use createPalpitei().cache — createMatchCacheStore() exige uma conexão Db."
    );
  }

  return {
    get: (fixtureId) => ler.call(dbStore, fixtureId),
    // The database save returns stats; this port promises void.
    put: async (record) => {
      await gravar.call(dbStore, record);
    },
    list: typeof listar === "function" ? () => listar.call(dbStore) : undefined,
  };
}

/** In-memory store for tests and development. */
export function createInMemoryMatchCacheStore(
  inicial: MatchCacheRecord[] = []
): MatchCacheStore & { size(): number } {
  const mapa = new Map<number, MatchCacheRecord>(inicial.map((r) => [r.fixtureId, r]));
  return {
    async get(fixtureId) {
      return mapa.get(fixtureId) ?? null;
    },
    async put(record) {
      mapa.set(record.fixtureId, record);
    },
    async list() {
      return [...mapa.keys()];
    },
    size() {
      return mapa.size;
    },
  };
}

/**
 * File store for offline development only. Its directory must stay gitignored;
 * production uses the database-backed store.
 */
export function createFileMatchCacheStore(dir: string): MatchCacheStore {
  const arquivo = async (fixtureId: number): Promise<string> => {
    const path = await import("node:path");
    return path.join(dir, `${fixtureId}.json`);
  };

  return {
    async get(fixtureId) {
      const fs = await import("node:fs/promises");
      const p = await arquivo(fixtureId);
      try {
        const c = JSON.parse(await fs.readFile(p, "utf8")) as MatchCacheRecord;
        info(
          `[cache:arquivo] fixture ${fixtureId}: ${c.scores?.length ?? 0} scores + ${c.odds?.length ?? 0} odds ` +
            `(gravado ${new Date(c.gravadoEm).toISOString().slice(0, 16)})`
        );
        return c;
      } catch (e: any) {
        if (e?.code !== "ENOENT") warn(`[cache:arquivo] ${p} ilegível: ${e?.message}`);
        return null;
      }
    },
    async put(record) {
      const fs = await import("node:fs/promises");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(await arquivo(record.fixtureId), JSON.stringify(record));
      warn(
        `[cache:arquivo] fixture ${record.fixtureId} gravada em ${dir} — payload da TxLINE. ` +
          `NÃO versione (T&C §7); em produção o cache é o Postgres.`
      );
    },
    async list() {
      const fs = await import("node:fs/promises");
      try {
        const nomes = await fs.readdir(dir);
        return nomes
          .filter((f) => f.endsWith(".json"))
          .map((f) => Number(f.replace(".json", "")))
          .filter((n) => Number.isInteger(n));
      } catch {
        return [];
      }
    },
  };
}
