/** Projects usable pregame markets from the TxLINE snapshot without exposing raw licensed payloads. Invalid feed data means unavailable, never zero. */

import { TxlineHttpError, fetchOddsSnapshot, warn } from '@palpitei/txline';

export type ResultProbabilities = { home: number; draw: number; away: number };
export type OverUnderProbabilities = { line: number; over: number; under: number };

/** Includes only fully quoted markets that Palpitei can settle. */
export type PregameMarket =
  | {
      id: 'result';
      kind: 'result';
      options: { id: 'home' | 'draw' | 'away'; pct: number }[];
    }
  | {
      id: 'goals' | 'corners';
      kind: 'over_under';
      line: number;
      options: { id: 'over' | 'under'; pct: number }[];
    };

export interface PregameOddsRead {
  markets: PregameMarket[];
  /** False means TxLINE did not respond; an empty list never represents zero values. */
  txlineAvailable: boolean;
}

/** Safe counters for diagnosing quote availability without exposing payloads or secrets. */
export interface PregameOddsStatus {
  txlineQueries: number;
  cacheHits: number;
  unavailableResponses: number;
  lastUnavailableReason: string | null;
  lastUnavailableAt: number | null;
}

export const NO_PREGAME_MARKETS: PregameMarket[] = [];

const RESULT_MARKET = '1X2_PARTICIPANT_RESULT';
const GOALS_MARKET = 'OVERUNDER_PARTICIPANT_GOALS';
const CORNERS_MARKET = 'OVERUNDER_PARTICIPANT_CORNERS';
const TTL_MS = Math.max(1_000, Number(process.env.TXLINE_PREGAME_ODDS_CACHE_MS ?? 15_000) || 15_000);

type Cache = Map<number, { value: PregameOddsRead; expiresAt: number; inFlight: Promise<PregameOddsRead> | null }>;
const CACHE_KEY = '__palpitei_pregame_odds_cache__' as const;
const STATUS_KEY = '__palpitei_pregame_odds_status__' as const;
type GlobalWithCache = typeof globalThis & { [CACHE_KEY]?: Cache };
type GlobalWithStatus = typeof globalThis & { [STATUS_KEY]?: PregameOddsStatus };

function cache(): Cache {
  const global = globalThis as GlobalWithCache;
  return (global[CACHE_KEY] ??= new Map());
}

function internalStatus(): PregameOddsStatus {
  const global = globalThis as GlobalWithStatus;
  return (global[STATUS_KEY] ??= {
    txlineQueries: 0,
    cacheHits: 0,
    unavailableResponses: 0,
    lastUnavailableReason: null,
    lastUnavailableAt: null,
  });
}

/** Observable pregame snapshot status without raw TxLINE responses. */
export function getPregameOddsStatus(): Readonly<PregameOddsStatus> {
  return { ...internalStatus() };
}

/** Isolates cache and telemetry tests; production code never calls this. */
export function resetPregameOddsForTest(): void {
  cache().clear();
  const status = internalStatus();
  status.txlineQueries = 0;
  status.cacheHits = 0;
  status.unavailableResponses = 0;
  status.lastUnavailableReason = null;
  status.lastUnavailableAt = null;
}

function safeUnavailableReason(error: unknown): string {
  if (error instanceof TxlineHttpError) return `HTTP ${error.status}`;
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error && error.name === 'AbortError') return 'timeout';
  return 'rede/cliente';
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** TxLINE `MarketParameters` is currently a string such as `line=2.5`, not an object. */
export function extractMarketLine(params: unknown): number | null {
  let rawLine: unknown = null;
  if (typeof params === 'string') {
    const match = /(?:^|[,&;\s])line\s*=\s*(-?(?:\d+(?:\.\d+)?|\.\d+))(?=$|[,&;\s])/i.exec(params);
    rawLine = match?.[1] ?? null;
  } else if (params && typeof params === 'object') {
    rawLine = (params as { line?: unknown }).line ?? null;
  }
  const line = finiteNumber(rawLine);
  // Only half-goal lines avoid push and half-win settlement rules.
  if (line === null || line < 0 || line > 20 || Number.isInteger(line)) return null;
  return Math.abs(line * 2 - Math.round(line * 2)) < 1e-9 ? line : null;
}

type PricesByName = Map<string, number>;

/** Builds probabilities only when all parallel feed arrays are complete and consistent. */
function validPrices(raw: Record<string, unknown>): PricesByName | null {
  const names = raw.PriceNames ?? raw.priceNames;
  const prices = raw.Prices ?? raw.prices;
  const pcts = raw.Pct ?? raw.pct;
  if (!Array.isArray(names) || !Array.isArray(prices) || !Array.isArray(pcts)) return null;
  if (names.length === 0 || names.length !== prices.length || names.length !== pcts.length) return null;

  const out = new Map<string, number>();
  for (let i = 0; i < names.length; i++) {
    const name = normalizedText(names[i]);
    const price = finiteNumber(prices[i]);
    const pct = finiteNumber(pcts[i]);
    if (!name || price === null || price <= 0 || pct === null || pct <= 0 || pct > 100 || out.has(name)) return null;
    out.set(name, pct);
  }
  return out;
}

function resultProbabilities(raw: Record<string, unknown>): ResultProbabilities | null {
  if (String(raw.SuperOddsType ?? raw.superOddsType ?? '') !== RESULT_MARKET) return null;
  if ((raw.MarketPeriod ?? raw.marketPeriod) != null) return null;
  const p = validPrices(raw);
  if (!p) return null;
  const home = p.get('part1') ?? p.get('participant1') ?? p.get('home');
  const draw = p.get('draw');
  const away = p.get('part2') ?? p.get('participant2') ?? p.get('away');
  return home == null || draw == null || away == null ? null : { home, draw, away };
}

function overUnderProbabilities(raw: Record<string, unknown>, marketType: string): OverUnderProbabilities | null {
  if (String(raw.SuperOddsType ?? raw.superOddsType ?? '') !== marketType) return null;
  if ((raw.MarketPeriod ?? raw.marketPeriod) != null) return null;
  const line = extractMarketLine(raw.MarketParameters ?? raw.marketParameters);
  const p = validPrices(raw);
  if (line === null || !p) return null;
  const over = p.get('over');
  const under = p.get('under');
  return over == null || under == null ? null : { line, over, under };
}

/** Selects the most balanced TxLINE line for the fairest question. */
function mostBalanced(candidates: OverUnderProbabilities[]): OverUnderProbabilities | null {
  return candidates.reduce<OverUnderProbabilities | null>((best, current) => {
    if (!best) return current;
    const currentImbalance = Math.abs(current.over - current.under);
    const bestImbalance = Math.abs(best.over - best.under);
    if (currentImbalance < bestImbalance) return current;
    // Resolve exact ties deterministically without a product preference.
    return currentImbalance === bestImbalance && current.line < best.line ? current : best;
  }, null);
}

/** Pure projection exported for network-free tests. */
export function extractPregameMarkets(rows: unknown[]): PregameMarket[] {
  let result: ResultProbabilities | null = null;
  const goals: OverUnderProbabilities[] = [];
  const corners: OverUnderProbabilities[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const raw = row as Record<string, unknown>;
    result ??= resultProbabilities(raw);
    const goal = overUnderProbabilities(raw, GOALS_MARKET);
    if (goal) goals.push(goal);
    const corner = overUnderProbabilities(raw, CORNERS_MARKET);
    if (corner) corners.push(corner);
  }

  const markets: PregameMarket[] = [];
  if (result) {
    markets.push({
      id: 'result',
      kind: 'result',
      options: [
        { id: 'home', pct: result.home },
        { id: 'draw', pct: result.draw },
        { id: 'away', pct: result.away },
      ],
    });
  }
  const goalsMarket = mostBalanced(goals);
  if (goalsMarket) {
    markets.push({
      id: 'goals',
      kind: 'over_under',
      line: goalsMarket.line,
      options: [
        { id: 'over', pct: goalsMarket.over },
        { id: 'under', pct: goalsMarket.under },
      ],
    });
  }
  const cornersMarket = mostBalanced(corners);
  if (cornersMarket) {
    markets.push({
      id: 'corners',
      kind: 'over_under',
      line: cornersMarket.line,
      options: [
        { id: 'over', pct: cornersMarket.over },
        { id: 'under', pct: cornersMarket.under },
      ],
    });
  }
  return markets;
}

/** Fetches a short-lived fixture snapshot without presenting stale data as current. */
type FetchOddsSnapshot = (fixtureId: number) => Promise<unknown[]>;

export async function fetchPregameOdds(
  fixtureId: number,
  fetchSnapshot: FetchOddsSnapshot = fetchOddsSnapshot,
): Promise<PregameOddsRead> {
  const c = cache();
  const status = internalStatus();
  const now = Date.now();
  const previous = c.get(fixtureId);
  if (previous && now < previous.expiresAt) {
    status.cacheHits += 1;
    return previous.value;
  }
  if (previous?.inFlight) {
    status.cacheHits += 1;
    return previous.inFlight;
  }

  const entry = previous ?? { value: { markets: NO_PREGAME_MARKETS, txlineAvailable: false }, expiresAt: 0, inFlight: null };
  status.txlineQueries += 1;
  const inFlight = fetchSnapshot(fixtureId)
    .then((rows) => ({ markets: extractPregameMarkets(rows), txlineAvailable: true }))
    .catch((error: unknown) => {
      const reason = safeUnavailableReason(error);
      status.unavailableResponses += 1;
      status.lastUnavailableReason = reason;
      status.lastUnavailableAt = Date.now();
      // Never log HTTP bodies, signed URLs, JWTs, or TxLINE payloads.
      warn(
        `[pregame-odds] snapshot unavailable for fixture ${fixtureId} (${reason}); ` +
          'mercados dinâmicos não serão exibidos',
      );
      return { markets: NO_PREGAME_MARKETS, txlineAvailable: false };
    })
    .then((value) => {
      entry.value = value;
      entry.expiresAt = Date.now() + TTL_MS;
      entry.inFlight = null;
      return value;
    });
  entry.inFlight = inFlight;
  c.set(fixtureId, entry);
  return inFlight;
}

/** Checks a client-submitted line against the currently quoted TxLINE market. */
export function marketById<T extends PregameMarket['id']>(markets: PregameMarket[], id: T): Extract<PregameMarket, { id: T }> | null {
  return (markets.find((market) => market.id === id) as Extract<PregameMarket, { id: T }> | undefined) ?? null;
}

export function matchesMarketLine(received: number | null, quoted: Extract<PregameMarket, { kind: 'over_under' }> | null): boolean {
  return received !== null && quoted !== null && Math.abs(received - quoted.line) < 1e-9;
}
