// oddsRepo — a série de cotações (/odds/updates).
//
// DOIS FATOS QUE CUSTARAM CARO NO v0, GRAVADOS AQUI:
//
// 1. `message_id` é STRING ("1837922149:00003:000572-10021-stab"). Um parser
//    numérico devolve -1 para todas as linhas e o Map de dedupe COLAPSA a série
//    inteira num único registro. Sem erro. A coluna é TEXT e a chave também.
//
// 2. Numa partida real vêm 34.971 eventos de odds (~12 MB); só 3.758 são 1X2 de
//    jogo inteiro — o ÚNICO mercado que a v1 consome. O resto é over/under e
//    handicap asiático. O filtro é aqui, na ingestão, e ele CONTA o que
//    descartou: filtro que descarta em silêncio é como o bug fica escondido.

import type { Db } from '../pool.js';

/** O mercado que a v1 consome. */
export const MERCADO_1X2 = '1X2_PARTICIPANT_RESULT';

export type OddsUpsertStats = {
  gravados: number;
  repetidos: number;
  /** Descartados pelo filtro de mercado (over/under, handicap, período). */
  foraDoMercado: number;
  /** Descartados por não dar para identificar (sem FixtureId/PriceNames). */
  ilegiveis: number;
};

/**
 * É 1X2 de JOGO INTEIRO? Mesmo critério provado no v0:
 * SuperOddsType === '1X2_PARTICIPANT_RESULT' e MarketPeriod ausente.
 *
 * `== null` é deliberado (pega null e undefined, não pega 0): "período ausente"
 * significa jogo inteiro. Trocar por `=== null` ou por falsy muda o conjunto e
 * ninguém percebe até a série vir errada.
 */
export function eh1x2JogoInteiro(raw: unknown): boolean {
  if (raw == null || typeof raw !== 'object') return false;
  const r = raw as Record<string, any>;
  const tipo = String(r.SuperOddsType ?? r.superOddsType ?? '');
  const periodo = r.MarketPeriod ?? r.marketPeriod;
  return tipo === MERCADO_1X2 && periodo == null;
}

/**
 * A chave da linha. Usa o MessageId como STRING; quando o feed não manda,
 * cai no mesmo par (Ts + Prices) que o v0 usava para deduplicar.
 */
export function chaveDaCotacao(raw: Record<string, any>): string {
  const id = raw.MessageId ?? raw.messageId;
  if (id != null && String(id).length > 0) return String(id);
  const ts = raw.Ts ?? raw.ts;
  const prices = raw.Prices ?? raw.prices;
  return `${ts}:${prices}`;
}

export function createOddsRepo(db: Db) {
  const repo = {
    /**
     * Grava payloads CRUS já filtrados ao mercado da v1.
     * Devolve o que entrou E o que ficou de fora — o número descartado é o
     * sinal de que o filtro está vivo (esperado: ~89% numa partida real).
     */
    async upsertManyRaw(rows: unknown[]): Promise<OddsUpsertStats> {
      const stats: OddsUpsertStats = { gravados: 0, repetidos: 0, foraDoMercado: 0, ilegiveis: 0 };

      const usados: Record<string, any>[] = [];
      for (const raw of rows) {
        if (raw == null || typeof raw !== 'object') {
          stats.ilegiveis++;
          continue;
        }
        if (!eh1x2JogoInteiro(raw)) {
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
          message_id: chaveDaCotacao(r),
          fixture_id: fixtureId,
          ts: Number(r.Ts ?? r.ts) || 0,
          market_type: String(r.SuperOddsType ?? r.superOddsType ?? '?'),
          market_period: periodo == null ? null : String(periodo),
          line: Number.isFinite(line as number) ? line : null,
          in_running: r.InRunning ?? r.inRunning ?? null,
          bookmaker: r.Bookmaker ?? r.bookmaker ?? null,
          price_names: names,
          // Prices vazio continua vazio; lote não muda a semântica G8.
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

    async count(fixtureId: number): Promise<number> {
      const rows = await db.query(`select count(*)::int as n from match_odds where fixture_id = $1`, [
        fixtureId,
      ]);
      return Number(rows[0]?.n ?? 0);
    },

    /**
     * Linhas em que PriceNames e Prices têm tamanhos diferentes.
     * Não é sujeira: é dado real (mercado sem cotação no momento). Serve para
     * conferir que o consumidor está tratando o caso — e não inventando zeros.
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
