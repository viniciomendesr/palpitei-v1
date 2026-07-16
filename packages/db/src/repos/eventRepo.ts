// eventRepo — a linha do tempo da partida (/scores/updates).
//
// A idempotência sai de graça do UNIQUE (fixture_id, seq): o stream SSE
// reconecta com Last-Event-ID e REENVIA eventos. Sem a chave, cada reconexão
// duplicaria gols na timeline; com ela, reenviar é no-op.

import type { Db, Row } from '../pool.js';
import type { ScoreEvent } from '../types.js';

export type UpsertStats = { gravados: number; repetidos: number };

/** Só os campos numéricos do bloco (espelha normalize.ts do v0). */
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
    // Sem bloco Score não há placar: 0 aqui é PLACEHOLDER e só pode ser lido
    // junto com hasScore=false. Quem ignorar isso faz o placar regredir a 0–0 e
    // inventa gol (A4).
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
    /** true = gravou agora; false = já existia (reenvio do stream). */
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
          // A4 no ponto exato onde ele nasce: o normalize devolve `totals` com
          // zeros mesmo quando o evento não trouxe bloco Score. Gravar esses
          // zeros seria gravar um placar que o feed nunca mandou. Sem Score,
          // NULL — e o CHECK do banco recusa qualquer outra coisa.
          ev.hasScore && ev.totals ? JSON.stringify(ev.totals) : null,
          JSON.stringify(ev.raw ?? null),
        ]
      );
      return rows.length > 0;
    },

    async upsertMany(events: ScoreEvent[]): Promise<UpsertStats> {
      let gravados = 0;
      let repetidos = 0;
      await db.withTx(async (tx) => {
        for (const ev of events) {
          const rows = await tx.query(
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
              ev.hasScore && ev.totals ? JSON.stringify(ev.totals) : null,
              JSON.stringify(ev.raw ?? null),
            ]
          );
          if (rows.length > 0) gravados++;
          else repetidos++;
        }
      });
      return { gravados, repetidos };
    },

    /** Grava payloads CRUS da TxLINE (caminho do cache/ingestão). */
    async upsertManyRaw(rows: unknown[]): Promise<UpsertStats> {
      const events: ScoreEvent[] = [];
      for (const raw of rows) {
        const ev = rawParaEvento(raw);
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

    /** Payloads crus, na ordem de seq — é o que o replay/cache consome. */
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

    /** Último placar CONHECIDO: ignora os eventos sem bloco Score (A4). */
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

    async count(fixtureId: number): Promise<number> {
      const rows = await db.query(`select count(*)::int as n from match_events where fixture_id = $1`, [
        fixtureId,
      ]);
      return Number(rows[0]?.n ?? 0);
    },

    /**
     * Buracos na sequência.
     *
     * O seq da TxLINE é CONTÍNUO (2→963 na partida provada). Então um buraco não
     * é curiosidade: é evento perdido — e evento perdido pode ser o gol que
     * resolvia o desafio. Isto existe para que "perdi um evento" seja uma
     * consulta, e não uma descoberta na frente do jurado.
     */
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
 * Payload cru da TxLINE -> ScoreEvent, tolerante a caixa (o feed documenta
 * PascalCase, mas não há garantia formal). É o mesmo mapeamento do normalize.ts
 * do v0, restrito ao que o banco guarda.
 */
export function rawParaEvento(raw: unknown): ScoreEvent | null {
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
