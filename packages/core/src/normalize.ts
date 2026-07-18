import type { OddsEvent, ScoreEvent } from "./types.ts";

// TxLINE payload to normalized event (see ./types.ts). Field casing is tolerant
// because the feed is not contractually consistent.

function num(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Preserve opaque message IDs. Real TxLINE IDs are structured strings, so numeric
 * coercion would corrupt the deduplication key. Synthetic numeric IDs become strings.
 */
function id(v: any): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "object") return undefined;
  const s = String(v);
  return s.length > 0 ? s : undefined;
}

function totals(score: any, participant: "Participant1" | "Participant2") {
  const p = score?.[participant] ?? score?.[participant.toLowerCase()];
  const total = p?.Total ?? p?.total ?? {};
  return {
    // Within Total, a missing metric is zero; this differs from a missing Score
    // block, represented by hasScore=false.
    goals: num(total.Goals ?? total.goals) ?? 0,
    corners: num(total.Corners ?? total.corners) ?? 0,
    // Preserve all numeric totals because available metrics vary by fixture.
    todas: numericos(total),
  };
}

/** Extracts numeric fields only, ignoring nested or invalid values. */
function numericos(bloco: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(bloco ?? {})) {
    const n = num(v);
    if (n !== undefined) out[k] = n;
  }
  return out;
}

export function normalizeScore(raw: any): ScoreEvent | null {
  if (raw == null || typeof raw !== "object") return null;
  const fixtureId = num(raw.FixtureId ?? raw.fixtureId);
  if (fixtureId === undefined) return null;

  const score = raw.Score ?? raw.score;
  const p1 = totals(score, "Participant1");
  const p2 = totals(score, "Participant2");
  const clock = raw.Clock ?? raw.clock;

  return {
    kind: "score",
    fixtureId,
    seq: num(raw.Seq ?? raw.seq) ?? 0,
    ts: num(raw.Ts ?? raw.ts) ?? 0,
    action: String(raw.Action ?? raw.action ?? "").toLowerCase(),
    statusId: num(raw.StatusId ?? raw.statusId),
    period: num(raw.Period ?? raw.period),
    gameStateRaw: raw.GameState ?? raw.gameState,
    clockRunning: clock ? Boolean(clock.Running ?? clock.running) : undefined,
    clockSeconds: clock ? num(clock.Seconds ?? clock.seconds) : undefined,
    // A missing Score block is not a 0-0 score. Its values are placeholders and
    // must not be used to derive score deltas.
    hasScore: score != null,
    goals: { p1: p1.goals, p2: p2.goals },
    corners: { p1: p1.corners, p2: p2.corners },
    totals: { p1: p1.todas, p2: p2.todas },
    data: raw.Data ?? raw.data,
    raw,
  };
}

export function normalizeOdds(raw: any): OddsEvent | null {
  if (raw == null || typeof raw !== "object") return null;
  const fixtureId = num(raw.FixtureId ?? raw.fixtureId);
  if (fixtureId === undefined) return null;

  const names = raw.PriceNames ?? raw.priceNames;
  const priceInts = raw.Prices ?? raw.prices;
  if (!Array.isArray(names) || !Array.isArray(priceInts)) return null;
  // Empty prices indicate an unavailable market, not zero-valued prices.
  if (priceInts.length === 0) return null;
  const pcts = raw.Pct ?? raw.pct;
  // Parallel arrays must align; missing values are absent, never zero.
  if (priceInts.length !== names.length) return null;
  if (Array.isArray(pcts) && pcts.length !== names.length) return null;

  const prices: { name: string; odds: number; pct: number }[] = [];
  names.forEach((name: any, i: number) => {
    // Skip invalid prices while retaining valid entries from the same event.
    const raw1000 = num(priceInts[i]);
    if (raw1000 === undefined || raw1000 <= 0) return;
    const odds = raw1000 / 1000; // Prices are scaled by 1000: 2076 => 2.076
    let pct = Number.parseFloat(String(Array.isArray(pcts) ? pcts[i] : ""));
    if (!Number.isFinite(pct)) {
      // Derive implied probability when Pct is absent.
      pct = Number(((1 / odds) * 100).toFixed(3));
    }
    prices.push({ name: String(name), odds, pct });
  });
  // No valid prices means this market cannot be represented.
  if (prices.length === 0) return null;

  const params = raw.MarketParameters ?? raw.marketParameters;
  const lineNum = params?.line != null ? num(params.line) : undefined;

  return {
    kind: "odds",
    fixtureId,
    ts: num(raw.Ts ?? raw.ts) ?? 0,
    messageId: id(raw.MessageId ?? raw.messageId),
    marketType: String(raw.SuperOddsType ?? raw.superOddsType ?? "?"),
    marketPeriod: raw.MarketPeriod ?? raw.marketPeriod,
    line: lineNum,
    inRunning: raw.InRunning ?? raw.inRunning,
    bookmaker: raw.Bookmaker ?? raw.bookmaker,
    prices,
    raw,
  };
}
