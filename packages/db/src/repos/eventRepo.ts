/** Match-event timeline persistence. `(fixture_id, seq)` makes SSE redelivery idempotent. */

import type { Db, Row } from '../pool.js';
import type { ScoreEvent } from '../types.js';

export type UpsertStats = { gravados: number; repetidos: number };

/** Extracts numeric fields from a score block. */
function numericos(bloco: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries((bloco ?? {}) as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function mapEvent(r: Row): ScoreEvent {
  const totals = (r.score_totals as { p1?: Record<string, number>; p2?: Record<string, number> } | null) ?? null;
  const hasScore = Boolean(r.has_score);
  const p1 = totals?.p1 ?? {};
  const p2 = totals?.p2 ?? {};

  const ev: ScoreEvent = {
    kind: 'score',
    fixtureId: Number(r.fixture_id),
    seq: Number(r.seq),
    ts: Number(r.ts),
    action: String(r.action),
    hasScore,
    // Without Score, zero is a placeholder and must be read with hasScore=false.
    goals: { p1: p1.Goals ?? 0, p2: p2.Goals ?? 0 },
    corners: { p1: p1.Corners ?? 0, p2: p2.Corners ?? 0 },
    raw: r.raw,
  };
  if (r.status_id != null) ev.statusId = Number(r.status_id);
  if (r.period != null) ev.period = Number(r.period);
  if (r.clock_running != null) ev.clockRunning = Boolean(r.clock_running);
  if (r.clock_seconds != null) ev.clockSeconds = Number(r.clock_seconds);
  if (hasScore && totals) ev.totals = { p1, p2 };
  return ev;
}

export function createEventRepo(db: Db) {
  const repo = {
    /** True when inserted; false when an SSE redelivery already existed. */
    async upsert(ev: ScoreEvent): Promise<boolean> {
      const rows = await db.query(
        `
        insert into match_events (fixture_id, seq, ts, action, status_id, period,
                                  clock_running, clock_seconds, has_score, score_totals, raw)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
        on conflict (fixture_id, seq) do nothing
        returning seq
        `,
        [
          ev.fixtureId,
          ev.seq,
          ev.ts,
          ev.action,
          ev.statusId ?? null,
          ev.period ?? null,
          ev.clockRunning ?? null,
          ev.clockSeconds ?? null,
          ev.hasScore,
          // Store null when Score is absent; normalized zero values are placeholders.
          ev.hasScore && ev.totals ? JSON.stringify(ev.totals) : null,
          JSON.stringify(ev.raw ?? null),
        ]
      );
      return rows.length > 0;
    },

    async upsertMany(events: ScoreEvent[]): Promise<UpsertStats> {
      let gravados = 0;
      const TAM_LOTE = 500;
      await db.withTx(async (tx) => {
        for (let inicio = 0; inicio < events.length; inicio += TAM_LOTE) {
          const lote = events.slice(inicio, inicio + TAM_LOTE).map((ev) => ({
            fixture_id: ev.fixtureId,
            seq: ev.seq,
            ts: ev.ts,
            action: ev.action,
            status_id: ev.statusId ?? null,
            period: ev.period ?? null,
            clock_running: ev.clockRunning ?? null,
            clock_seconds: ev.clockSeconds ?? null,
            has_score: ev.hasScore,
            score_totals: ev.hasScore && ev.totals ? ev.totals : null,
            raw: ev.raw ?? null,
          }));
          const rows = await tx.query(
            `
            insert into match_events
              (fixture_id, seq, ts, action, status_id, period, clock_running,
               clock_seconds, has_score, score_totals, raw)
            select fixture_id, seq, ts, action, status_id, period, clock_running,
                   clock_seconds, has_score, score_totals, raw
              from jsonb_to_recordset($1::jsonb) as x(
                fixture_id bigint, seq integer, ts bigint, action text,
                status_id integer, period integer, clock_running boolean,
                clock_seconds integer, has_score boolean,
                score_totals jsonb, raw jsonb
              )
            on conflict (fixture_id, seq) do nothing
            returning seq
            `,
            [JSON.stringify(lote)]
          );
          gravados += rows.length;
        }
      });
      return { gravados, repetidos: events.length - gravados };
    },

    /** Persists raw TxLINE payloads for cache and ingest paths. */
    async upsertManyRaw(rows: unknown[]): Promise<UpsertStats> {
      const events: ScoreEvent[] = [];
      for (const raw of rows) {
        const ev = mapRawScoreEvent(raw);
        if (ev) events.push(ev);
      }
      return repo.upsertMany(events);
    },

    async listByFixture(fixtureId: number, opts: { limit?: number } = {}): Promise<ScoreEvent[]> {
      const rows = await db.query(
        `select fixture_id, seq, ts, action, status_id, period, clock_running,
                clock_seconds, has_score, score_totals, raw
           from match_events
          where fixture_id = $1
          order by seq
          limit $2`,
        [fixtureId, opts.limit ?? 100_000]
      );
      return rows.map(mapEvent);
    },

    /** Compact normalized projection for the interactive room path. */
    async listReplayByFixture(
      fixtureId: number,
      opts: { limit?: number } = {}
    ): Promise<ScoreEvent[]> {
      const rows = await db.query(
        `select fixture_id, seq, ts, action, status_id, period, clock_running,
                clock_seconds, has_score, score_totals
           from match_events
          where fixture_id = $1
          order by seq
          limit $2`,
        [fixtureId, opts.limit ?? 100_000]
      );
      return rows.map(mapEvent);
    },

    /** Raw payloads in sequence order for replay and cache consumers. */
    async listRaw(fixtureId: number): Promise<unknown[]> {
      const rows = await db.query(`select raw from match_events where fixture_id = $1 order by seq`, [
        fixtureId,
      ]);
      return rows.map((r) => r.raw);
    },

    async lastEvent(fixtureId: number): Promise<ScoreEvent | null> {
      const rows = await db.query(
        `select fixture_id, seq, ts, action, status_id, period, clock_running,
                clock_seconds, has_score, score_totals, raw
           from match_events where fixture_id = $1 order by seq desc limit 1`,
        [fixtureId]
      );
      return rows[0] ? mapEvent(rows[0]) : null;
    },

    /** Latest known score; events without Score are ignored. */
    async ultimoPlacar(fixtureId: number): Promise<{ p1: number; p2: number } | null> {
      const rows = await db.query(
        `select score_totals from match_events
          where fixture_id = $1 and has_score and score_totals is not null
          order by seq desc limit 1`,
        [fixtureId]
      );
      if (!rows[0]) return null;
      const t = rows[0].score_totals as { p1?: Record<string, number>; p2?: Record<string, number> };
      return { p1: t?.p1?.Goals ?? 0, p2: t?.p2?.Goals ?? 0 };
    },

    /**
     * Reads final goals and corners from the latest known value per key; terminal
     * events can omit Score, and VAR can legitimately decrease a total.
     */
    async totaisFinais(
      fixtureId: number
    ): Promise<{ goals: { p1: number; p2: number }; corners: { p1: number; p2: number } } | null> {
      const rows = await db.query(
        `select score_totals from match_events
          where fixture_id = $1 and has_score and score_totals is not null
          order by seq`,
        [fixtureId]
      );
      if (rows.length === 0) return null;

      const ultimo: { goals: { p1: number | null; p2: number | null }; corners: { p1: number | null; p2: number | null } } = {
        goals: { p1: null, p2: null },
        corners: { p1: null, p2: null },
      };
      for (const r of rows) {
        const t = r.score_totals as { p1?: Record<string, number>; p2?: Record<string, number> } | null;
        for (const lado of ['p1', 'p2'] as const) {
          const g = t?.[lado]?.Goals;
          if (g != null) ultimo.goals[lado] = Number(g);
          const c = t?.[lado]?.Corners;
          if (c != null) ultimo.corners[lado] = Number(c);
        }
      }
      return {
        goals: { p1: ultimo.goals.p1 ?? 0, p2: ultimo.goals.p2 ?? 0 },
        corners: { p1: ultimo.corners.p1 ?? 0, p2: ultimo.corners.p2 ?? 0 },
      };
    },

    /**
     * Every Total key the feed ever reported, merged by key and never replaced.
     *
     * The key set is partial and grows DURING the match (measured on 18241006:
     * the first event carrying a Score block has an EMPTY Total), so replacing
     * the map per event would make a line blink and vanish. Merging is the same
     * rule the live room applies in memory.
     */
    async totaisAcumulados(
      fixtureId: number
    ): Promise<{ p1: Record<string, number>; p2: Record<string, number> }> {
      const rows = await db.query(
        `select score_totals from match_events
          where fixture_id = $1 and has_score and score_totals is not null
          order by seq`,
        [fixtureId]
      );
      const totais: { p1: Record<string, number>; p2: Record<string, number> } = { p1: {}, p2: {} };
      for (const r of rows) {
        const t = r.score_totals as { p1?: Record<string, number>; p2?: Record<string, number> } | null;
        for (const lado of ['p1', 'p2'] as const) {
          const bloco = t?.[lado];
          if (!bloco) continue;
          for (const [chave, valor] of Object.entries(bloco)) {
            if (typeof valor === 'number') totais[lado][chave] = valor;
          }
        }
      }
      return totais;
    },

    async count(fixtureId: number): Promise<number> {
      const rows = await db.query(`select count(*)::int as n from match_events where fixture_id = $1`, [
        fixtureId,
      ]);
      return Number(rows[0]?.n ?? 0);
    },

    /** Returns missing sequence ranges so ingestion gaps remain observable. */
    async findSeqGaps(fixtureId: number): Promise<{ de: number; ate: number; faltam: number }[]> {
      const rows = await db.query(
        `
        select anterior + 1 as de, seq - 1 as ate, seq - anterior - 1 as faltam
          from (
            select seq, lag(seq) over (order by seq) as anterior
              from match_events where fixture_id = $1
          ) t
         where anterior is not null and seq - anterior > 1
         order by de
        `,
        [fixtureId]
      );
      return rows.map((r) => ({ de: Number(r.de), ate: Number(r.ate), faltam: Number(r.faltam) }));
    },
  };

  return repo;
}

/**
 * Maps raw TxLINE data to ScoreEvent while tolerating field casing. It is
 * intentionally limited to fields persisted by the database.
 */
export function mapRawScoreEvent(raw: unknown): ScoreEvent | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const fixtureId = Number(r.FixtureId ?? r.fixtureId);
  if (!Number.isFinite(fixtureId)) return null;

  const score = r.Score ?? r.score;
  const clock = r.Clock ?? r.clock;
  const hasScore = score != null;

  const totalDe = (p: 'Participant1' | 'Participant2'): Record<string, number> => {
    const bloco = score?.[p] ?? score?.[p.toLowerCase()];
    return numericos(bloco?.Total ?? bloco?.total ?? {});
  };

  const p1 = hasScore ? totalDe('Participant1') : {};
  const p2 = hasScore ? totalDe('Participant2') : {};

  const ev: ScoreEvent = {
    kind: 'score',
    fixtureId,
    seq: Number(r.Seq ?? r.seq) || 0,
    ts: Number(r.Ts ?? r.ts) || 0,
    action: String(r.Action ?? r.action ?? '').toLowerCase(),
    hasScore,
    goals: { p1: p1.Goals ?? 0, p2: p2.Goals ?? 0 },
    corners: { p1: p1.Corners ?? 0, p2: p2.Corners ?? 0 },
    raw,
  };
  const statusId = Number(r.StatusId ?? r.statusId);
  if (Number.isFinite(statusId)) ev.statusId = statusId;
  const period = Number(r.Period ?? r.period);
  if (Number.isFinite(period)) ev.period = period;
  if (clock) {
    ev.clockRunning = Boolean(clock.Running ?? clock.running);
    const secs = Number(clock.Seconds ?? clock.seconds);
    if (Number.isFinite(secs)) ev.clockSeconds = secs;
  }
  if (hasScore) ev.totals = { p1, p2 };
  return ev;
}

export type EventRepo = ReturnType<typeof createEventRepo>;
