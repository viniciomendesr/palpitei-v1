// Durable match timelines backed by match_events and match_odds. TxLINE payloads
// stay in Postgres rather than the public repository.

import type { Db } from './pool.js';
import type { CacheSource, MatchCache } from './types.js';
import { createEventRepo } from './repos/eventRepo.js';
import { createMatchRepo } from './repos/matchRepo.js';
import { createOddsRepo } from './repos/oddsRepo.js';

export type SaveCacheStats = {
  fixtureId: number;
  scoresGravados: number;
  scoresRepetidos: number;
  oddsGravadas: number;
  oddsRepetidas: number;
  oddsForaDoMercado: number;
  buracos: { de: number; ate: number; faltam: number }[];
};

export function createMatchCacheStore(db: Db) {
  const matches = createMatchRepo(db);
  const events = createEventRepo(db);
  const odds = createOddsRepo(db);

  const store = {
    /** Saves a timeline idempotently. startTime is required to anchor question windows. */
    async save(cache: MatchCache): Promise<SaveCacheStats> {
      if (!Number.isFinite(cache.startTime) || cache.startTime <= 0) {
        throw new Error(
          `[cache] fixture ${cache.fixtureId} sem startTime — recusado. ` +
            `Sem o horário do apito a janela do desafio final nasce fechada (G4).`
        );
      }
      if (!Array.isArray(cache.scores) || cache.scores.length === 0) {
        throw new Error(`[cache] fixture ${cache.fixtureId} sem eventos de placar — nada a gravar.`);
      }

      await matches.upsert(
        {
          fixtureId: cache.fixtureId,
          p1: cache.p1,
          p2: cache.p2,
          startTime: cache.startTime,
        },
        { source: cache.fonte, cachedAt: cache.gravadoEm }
      );

      const s = await events.upsertManyRaw(cache.scores);
      const o = await odds.upsertManyRaw(cache.odds ?? []);
      const buracos = await events.findSeqGaps(cache.fixtureId);

      return {
        fixtureId: cache.fixtureId,
        scoresGravados: s.gravados,
        scoresRepetidos: s.repetidos,
        oddsGravadas: o.gravados,
        oddsRepetidas: o.repetidos,
        oddsForaDoMercado: o.foraDoMercado,
        buracos,
      };
    },

    /** Loads a persisted timeline, or null so replay may fall back to the API. */
    async load(fixtureId: number): Promise<MatchCache | null> {
      const match = await matches.findById(fixtureId);
      if (!match) return null;

      const scores = await events.listRaw(fixtureId);
      if (scores.length === 0) return null;

      const oddsRaw = await odds.listRaw(fixtureId);

      // Preserve persisted cache time; returning Date.now() would hide cache age.
      const [meta] = await db.query(
        `select extract(epoch from cached_at) * 1000 as gravado_ms, cache_source
           from matches where fixture_id = $1`,
        [fixtureId]
      );

      if (match.startTime == null) {
        // Do not derive start time from the first event; callers can decide how to handle it.
        console.warn(
          `[cache] fixture ${fixtureId} está sem start_ts no banco — ` +
            `a janela do desafio final vai ancorar no 1º evento (G4).`
        );
      }

      return {
        fixtureId,
        p1: match.p1,
        p2: match.p2,
        startTime: match.startTime ?? 0,
        gravadoEm: meta?.gravado_ms == null ? 0 : Math.round(Number(meta.gravado_ms)),
        fonte: (meta?.cache_source as CacheSource | null) ?? 'txline-cache',
        scores,
        odds: oddsRaw,
      };
    },

    /** Fixtures with timelines that can replay without devnet. */
    async list(): Promise<number[]> {
      const rows = await db.query(
        `select distinct fixture_id from match_events order by fixture_id`
      );
      return rows.map((r) => Number(r.fixture_id));
    },

    async has(fixtureId: number): Promise<boolean> {
      const rows = await db.query(
        `select 1 from match_events where fixture_id = $1 limit 1`,
        [fixtureId]
      );
      return rows.length > 0;
    },

    /** Persisted summary used by replay UI and ingestion checks. */
    async stats(fixtureId: number): Promise<{
      scores: number;
      odds: number;
      seqDe: number | null;
      seqAte: number | null;
      buracos: number;
      fonte: CacheSource | null;
    }> {
      const [r] = await db.query(
        `select (select count(*)::int from match_events where fixture_id = $1) as scores,
                (select count(*)::int from match_odds   where fixture_id = $1) as odds,
                (select min(seq)::int from match_events where fixture_id = $1) as seq_de,
                (select max(seq)::int from match_events where fixture_id = $1) as seq_ate,
                (select cache_source from matches where fixture_id = $1) as fonte`,
        [fixtureId]
      );
      const buracos = await events.findSeqGaps(fixtureId);
      return {
        scores: Number(r?.scores ?? 0),
        odds: Number(r?.odds ?? 0),
        seqDe: r?.seq_de == null ? null : Number(r.seq_de),
        seqAte: r?.seq_ate == null ? null : Number(r.seq_ate),
        buracos: buracos.length,
        fonte: (r?.fonte as CacheSource | null) ?? null,
      };
    },
  };

  // Legacy aliases keep the adapter structurally compatible with v0 callers.
  return Object.assign(store, {
    salvarCache: store.save,
    lerCache: store.load,
    listarCache: store.list,
  });
}

export type MatchCacheStore = ReturnType<typeof createMatchCacheStore>;
