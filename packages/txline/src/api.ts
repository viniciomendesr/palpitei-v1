// TxLINE data endpoint client. Authentication is handled by txlineGet(); this
// module owns endpoint shapes and feed-specific normalization assumptions.

import type { Fixture } from "@palpitei/core";
import { txlineGet } from "./auth.ts";
import { config } from "./config.ts";
import { TxlineSweepError } from "./errors.ts";
import { info, warn } from "./log.ts";

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Accepts direct arrays and { updates } or { rows } wrappers. */
function rows(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  const d = data as { updates?: unknown; rows?: unknown } | null;
  if (Array.isArray(d?.updates)) return d.updates;
  if (Array.isArray(d?.rows)) return d.rows;
  return [];
}

function looksWorldCup(fx: unknown): boolean {
  return JSON.stringify(fx).toLowerCase().includes("world cup") ||
    JSON.stringify(fx).toLowerCase().includes("worldcup");
}

function toFixture(fx: any): Fixture | null {
  const fixtureId = num(fx?.FixtureId ?? fx?.fixtureId);
  if (fixtureId === undefined) return null;
  return {
    fixtureId,
    p1: String(fx.Participant1 ?? fx.participant1 ?? "?"),
    p2: String(fx.Participant2 ?? fx.participant2 ?? "?"),
    p1Id: num(fx.Participant1Id ?? fx.participant1Id),
    p2Id: num(fx.Participant2Id ?? fx.participant2Id),
    competition: fx.Competition ?? fx.competition,
    competitionId: num(fx.CompetitionId ?? fx.competitionId),
    startTime: num(fx.StartTime ?? fx.startTime),
    gameState: num(fx.GameState ?? fx.gameState),
    raw: fx,
  };
}

/** Fixture snapshot with an all-fixtures fallback filtered by name. */
export async function fetchFixtures(): Promise<Fixture[]> {
  const path = config.competitionId
    ? `/fixtures/snapshot?competitionId=${config.competitionId}`
    : `/fixtures/snapshot`;
  info(`GET ${config.apiBaseUrl}${path}`);

  const data = await txlineGet<any>(path);
  let list: any[] = Array.isArray(data) ? data : data?.fixtures ?? [];

  if (config.competitionId && list.length === 0) {
    warn(`competitionId=${config.competitionId} retornou 0 — buscando tudo e filtrando por "World Cup"…`);
    const todos = await txlineGet<any>(`/fixtures/snapshot`);
    const all: any[] = Array.isArray(todos) ? todos : todos?.fixtures ?? [];
    list = all.filter(looksWorldCup);
  } else if (!config.competitionId) {
    // An empty competition ID opts into the documented all-fixtures fallback.
    list = list.filter(looksWorldCup);
  }

  return list
    .map(toFixture)
    .filter((f): f is Fixture => f !== null)
    .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
}

/**
 * Score snapshot for current state only; replay must use /scores/updates.
 * asOf is an I/O parameter, not engine time.
 */
export async function fetchScoresSnapshot(fixtureId: number, asOf?: number): Promise<any[]> {
  const data = await txlineGet(`/scores/snapshot/${fixtureId}`, { asOf: asOf ?? Date.now() });
  return rows(data);
}

/**
 * Resolves participant names from lineups when a fixture has left the snapshot.
 */
export async function fetchFixtureNames(
  fixtureId: number
): Promise<{ p1: string; p2: string; p1Id?: number; p2Id?: number; startTime?: number } | null> {
  let linhas: any[];
  try {
    linhas = await fetchScoresSnapshot(fixtureId);
  } catch {
    return null;
  }
  const linha = linhas.find((l) => Array.isArray(l?.Lineups) && l.Lineups.length);
  if (!linha) return null;

  const p1Id = num(linha.Participant1Id);
  const p2Id = num(linha.Participant2Id);
  const nome = (id?: number): string | undefined =>
    linha.Lineups.find((e: any) => num(e?.normativeId) === id)?.preferredName;

  const p1 = nome(p1Id);
  const p2 = nome(p2Id);
  if (!p1 || !p2) return null;

  // startTime anchors final-result question windows.
  const startTime = num(linhas.find((l) => l?.StartTime)?.StartTime);
  return { p1: String(p1), p2: String(p2), p1Id, p2Id, startTime };
}

/**
 * Odds snapshot returns one current row; explanations use fetchOddsUpdates().
 */
export async function fetchOddsSnapshot(fixtureId: number, asOf?: number): Promise<any[]> {
  const data = await txlineGet(`/odds/snapshot/${fixtureId}`, { asOf: asOf ?? Date.now() });
  return rows(data);
}

/**
 * Complete sequence for a finished match. Errors are propagated to callers.
 */
export async function fetchHistorical(fixtureId: number): Promise<any[]> {
  const data = await txlineGet(`/scores/historical/${fixtureId}`);
  return rows(data);
}

// /updates is the complete timeline. interval is a five-minute bucket (0..11).
const INTERVALOS_POR_HORA = 12;

export type TimeBucket = { day: number; hour: number };

/** UTC hour buckets covering a match window. */
export function createTimeBuckets(
  startTime: number,
  horasAntes = config.sweepHoursBefore,
  horasDepois = config.sweepHoursAfter
): TimeBucket[] {
  const out: TimeBucket[] = [];
  const inicio = startTime - horasAntes * 3600_000;
  const fim = startTime + horasDepois * 3600_000;
  for (let t = inicio; t <= fim; t += 3600_000) {
    const d = new Date(t);
    out.push({ day: Math.floor(t / 86400_000), hour: d.getUTCHours() });
  }
  return out;
}

/** Runs fn over items with at most limit concurrent requests. */
async function pool<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let i = 0;
  const trabalhador = async (): Promise<void> => {
    while (true) {
      const meu = i++;
      if (meu >= itens.length) return;
      out[meu] = await fn(itens[meu]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return out;
}

export type SweepStats = {
  requests: number;
  ok: number;
  rows: number;
  matchingFixture: number;
  byStatus: Record<string, number>;
};

async function varreUpdates(
  feed: "scores" | "odds",
  fixtureId: number,
  startTime: number
): Promise<{ achados: any[]; stats: SweepStats }> {
  const alvos: { dia: number; hora: number; iv: number }[] = [];
  for (const { day, hour } of createTimeBuckets(startTime)) {
    for (let iv = 0; iv < INTERVALOS_POR_HORA; iv++) alvos.push({ dia: day, hora: hour, iv });
  }

  const stats: SweepStats = { requests: alvos.length, ok: 0, rows: 0, matchingFixture: 0, byStatus: {} };
  const achados: any[] = [];

  await pool(alvos, config.sweepConcurrency, async ({ dia, hora, iv }) => {
    try {
      const data = await txlineGet(`/${feed}/updates/${dia}/${hora}/${iv}`);
      stats.ok += 1;
      const linhas = rows(data);
      stats.rows += linhas.length;
      for (const r of linhas) {
        if (num(r?.FixtureId) === fixtureId) {
          achados.push(r);
          stats.matchingFixture += 1;
        }
      }
    } catch (e: any) {
      // A 404 bucket is normal; authentication and transport failures are not.
      const chave = e?.status ? `HTTP ${e.status}` : "rede";
      stats.byStatus[chave] = (stats.byStatus[chave] ?? 0) + 1;
      if (e?.status === 404) stats.ok += 1; // Empty bucket is a semantic success.
    }
  });

  const naoFoi404 = { ...stats.byStatus };
  delete naoFoi404["HTTP 404"];
  const errosReais = Object.values(naoFoi404).reduce((a, b) => a + b, 0);

  // No successful requests plus a real error is a failure, not an empty match.
  if (stats.ok === 0 && errosReais > 0) {
    throw new TxlineSweepError(feed, fixtureId, stats.requests, stats.byStatus);
  }
  if (errosReais > 0) {
    warn(
      `[updates] ${feed} da fixture ${fixtureId}: ${errosReais} de ${stats.requests} baldes falharam ` +
        `(${Object.entries(naoFoi404).map(([s, n]) => `${s}×${n}`).join(", ")}) — o resultado pode estar INCOMPLETO`
    );
  }
  return { achados, stats };
}

/** Gaps in the sequence identify events that did not arrive. */
export function findSequenceGaps(rows: any[]): { from: number; to: number }[] {
  const seqs = rows
    .map((r) => num(r?.Seq ?? r?.seq))
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b);
  const out: { from: number; to: number }[] = [];
  for (let i = 1; i < seqs.length; i++) {
    const previous = seqs[i - 1]!;
    const current = seqs[i]!;
    if (current > previous + 1) out.push({ from: previous, to: current });
  }
  return out;
}

/**
 * All score events from /scores/updates, ordered by the feed sequence.
 */
export async function fetchScoresUpdates(fixtureId: number, startTime: number): Promise<any[]> {
  const { achados } = await varreUpdates("scores", fixtureId, startTime);

  const semSeq = achados.filter((r) => num(r?.Seq) === undefined).length;
  if (semSeq) warn(`[updates] ${semSeq} linhas de score sem Seq — descartadas da deduplicação`);

  const porSeq = new Map<number, any>();
  for (const r of achados) {
    const seq = num(r.Seq);
    if (seq !== undefined) porSeq.set(seq, r);
  }
  const lista = [...porSeq.values()].sort((a, b) => (num(a.Seq) ?? 0) - (num(b.Seq) ?? 0));

  const gaps = findSequenceGaps(lista);
  if (gaps.length) {
    // Feed sequence gaps represent missing events, not idle match time.
    warn(
      `[updates] fixture ${fixtureId}: ${gaps.length} sequence gap(s) — ` +
        `${gaps.slice(0, 5).map((gap) => `${gap.from}→${gap.to}`).join(", ")}${gaps.length > 5 ? "…" : ""}. ` +
        `Cada buraco é um evento que existiu e não chegou (gol? cartão?).`
    );
  }
  info(
    `[updates] scores da fixture ${fixtureId}: ${lista.length} eventos únicos` +
      (lista.length ? ` (seq ${num(lista[0].Seq)} → ${num(lista[lista.length - 1].Seq)})` : "")
  );
  return lista;
}

/**
 * Match odds from /odds/updates, filtered to the full-game 1X2 market.
 */
export async function fetchOddsUpdates(fixtureId: number, startTime: number): Promise<any[]> {
  const { achados } = await varreUpdates("odds", fixtureId, startTime);
  const usados = achados.filter(
    (r) => String(r?.SuperOddsType ?? "") === "1X2_PARTICIPANT_RESULT" && r?.MarketPeriod == null
  );

  // MessageId is an opaque string and must remain the deduplication key.
  const porId = new Map<string, any>();
  for (const r of usados) {
    porId.set(String(r.MessageId ?? `${r.Ts}:${JSON.stringify(r.Prices)}`), r);
  }
  const lista = [...porId.values()].sort((a, b) => (num(a.Ts) ?? 0) - (num(b.Ts) ?? 0));
  info(`[updates] odds 1X2 da fixture ${fixtureId}: ${lista.length} de ${achados.length} brutas`);
  return lista;
}

/**
 * Merkle proof for a statistic. It requires a real observed game_finalised
 * fixtureId and sequence number.
 */
export async function fetchStatValidation(
  fixtureId: number,
  seq: number,
  statKey: number | string
): Promise<unknown> {
  return txlineGet(`/scores/stat-validation`, { fixtureId, seq, statKey });
}
