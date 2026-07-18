// Odds-series persistence for /odds/updates. Message IDs remain opaque strings
// for deduplication; ingest filters records to the supported full-game 1X2 market.

import type { Db, Row } from '../pool.js';
import type { OddsEvent } from '../types.js';

/** Market consumed by v1. */
export const MERCADO_1X2 = '1X2_PARTICIPANT_RESULT';

export type OddsUpsertStats = {
  gravados: number;
  repetidos: number;
  /** Discarded by market filtering (over/under, handicap, period). */
  foraDoMercado: number;
  /** Discarded because required identification fields are missing. */
  ilegiveis: number;
};

/**
 * Full-game 1X2 requires the expected SuperOddsType and an absent MarketPeriod.
 * == null intentionally accepts null and undefined but not zero.
 */
export function isFullGame1x2(raw: unknown): boolean {
  if (raw == null || typeof raw !== 'object') return false;
  const r = raw as Record<string, any>;
  const tipo = String(r.SuperOddsType ?? r.superOddsType ?? '');
  const periodo = r.MarketPeriod ?? r.marketPeriod;
  return tipo === MERCADO_1X2 && periodo == null;
}

/**
 * Row key based on string MessageId, with timestamp and prices fallback.
 */
export function oddsMessageKey(raw: Record<string, any>): string {
  const id = raw.MessageId ?? raw.messageId;
  if (id != null && String(id).length > 0) return String(id);
  const ts = raw.Ts ?? raw.ts;
  const prices = raw.Prices ?? raw.prices;
  return `${ts}:${prices}`;
}

function numero(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Projects normalized cache columns into the replay contract without exposing raw payloads.
 */
function mapReplayOdds(r: Row): OddsEvent | null {
  const names = r.price_names;
  const priceInts = r.prices;
  const pcts = r.pct;
  if (!Array.isArray(names) || !Array.isArray(priceInts) || priceInts.length === 0) return null;
  if (names.length !== priceInts.length) return null;
  if (Array.isArray(pcts) && pcts.length !== names.length) return null;

  const prices: OddsEvent['prices'] = [];
  for (let i = 0; i < names.length; i++) {
    const raw1000 = numero(priceInts[i]);
    if (raw1000 === undefined || raw1000 <= 0) continue;
    const odds = raw1000 / 1000;
    let pct = Number.parseFloat(String(Array.isArray(pcts) ? pcts[i] : ''));
    if (!Number.isFinite(pct)) pct = Number(((1 / odds) * 100).toFixed(3));
    prices.push({ name: String(names[i]), odds, pct });
  }
  if (prices.length === 0) return null;

  const ev: OddsEvent = {
    kind: 'odds',
    fixtureId: Number(r.fixture_id),
    ts: Number(r.ts),
    messageId: String(r.message_id),
    marketType: String(r.market_type),
    prices,
    // Compact projections do not transport raw audit payloads.
    raw: null,
  };
  if (r.market_period != null) ev.marketPeriod = String(r.market_period);
  if (r.line != null) ev.line = Number(r.line);
  if (r.in_running != null) ev.inRunning = Boolean(r.in_running);
  if (r.bookmaker != null) ev.bookmaker = String(r.bookmaker);
  return ev;
}

export function createOddsRepo(db: Db) {
  const repo = {
    /**
     * Persists raw payloads already filtered to v1's market and returns filter stats.
     */
    async upsertManyRaw(rows: unknown[]): Promise<OddsUpsertStats> {
      const stats: OddsUpsertStats = { gravados: 0, repetidos: 0, foraDoMercado: 0, ilegiveis: 0 };

      const usados: Record<string, any>[] = [];
      for (const raw of rows) {
        if (raw == null || typeof raw !== 'object') {
          stats.ilegiveis++;
          continue;
        }
        if (!isFullGame1x2(raw)) {
          stats.foraDoMercado++;
          continue;
        }
        usados.push(raw as Record<string, any>);
      }

      const preparados: Record<string, unknown>[] = [];
      for (const r of usados) {
        const fixtureId = Number(r.FixtureId ?? r.fixtureId);
        const names = r.PriceNames ?? r.priceNames;
        if (!Number.isFinite(fixtureId) || !Array.isArray(names)) {
          stats.ilegiveis++;
          continue;
        }
        const prices = r.Prices ?? r.prices ?? [];
        const pct = r.Pct ?? r.pct ?? null;
        const params = r.MarketParameters ?? r.marketParameters;
        const line = params?.line != null ? Number(params.line) : null;
        const periodo = r.MarketPeriod ?? r.marketPeriod;
        preparados.push({
          message_id: oddsMessageKey(r),
          fixture_id: fixtureId,
          ts: Number(r.Ts ?? r.ts) || 0,
          market_type: String(r.SuperOddsType ?? r.superOddsType ?? '?'),
          market_period: periodo == null ? null : String(periodo),
          line: Number.isFinite(line as number) ? line : null,
          in_running: r.InRunning ?? r.inRunning ?? null,
          bookmaker: r.Bookmaker ?? r.bookmaker ?? null,
          price_names: names,
          // Empty prices remain empty; batching must not change that semantics.
          prices: Array.isArray(prices) ? prices : [],
          pct,
          raw: r,
        });
      }

      const TAM_LOTE = 500;
      await db.withTx(async (tx) => {
        for (let inicio = 0; inicio < preparados.length; inicio += TAM_LOTE) {
          const lote = preparados.slice(inicio, inicio + TAM_LOTE);
          const res = await tx.query(
            `
            insert into match_odds
              (message_id, fixture_id, ts, market_type, market_period, line,
               in_running, bookmaker, price_names, prices, pct, raw)
            select message_id, fixture_id, ts, market_type, market_period, line,
                   in_running, bookmaker, price_names, prices, pct, raw
              from jsonb_to_recordset($1::jsonb) as x(
                message_id text, fixture_id bigint, ts bigint, market_type text,
                market_period text, line double precision, in_running boolean,
                bookmaker text, price_names jsonb, prices jsonb, pct jsonb, raw jsonb
              )
            on conflict (message_id) do nothing
            returning message_id
            `,
            [JSON.stringify(lote)]
          );
          stats.gravados += res.length;
        }
      });
      stats.repetidos = preparados.length - stats.gravados;

      return stats;
    },

    async listRaw(fixtureId: number): Promise<unknown[]> {
      const rows = await db.query(
        `select raw from match_odds where fixture_id = $1 order by ts, message_id`,
        [fixtureId]
      );
      return rows.map((r) => r.raw);
    },

    /**
     * Compact room projection containing only explainer and 1X2 fields.
     */
    async listReplayByFixture(fixtureId: number): Promise<OddsEvent[]> {
      const rows = await db.query(
        `select message_id, fixture_id, ts, market_type, market_period, line,
                in_running, bookmaker, price_names, prices, pct
           from match_odds
          where fixture_id = $1
            and market_type = $2
            and market_period is null
          order by ts, message_id`,
        [fixtureId, MERCADO_1X2]
      );
      const events: OddsEvent[] = [];
      for (const row of rows) {
        const ev = mapReplayOdds(row);
        if (ev) events.push(ev);
      }
      return events;
    },

    async count(fixtureId: number): Promise<number> {
      const rows = await db.query(`select count(*)::int as n from match_odds where fixture_id = $1`, [
        fixtureId,
      ]);
      return Number(rows[0]?.n ?? 0);
    },

    /**
     * Rows with misaligned PriceNames and Prices, used to verify consumers do
     * not interpret absent prices as zeros.
     */
    async listaDesalinhadas(fixtureId: number): Promise<{ messageId: string; nomes: number; precos: number }[]> {
      const rows = await db.query(
        `select message_id,
                jsonb_array_length(price_names) as nomes,
                jsonb_array_length(prices) as precos
           from match_odds
          where fixture_id = $1
            and jsonb_array_length(price_names) <> jsonb_array_length(prices)
          order by ts`,
        [fixtureId]
      );
      return rows.map((r) => ({
        messageId: String(r.message_id),
        nomes: Number(r.nomes),
        precos: Number(r.precos),
      }));
    },
  };

  return repo;
}

export type OddsRepo = ReturnType<typeof createOddsRepo>;
