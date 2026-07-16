// Replay: reconstrói a linha do tempo de uma partida e reemite os eventos em
// velocidade acelerada. É o caminho da demo quando não há jogo ao vivo.

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
import { cacheUtil, type MatchCacheStore } from "../cache.ts";
import { motivo } from "../errors.ts";
import { generateDemoEvents, sinteticoPermitido } from "./demo.ts";
import { info, warn } from "../log.ts";

/**
 * De onde veio a linha do tempo. O badge da sala mostra ISTO, e ele não pode
 * mentir (G6): rótulo com fallback plausível é pior que rótulo nenhum, porque o
 * jurado confia nele.
 */
export type ReplaySource =
  | "txline-cache" // Postgres: /updates gravado antes (dado real da TxLINE)
  | "txline-updates" // varredura de /updates agora
  | "txline-historical" // /scores/historical
  | "txline-snapshot" // amostrador — timeline pobre, último recurso da TxLINE
  | "synthetic"; // gerador local — DEV-ONLY, nunca em demo

export type ReplayLoad = {
  events: NormEvent[];
  source: ReplaySource;
  /** true quando os eventos vieram de payload REAL da TxLINE. */
  daTxline: boolean;
};

export type LoadReplayOpts = {
  /** DEV-ONLY. Ver ingest/demo.ts. */
  allowSynthetic?: boolean;
  /** Cache de partida (Postgres, via @palpitei/db). Sem store, a cadeia começa na API. */
  cache?: MatchCacheStore;
  /** Grava no cache o que a varredura de /updates trouxer. Padrão: true. */
  persistir?: boolean;
  /** Injeta o relógio do gerador sintético (testes). */
  agora?: number;
};

/**
 * Normaliza e mescla scores + odds numa linha do tempo só.
 * Ordena por ts; empate entre kinds: score antes de odds; scores por seq.
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

/** A lista tem partida de verdade? (kickoff + finalização + volume mínimo) */
export function hasRealMatchContent(events: NormEvent[]): boolean {
  const scores = events.filter((e) => e.kind === "score");
  if (scores.length < 5) return false;
  const hasKickoff = scores.some((e) => e.action === "kickoff");
  const hasFinaliser = scores.some(
    (e) => e.action === "game_finalised" || e.action === "halftime_finalised"
  );
  return hasKickoff && hasFinaliser;
}

/** startTime da fixture, ou dos próprios dados (a fixture pode ter sumido — A1). */
async function descobreStartTime(fixture: Fixture): Promise<number | undefined> {
  if (fixture.startTime) return fixture.startTime;
  try {
    const nomes = await fetchFixtureNames(fixture.fixtureId);
    if (nomes?.startTime) return nomes.startTime;
  } catch {
    /* segue sem */
  }
  return undefined;
}

/**
 * Carrega a linha do tempo. Cadeia de fontes, da melhor para a pior:
 *
 *   1. cache (Postgres)   — /updates gravado: 962 eventos, seq contínuo, offline,
 *                           imune à rotação do dataset (A1). É o caminho da demo.
 *   2. /updates           — a linha do tempo REAL. Custa ~144 requisições e
 *                           precisa de startTime; o resultado vai para o cache.
 *   3. /historical        — sequência completa da partida encerrada. Na devnet
 *                           voltou VAZIO para tudo (A2).
 *   4. /snapshot          — AMOSTRADOR (37 linhas, 1 por tipo de ação). Serve de
 *                           último recurso; a timeline sai pobre e fora de ordem.
 *   5. sintético          — DEV-ONLY e opt-in. Nunca em demo/submissão.
 */
export async function loadReplayEvents(fixture: Fixture, opts: LoadReplayOpts = {}): Promise<ReplayLoad> {
  const fixtureId = fixture.fixtureId;
  const persistir = opts.persistir !== false;

  // 1. cache -----------------------------------------------------------------
  if (opts.cache) {
    try {
      const c = await opts.cache.get(fixtureId);
      if (cacheUtil(c)) {
        const events = mesclar(c.scores, c.odds);
        if (events.length) {
          info(
            `[replay] fixture ${fixtureId}: ${events.length} eventos do cache ` +
              `(${c.scores.length} scores, ${c.odds.length} odds)`
          );
          return { events, source: "txline-cache", daTxline: true };
        }
        warn(`[replay] cache de ${fixtureId} não normalizou nenhum evento — seguindo para a API`);
      }
    } catch (e) {
      warn(`[replay] cache de ${fixtureId} indisponível (${motivo(e)}) — seguindo para a API`);
    }
  }

  // 2. /updates --------------------------------------------------------------
  const startTime = await descobreStartTime(fixture);
  if (startTime) {
    try {
      const scores = await fetchScoresUpdates(fixtureId, startTime);
      if (scores.length) {
        let odds: any[] = [];
        try {
          odds = await fetchOddsUpdates(fixtureId, startTime);
        } catch (e) {
          // Sem odds a partida roda; o explicador é que fica mudo.
          warn(`[replay] odds/updates de ${fixtureId} falhou (${motivo(e)}) — replay só com scores`);
        }
        const events = mesclar(scores, odds);
        if (hasRealMatchContent(events)) {
          info(`[replay] fixture ${fixtureId}: ${events.length} eventos de /updates`);
          if (persistir && opts.cache) {
            // "Persista na primeira vez que vir": o dataset rotaciona (A1) e a
            // varredura custa ~144 requisições. Falha ao gravar não derruba o replay.
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
              warn(`[replay] não consegui gravar o cache de ${fixtureId} (${motivo(e)})`);
            }
          }
          return { events, source: "txline-updates", daTxline: true };
        }
        warn(`[replay] /updates de ${fixtureId} sem partida completa — tentando historical`);
      } else {
        warn(`[replay] /updates de ${fixtureId} veio vazio — tentando historical`);
      }
    } catch (e) {
      warn(`[replay] /updates de ${fixtureId} falhou (${motivo(e)}) — tentando historical`);
    }
  } else {
    warn(`[replay] fixture ${fixtureId} sem startTime — pulando /updates (a varredura precisa da janela)`);
  }

  // 3. /historical  →  4. /snapshot -------------------------------------------
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
    warn(`[replay] historical de ${fixtureId} falhou (${motivo(e)}) — caindo para o snapshot de scores`);
    scoreRaw = await fetchScoresSnapshot(fixtureId);
    source = "txline-snapshot";
  }

  let oddsRaw: any[] = [];
  try {
    oddsRaw = await fetchOddsSnapshot(fixtureId);
    if (oddsRaw.length <= 1) {
      // G2: o snapshot devolve UMA linha. Não é série — o explicador não tem o
      // que explicar. Dizer isto alto evita a "feature sem dados e sem erro".
      warn(
        `[replay] odds de ${fixtureId}: ${oddsRaw.length} linha(s) do snapshot — ` +
          `é foto, não série (G2). O explicador vai ficar mudo neste replay.`
      );
    }
  } catch (e) {
    warn(`[replay] odds de ${fixtureId} indisponíveis (${motivo(e)}) — replay só com scores`);
  }

  const events = mesclar(scoreRaw, oddsRaw);

  // 5. sintético --------------------------------------------------------------
  if (!hasRealMatchContent(events)) {
    if (!sinteticoPermitido(opts)) {
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
    return { events: generateDemoEvents(fixture, opts.agora), source: "synthetic", daTxline: false };
  }

  info(
    `[replay] fixture ${fixtureId}: ${events.length} eventos carregados ` +
      `(${scoreRaw.length} scores, ${oddsRaw.length} odds; fonte: ${source})`
  );
  return { events, source, daTxline: true };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

// Teto do buraco entre dois eventos, em ms de PAREDE. Existe porque o feed tem
// vazios enormes (numa fixture real, 3,6 DIAS entre os metadados de pré-jogo e o
// jogo) que travariam o replay.
//
// Acelerado (30x+): 2s — o objetivo é ver a partida inteira em ~40s, e o teto só
// pula o tempo morto.
// Tempo real (1x): 60s DEPOIS que o relógio da partida começa a correr; até lá,
// 2s. Sem essa distinção o 1x fica injogável: dos 38 eventos de uma fixture, os
// 10 primeiros são metadados de pré-jogo (venue, weather, jersey, lineups,
// aquecimento) e o usuário esperaria ~10 min de boletim do tempo antes do jogo.
const GAP_TETO_ACELERADO_MS = 2_000;
const GAP_TETO_TEMPO_REAL_MS = 60_000;

// Antes de o relógio da partida correr, o replay avança em VELOCIDADE ALTA
// independente da escolhida. Só o teto de 2s não basta: ele limita gaps GRANDES,
// e o pré-jogo tem 245 eventos densos (13 scores + 232 odds) cobrindo ~60 min —
// os gaps são de <2s, então nada era comprimido e o 1x levava 5,8 min de parede
// só de aquecimento e cotação (G3).
const VELOCIDADE_PRE_JOGO = 600;

/** O evento indica partida em andamento? `clockRunning` é o marcador limpo: os
 *  metadados de pré-jogo vêm com false/undefined e clockSeconds 0. */
export function emJogo(ev: NormEvent): boolean {
  return ev.kind === "score" && ev.clockRunning === true;
}

export function gapTetoMs(speed: number, jogoComecou: boolean): number {
  if (speed > 1) return GAP_TETO_ACELERADO_MS;
  return jogoComecou ? GAP_TETO_TEMPO_REAL_MS : GAP_TETO_ACELERADO_MS;
}

/**
 * Reagenda os eventos comprimindo a linha do tempo: delay real entre eventos =
 * (Δts do jogo) / speed, com teto (ver gapTetoMs) para os buracos de pré-jogo e
 * intervalo não travarem o replay. Um único setTimeout ativo por vez.
 *
 * Nota de porte: o v0 declarava os campos como parameter properties no
 * construtor. Aqui não dá — `erasableSyntaxOnly` (o type stripping do Node não
 * sabe apagar isso), então os campos são declarados na mão.
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
  private _startedAtMatchTs: number | null = null;
  // Trava: uma vez que o relógio da partida correu, não volta atrás (o feed tem
  // eventos sem clock no meio do jogo — suspend, comment — e eles não podem
  // fazer o replay "voltar" a comprimir).
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

  /** ts do primeiro evento — a âncora do cursorClock do core. */
  get startedAtMatchTs(): number | null {
    return this._startedAtMatchTs;
  }

  get emAndamento(): boolean {
    return this.started && !this.stopped && this.idx < this.events.length;
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    if (this.events.length === 0) {
      this.onDone();
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

  private fire(): void {
    if (this.stopped) return;
    const ev = this.events[this.idx++]!;
    if (emJogo(ev)) this.jogoComecou = true;
    this.onEvent(ev);

    if (this.idx >= this.events.length) {
      this.timer = null;
      this.onDone();
      return;
    }

    // Enquanto a partida não começou, adianta: ninguém quer ver 60 min de
    // cotação pré-jogo em tempo real. Depois do apito, vale a velocidade pedida.
    const escolhida = Math.max(this.speed, 0.001);
    const speed = this.jogoComecou ? escolhida : Math.max(escolhida, VELOCIDADE_PRE_JOGO);
    const gapMs = (this.events[this.idx]!.ts - ev.ts) / speed;
    // ts fora de ordem => 0. Acontece de verdade: o snapshot é amostrador e traz
    // `goal` com ts ANTERIOR ao `kickoff` (A3).
    const delay = Math.min(Math.max(gapMs, 0), gapTetoMs(this.speed, this.jogoComecou));
    this.timer = setTimeout(() => this.fire(), delay);
  }
}
