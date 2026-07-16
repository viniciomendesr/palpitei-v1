// Cache de partida: busca a linha do tempo completa UMA vez e guarda.
//
// Motivo: o dataset da devnet ROTACIONA (A1) — a fixture 18241006 já sumiu da
// lista e hoje só os endpoints de dados a servem. Depender da devnet no dia da
// demo é apostar que ela não vai mudar. Com cache, o replay é reproduzível,
// instantâneo e roda offline. Continua sendo dado real da TxLINE, só gravado.
//
// T&C §7: o payload é licenciado só para o hackathon e a redistribuição é
// PROIBIDA. Na v1 o cache é POSTGRES — não `.cache/` versionado. Este arquivo
// define só a PORTA; o SQL mora no pacote db.

import { info, warn } from "./log.ts";

/**
 * Origem do que foi gravado. Espelha o CacheSource do @palpitei/db de propósito:
 * o db é quem implementa esta porta, e tipo divergente entre os dois pacotes só
 * apareceria como erro na hora de ligar um no outro. Se mexer aqui, mexa lá.
 *
 * Na prática só gravamos "txline-updates" — é a única fonte que vale cachear
 * (a linha do tempo completa). As outras existem para o registro ser honesto
 * caso um dia se grave outra coisa: rótulo de proveniência não pode mentir (G6).
 */
export type MatchCacheFonte =
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
  fonte: MatchCacheFonte;
  /** Payloads CRUS da TxLINE (normalizados na leitura, pelo core). */
  scores: unknown[];
  odds: unknown[];
};

/**
 * A porta que o @palpitei/db implementa (Postgres). O pacote txline nunca
 * escreve SQL: ele só sabe pedir "me dá a fixture X" e "guarda esta aqui".
 */
export type MatchCacheStore = {
  get(fixtureId: number): Promise<MatchCacheRecord | null>;
  put(record: MatchCacheRecord): Promise<void>;
  /** Ids em cache — para a aba "Replays" listar o que roda offline. */
  list?(): Promise<number[]>;
};

/** Registro utilizável? Sem scores não há linha do tempo. */
export function cacheUtil(c: MatchCacheRecord | null): c is MatchCacheRecord {
  if (!c) return false;
  if (!Array.isArray(c.scores) || c.scores.length === 0) {
    warn(`[cache] fixture ${c.fixtureId} sem eventos de placar — ignorando`);
    return false;
  }
  return true;
}

/**
 * O vocabulário do @palpitei/db, adaptado para esta porta.
 *
 * POR QUE ISTO EXISTE: o db implementa a MESMA ideia com OUTROS nomes —
 * `load`/`save`/`list` (+ os apelidos do v0 `lerCache`/`salvarCache`/
 * `listarCache`). Esta porta fala `get`/`put`/`list`. Os TIPOS batem
 * (MatchCacheRecord ≡ MatchCache, MatchCacheFonte ≡ CacheSource), mas os
 * MÉTODOS não — e nada no sistema de tipos ligava um no outro, porque o db
 * entra por import dinâmico (`any`).
 *
 * O modo de falha era silencioso e caro: passar o store do db direto para
 * `loadReplayEvents({ cache })` fazia `cache.get(...)` ser `undefined`, o
 * TypeError caía no `catch` que existe para tolerar cache indisponível, e o
 * replay varria 144 requisições A CADA VEZ, dizendo só "cache indisponível".
 * O cache — que é O caminho da demo — nunca era usado, e nada quebrava.
 *
 * Por isso o adaptador VALIDA e explode na cara de quem liga errado, em vez de
 * devolver um objeto que só falha lá na frente.
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
    // O save() do db devolve estatísticas; a porta promete void.
    put: async (record) => {
      await gravar.call(dbStore, record);
    },
    list: typeof listar === "function" ? () => listar.call(dbStore) : undefined,
  };
}

/** Store em memória — testes e desenvolvimento. Não persiste nada. */
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
 * Store em arquivo — DESENVOLVIMENTO OFFLINE, nada mais.
 *
 * Existe porque o `cache:match` precisa rodar antes de o Postgres estar de pé, e
 * porque dev sem rede ainda quer ver a partida. O diretório está no .gitignore:
 * versionar payload da TxLINE viola o T&C §7. Em produção, use o store do db.
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
