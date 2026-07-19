// Replay reconstructs a match timeline and emits it at accelerated speed.

import type { Fixture, NormEvent } from "@palpitei/core";
import { normalizeOdds, normalizeScore } from "@palpitei/core";
import {
  fetchFixtureNames,
  fetchHistorical,
  fetchOddsSnapshot,
  fetchOddsUpdates,
  fetchScoresSnapshot,
  fetchScoresUpdates,
} from "../api.ts";
import { hasUsableMatchCache, type MatchCacheStore } from "../cache.ts";
import { errorMessage } from "../errors.ts";
import { generateDemoEvents, isSyntheticAllowed } from "./demo.ts";
import { info, warn } from "../log.ts";

/**
 * Timeline origin. Consumers display this value, so it must remain accurate.
 */
export type ReplaySource =
  | "txline-cache" // Persisted real TxLINE /updates data.
  | "txline-updates" // Current /updates scan.
  | "txline-historical" // /scores/historical
  | "txline-snapshot" // Sparse snapshot fallback.
  | "synthetic"; // Local development-only generator.

export type ReplayLoad = {
  events: NormEvent[];
  source: ReplaySource;
  /** True when events originated in real TxLINE payloads. */
  fromTxline: boolean;
};

export type LoadReplayOpts = {
  /** Development-only. See ingest/demo.ts. */
  allowSynthetic?: boolean;
  /** Match cache from @palpitei/db. Without it, the chain starts at the API. */
  cache?: MatchCacheStore;
  /** Persists /updates scan results in cache. Defaults to true. */
  persist?: boolean;
  /** Injects synthetic-generator time for tests. */
  now?: number;
};

/**
 * Normalizes and merges scores and odds into one timeline. Ties sort scores
 * before odds and scores by sequence.
 */
function mesclar(scoreRaw: unknown[], oddsRaw: unknown[]): NormEvent[] {
  const events: NormEvent[] = [];
  for (const r of scoreRaw ?? []) {
    const ev = normalizeScore(r);
    if (ev) events.push(ev);
  }
  for (const r of oddsRaw ?? []) {
    const ev = normalizeOdds(r);
    if (ev) events.push(ev);
  }
  events.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.kind !== b.kind) return a.kind === "score" ? -1 : 1;
    if (a.kind === "score" && b.kind === "score") return a.seq - b.seq;
    return 0;
  });
  return events;
}

/** Whether the list represents a real match (kickoff, finalization, minimum volume). */
export function hasRealMatchContent(events: NormEvent[]): boolean {
  const scores = events.filter((e) => e.kind === "score");
  if (scores.length < 5) return false;
  const hasKickoff = scores.some((e) => e.action === "kickoff");
  const hasFinaliser = scores.some(
    (e) => e.action === "game_finalised" || e.action === "halftime_finalised"
  );
  return hasKickoff && hasFinaliser;
}

/** Fixture start time, falling back to the data when the fixture is unavailable. */
async function descobreStartTime(fixture: Fixture): Promise<number | undefined> {
  if (fixture.startTime) return fixture.startTime;
  try {
    const nomes = await fetchFixtureNames(fixture.fixtureId);
    if (nomes?.startTime) return nomes.startTime;
  } catch {
    /* continue without the fixture */
  }
  return undefined;
}

/**
 * Loads a timeline through this fallback order: cache, /updates, /historical,
 * /snapshot, then opt-in development-only synthetic data.
 */
export async function loadReplayEvents(fixture: Fixture, opts: LoadReplayOpts = {}): Promise<ReplayLoad> {
  const fixtureId = fixture.fixtureId;
  const persist = opts.persist !== false;

  if (opts.cache) {
    try {
      const c = await opts.cache.get(fixtureId);
      if (hasUsableMatchCache(c)) {
        const events = mesclar(c.scores, c.odds);
        if (events.length) {
          info(
            `[replay] fixture ${fixtureId}: ${events.length} eventos do cache ` +
              `(${c.scores.length} scores, ${c.odds.length} odds)`
          );
          return { events, source: "txline-cache", fromTxline: true };
        }
        warn(`[replay] cache de ${fixtureId} não normalizou nenhum evento — seguindo para a API`);
      }
    } catch (e) {
      warn(`[replay] cache de ${fixtureId} indisponível (${errorMessage(e)}) — seguindo para a API`);
    }
  }

  const startTime = await descobreStartTime(fixture);
  if (startTime) {
    try {
      // Scores are required for replay; odds remain optional.
      const [scores, odds] = await Promise.all([
        fetchScoresUpdates(fixtureId, startTime),
        fetchOddsUpdates(fixtureId, startTime).catch((e) => {
          warn(`[replay] odds/updates de ${fixtureId} falhou (${errorMessage(e)}) — replay só com scores`);
          return [];
        }),
      ]);
      if (scores.length) {
        const events = mesclar(scores, odds);
        if (hasRealMatchContent(events)) {
          info(`[replay] fixture ${fixtureId}: ${events.length} eventos de /updates`);
          if (persist && opts.cache) {
            // Cache persistence failure must not prevent a valid replay.
            try {
              const nomes = await fetchFixtureNames(fixtureId);
              await opts.cache.put({
                fixtureId,
                p1: nomes?.p1 ?? fixture.p1,
                p2: nomes?.p2 ?? fixture.p2,
                startTime,
                gravadoEm: Date.now(),
                fonte: "txline-updates",
                scores,
                odds,
              });
              info(`[replay] fixture ${fixtureId} gravada no cache — o próximo replay é instantâneo`);
            } catch (e) {
              warn(`[replay] não consegui gravar o cache de ${fixtureId} (${errorMessage(e)})`);
            }
          }
          return { events, source: "txline-updates", fromTxline: true };
        }
        warn(`[replay] /updates de ${fixtureId} sem partida completa — tentando historical`);
      } else {
        warn(`[replay] /updates de ${fixtureId} veio vazio — tentando historical`);
      }
    } catch (e) {
      warn(`[replay] /updates de ${fixtureId} falhou (${errorMessage(e)}) — tentando historical`);
    }
  } else {
    warn(`[replay] fixture ${fixtureId} sem startTime — pulando /updates (a varredura precisa da janela)`);
  }

  let source: ReplaySource = "txline-historical";
  let scoreRaw: any[] = [];
  try {
    scoreRaw = await fetchHistorical(fixtureId);
    if (scoreRaw.length === 0) {
      warn(`[replay] historical de ${fixtureId} veio vazio (A2) — caindo para o snapshot de scores`);
      scoreRaw = await fetchScoresSnapshot(fixtureId);
      source = "txline-snapshot";
    }
  } catch (e) {
    warn(`[replay] historical de ${fixtureId} falhou (${errorMessage(e)}) — caindo para o snapshot de scores`);
    scoreRaw = await fetchScoresSnapshot(fixtureId);
    source = "txline-snapshot";
  }

  let oddsRaw: any[] = [];
  try {
    oddsRaw = await fetchOddsSnapshot(fixtureId);
    if (oddsRaw.length <= 1) {
      // Snapshots are not odds series, so they cannot power explanations.
      warn(
        `[replay] odds de ${fixtureId}: ${oddsRaw.length} linha(s) do snapshot — ` +
          `é foto, não série (G2). O explicador vai ficar mudo neste replay.`
      );
    }
  } catch (e) {
    warn(`[replay] odds de ${fixtureId} indisponíveis (${errorMessage(e)}) — replay só com scores`);
  }

  const events = mesclar(scoreRaw, oddsRaw);

  if (!hasRealMatchContent(events)) {
    if (!isSyntheticAllowed(opts)) {
      throw new Error(
        `a devnet não tem dados de partida da TxLINE para a fixture ${fixtureId} — ` +
          `escolha outra (ex.: um replay recente via "Replay por ID") ou ative o modo ` +
          `sintético (só desenvolvimento; a regra do hackathon exige TxLINE como fonte)`
      );
    }
    warn(
      `[replay] fixture ${fixtureId} sem dados de partida na devnet — usando REPLAY SINTÉTICO ` +
        `determinístico (DEV; NÃO usar em demo/submissão — o badge da sala tem de dizer "synthetic")`
    );
    return { events: generateDemoEvents(fixture, opts.now), source: "synthetic", fromTxline: false };
  }

  info(
    `[replay] fixture ${fixtureId}: ${events.length} eventos carregados ` +
      `(${scoreRaw.length} scores, ${oddsRaw.length} odds; fonte: ${source})`
  );
  return { events, source, fromTxline: true };
}

// Wall-clock cap for gaps between events. Pre-game gaps are capped far more
// tightly so replay does not spend minutes on metadata before kick-off.
const GAP_TETO_ACELERADO_MS = 2_000;
const GAP_TETO_TEMPO_REAL_MS = 60_000;
const GAP_TETO_PRE_JOGO_MS = 150;

// Before the match clock runs, replay advances at high speed regardless of the
// requested speed to compress dense pre-game updates.
//
// Measured 18/07 on France x England (18257865): the live capture holds 1248
// pre-kick-off items because odds ticked for hours before the whistle, five
// times the recorded England x Argentina. At 600x with the shared 2s cap that
// was 143s of staring at a scoreboard before the ball moved. At 5000x with the
// dedicated cap it is 16s, and the match itself still plays at REPLAY_SPEED.
const VELOCIDADE_PRE_JOGO = 5_000;

/** Whether an event indicates match play; clockRunning avoids pre-game metadata. */
export function isMatchInProgress(ev: NormEvent): boolean {
  return ev.kind === "score" && ev.clockRunning === true;
}

export function maxReplayGapMs(speed: number, matchStarted: boolean): number {
  // Pre-game first: before the whistle every gap is metadata, whatever the speed.
  if (!matchStarted) return GAP_TETO_PRE_JOGO_MS;
  return speed > 1 ? GAP_TETO_ACELERADO_MS : GAP_TETO_TEMPO_REAL_MS;
}

/**
 * Deterministic wall-clock duration used by the room watchdog.
 */
export function replayDurationMs(events: NormEvent[], requestedSpeed: number): number {
  let total = 0;
  let jogoComecou = false;
  for (let i = 0; i < events.length - 1; i++) {
    const current = events[i]!;
    if (isMatchInProgress(current)) jogoComecou = true;
    const escolhida = Math.max(requestedSpeed, 0.001);
    const speed = jogoComecou ? escolhida : Math.max(escolhida, VELOCIDADE_PRE_JOGO);
    const gapMs = (events[i + 1]!.ts - current.ts) / speed;
    total += Math.min(Math.max(gapMs, 0), maxReplayGapMs(requestedSpeed, jogoComecou));
  }
  return total;
}

/**
 * Reagenda os eventos comprimindo a linha do tempo: delay real entre eventos =
 * (Δts do jogo) / speed, with a cap (see maxReplayGapMs) for pre-game gaps and
 * intervals do not stall replay. Only one setTimeout remains active at a time.
 *
 * Fields are declared explicitly because Node's erasableSyntaxOnly cannot strip
 * parameter properties.
 */
export class ReplayRunner {
  private events: NormEvent[];
  private speed: number;
  private onEvent: (ev: NormEvent) => void;
  private onDone: () => void;

  private idx = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private started = false;
  private done = false;
  private _startedAtMatchTs: number | null = null;
  // Once match time advances, clockless feed events cannot move it backwards.
  private jogoComecou = false;

  constructor(
    events: NormEvent[],
    speed: number,
    onEvent: (ev: NormEvent) => void,
    onDone: () => void
  ) {
    this.events = events;
    this.speed = speed;
    this.onEvent = onEvent;
    this.onDone = onDone;
  }

  /** First-event timestamp, used as the core cursorClock anchor. */
  get startedAtMatchTs(): number | null {
    return this._startedAtMatchTs;
  }

  get isRunning(): boolean {
    return this.started && !this.stopped && !this.done && this.idx < this.events.length;
  }

  get estimatedDurationMs(): number {
    return replayDurationMs(this.events, this.speed);
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    if (this.events.length === 0) {
      this.complete();
      return;
    }
    this._startedAtMatchTs = this.events[0]!.ts;
    this.timer = setTimeout(() => this.fire(), 0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Consome imediatamente apenas os eventos REAIS que ainda faltam e conclui
   * uma vez. Usado quando todos abandonam o replay ou o watchdog vence: placar
   * e vereditos continuam vindo da TxLINE, sem fabricar um apito final.
   */
  finishNow(): void {
    if (!this.started || this.stopped || this.done) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.idx < this.events.length && !this.stopped) {
      const ev = this.events[this.idx++]!;
      if (isMatchInProgress(ev)) this.jogoComecou = true;
      this.onEvent(ev);
    }
    if (!this.stopped) this.complete();
  }

  private complete(): void {
    if (this.done || this.stopped) return;
    this.done = true;
    this.timer = null;
    this.onDone();
  }

  private fire(): void {
    if (this.stopped) return;
    const ev = this.events[this.idx++]!;
    if (isMatchInProgress(ev)) this.jogoComecou = true;
    this.onEvent(ev);

    if (this.idx >= this.events.length) {
      this.complete();
      return;
    }

    // Skip pre-game time; after kickoff, use the requested playback speed.
    const escolhida = Math.max(this.speed, 0.001);
    const speed = this.jogoComecou ? escolhida : Math.max(escolhida, VELOCIDADE_PRE_JOGO);
    const gapMs = (this.events[this.idx]!.ts - ev.ts) / speed;
    // Out-of-order timestamps yield zero delay; snapshots can contain older events.
    const delay = Math.min(Math.max(gapMs, 0), maxReplayGapMs(this.speed, this.jogoComecou));
    this.timer = setTimeout(() => this.fire(), delay);
  }
}
