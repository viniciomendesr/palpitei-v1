// Replay SINTÉTICO — DEV-ONLY, OPT-IN, NUNCA EM DEMO/SUBMISSÃO.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ REGRA DO HACKATHON (brief oficial das trilhas): a TxLINE tem que ser a   │
// │ fonte primária / entrada ao vivo. O "simulado" que o critério aceita é o │
// │ feed simulado DA TxLINE (os replays da devnet) — não um gerador nosso.   │
// │ Este arquivo existe para desenvolvimento offline: quando a devnet não    │
// │ serve a fixture e você só quer ver a UI mexer. Ligar isto na demo é      │
// │ apresentar dado inventado como se fosse da TxLINE: quebra a regra e, se  │
// │ o badge de fonte não acompanhar, MENTE para o jurado (G6).               │
// │                                                                          │
// │ Portanto: só roda com allowSynthetic explícito (TXLINE_ALLOW_SYNTHETIC=  │
// │ true, padrão false), e a fonte devolvida é "synthetic" — o badge da sala │
// │ TEM de mostrar isso.                                                     │
// └──────────────────────────────────────────────────────────────────────────┘
//
// Gera uma partida verossímil e DETERMINÍSTICA por fixtureId: o mesmo id
// reproduz exatamente os mesmos eventos, para que bug achado num replay
// sintético seja reproduzível.

import type { Fixture, NormEvent, OddsEvent, ScoreEvent } from "@palpitei/core";
import { config } from "../config.ts";

const HALF_MS = 45 * 60_000;
const ODDS_INTERVAL_MS = 180_000; // updates de rotina a cada ~3 min (jitter < limiar de explicação)

/** PRNG determinístico (mulberry32), semeado no fixtureId. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Weighted = { action: string; w: number };
const WALK_ACTIONS: Weighted[] = [
  { action: "possession", w: 0.18 },
  { action: "safe_possession", w: 0.16 },
  { action: "throw_in", w: 0.16 },
  { action: "attack_possession", w: 0.14 },
  { action: "free_kick", w: 0.12 },
  { action: "shot", w: 0.12 },
  { action: "corner", w: 0.09 },
  { action: "yellow_card", w: 0.03 },
];
const SHOT_OUTCOMES = ["OnTarget", "OffTarget", "Blocked", "Woodwork"];

/** O sintético está liberado? Só true explícito libera. */
export function sinteticoPermitido(opts?: { allowSynthetic?: boolean }): boolean {
  return opts?.allowSynthetic === true || config.allowSynthetic;
}

/**
 * Eventos sintéticos de uma partida inteira.
 *
 * `agora` é injetável de propósito: o gerador é uma FONTE de dados (o lugar onde
 * a linha do tempo nasce), não um motor — motor nenhum lê relógio de parede. Nos
 * testes, fixar `agora` deixa a saída 100% determinística.
 */
export function generateDemoEvents(fixture: Fixture, agora: number = Date.now()): NormEvent[] {
  const rng = mulberry32(fixture.fixtureId || 1);
  // t0 ancorado em hora cheia: chamadas na mesma hora reproduzem os MESMOS ts
  // (a estrutura da partida já é determinística pelo rng semeado no fixtureId).
  const t0 =
    fixture.startTime && fixture.startTime < agora
      ? fixture.startTime
      : Math.floor((agora - 3 * 3600_000) / 3600_000) * 3600_000;

  const events: NormEvent[] = [];
  let seq = 0;
  const goals = { p1: 0, p2: 0 };
  const corners = { p1: 0, p2: 0 };

  const pushScore = (
    action: string,
    ts: number,
    extra?: Partial<Pick<ScoreEvent, "statusId" | "period" | "data">>
  ): void => {
    events.push({
      kind: "score",
      fixtureId: fixture.fixtureId,
      seq: ++seq,
      ts,
      action,
      goals: { ...goals },
      corners: { ...corners },
      hasScore: true,
      raw: { synthetic: true },
      ...extra,
    });
  };

  // Estado das odds sintéticas (probabilidades implícitas, somam ~100 no 1X2)
  let p1Pct = 30 + rng() * 25;
  let p2Pct = 30 + rng() * 25;
  let drawPct = 100 - p1Pct - p2Pct;
  let overPct = 45 + rng() * 15;

  const normalizePcts = (): void => {
    const total = p1Pct + drawPct + p2Pct;
    p1Pct = (p1Pct / total) * 100;
    drawPct = (drawPct / total) * 100;
    p2Pct = (p2Pct / total) * 100;
  };

  const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

  const price = (pct: number): { odds: number; pct: number } => {
    const p = clamp(pct, 1, 99);
    return { odds: Math.round((100 / p) * 1000) / 1000, pct: Math.round(p * 1000) / 1000 };
  };

  const kickoff1Ts = t0 + 150_000;

  const pushOdds = (ts: number): void => {
    const mk = (
      marketType: string,
      line: number | undefined,
      prices: { name: string; pct: number }[]
    ): OddsEvent => ({
      kind: "odds",
      fixtureId: fixture.fixtureId,
      ts,
      marketType,
      line,
      inRunning: ts >= kickoff1Ts,
      bookmaker: "SyntheticStablePrice",
      prices: prices.map((p) => ({ name: p.name, ...price(p.pct) })),
      raw: { synthetic: true },
    });
    events.push(
      mk("MATCH_RESULT", undefined, [
        { name: "1", pct: p1Pct },
        { name: "x", pct: drawPct },
        { name: "2", pct: p2Pct },
      ])
    );
    events.push(
      mk("OVERUNDER_PARTICIPANT_GOALS", 2.5, [
        { name: "over", pct: overPct },
        { name: "under", pct: 100 - overPct },
      ])
    );
  };

  // Jitter de rotina: sempre abaixo do limiar de explicação (3 p.p.)
  const jitterOdds = (): void => {
    p1Pct += (rng() - 0.5) * 2.4;
    p2Pct += (rng() - 0.5) * 2.4;
    drawPct = 100 - p1Pct - p2Pct;
    normalizePcts();
    overPct = clamp(overPct + (rng() - 0.5) * 2.4, 5, 95);
  };

  // Reação a gol: deslocamento >= 5 p.p. a favor de quem marcou (exercita o explicador)
  const goalShift = (team: "p1" | "p2"): void => {
    const shift = 8 + rng() * 6;
    if (team === "p1") {
      p1Pct += shift;
      p2Pct = clamp(p2Pct - shift * 0.6, 2, 96);
    } else {
      p2Pct += shift;
      p1Pct = clamp(p1Pct - shift * 0.6, 2, 96);
    }
    drawPct = clamp(100 - p1Pct - p2Pct, 2, 96);
    normalizePcts();
    overPct = clamp(overPct + 5 + rng() * 3, 5, 95);
  };

  const pickAction = (): string => {
    let r = rng();
    for (const { action, w } of WALK_ACTIONS) {
      if (r < w) return action;
      r -= w;
    }
    return "possession";
  };

  // Gols pré-sorteados: 1 a 4 no total, minuto aleatório em cada tempo
  const totalGoals = 1 + Math.floor(rng() * 4);
  const goalPlan: { half: 1 | 2; offsetMs: number; team: "p1" | "p2" }[] = [];
  for (let i = 0; i < totalGoals; i++) {
    goalPlan.push({
      half: rng() < 0.5 ? 1 : 2,
      offsetMs: Math.floor((0.5 + rng() * 44) * 60_000),
      team: rng() < 0.5 ? "p1" : "p2",
    });
  }
  goalPlan.sort((a, b) => a.half - b.half || a.offsetMs - b.offsetMs);

  // ---- pré-jogo -------------------------------------------------------------
  pushScore("comment", t0, {
    data: { note: "REPLAY SINTÉTICO — devnet sem dados de partida para esta fixture" },
  });
  pushOdds(t0 + 30_000);
  jitterOdds();
  pushOdds(t0 + 90_000);
  if (rng() < 0.5) {
    jitterOdds();
    pushOdds(t0 + 120_000);
  }

  // ---- um tempo de jogo -----------------------------------------------------
  const playHalf = (halfStartTs: number, half: 1 | 2): number => {
    pushScore("kickoff", halfStartTs, { period: half });
    const stoppageMs = Math.floor((1 + rng() * 3) * 60_000);
    const halfEndTs = halfStartTs + HALF_MS + stoppageMs;
    const pendingGoals = goalPlan
      .filter((g) => g.half === half)
      .map((g) => ({ ...g, ts: halfStartTs + g.offsetMs }));

    let t = halfStartTs;
    let nextOddsTs = halfStartTs + ODDS_INTERVAL_MS;
    while (true) {
      t += (25 + rng() * 50) * 1000; // um lance a cada 25–75s
      if (t >= halfEndTs) break;

      while (pendingGoals.length && pendingGoals[0]!.ts <= t) {
        const g = pendingGoals.shift()!;
        goals[g.team] += 1;
        pushScore("goal", g.ts, { period: half });
        goalShift(g.team);
        pushOdds(g.ts + 5_000 + Math.floor(rng() * 15_000));
        if (rng() < 0.5) {
          jitterOdds();
          pushOdds(g.ts + 30_000 + Math.floor(rng() * 15_000));
        }
      }

      const action = pickAction();
      if (action === "corner") corners[rng() < 0.5 ? "p1" : "p2"] += 1;
      const data =
        action === "shot" ? { Outcome: SHOT_OUTCOMES[Math.floor(rng() * SHOT_OUTCOMES.length)] } : undefined;
      pushScore(action, t, { period: half, data });

      if (t >= nextOddsTs) {
        jitterOdds();
        pushOdds(t);
        nextOddsTs += ODDS_INTERVAL_MS;
      }
    }

    // gols sorteados para depois do último lance ainda entram antes do apito
    while (pendingGoals.length) {
      const g = pendingGoals.shift()!;
      const ts = Math.min(g.ts, halfEndTs - 1_000);
      goals[g.team] += 1;
      pushScore("goal", ts, { period: half });
      goalShift(g.team);
      pushOdds(ts + 5_000);
    }
    return halfEndTs;
  };

  const half1EndTs = playHalf(kickoff1Ts, 1);
  pushScore("halftime_finalised", half1EndTs);

  const kickoff2Ts = half1EndTs + 15 * 60_000;
  const half2EndTs = playHalf(kickoff2Ts, 2);
  pushScore("game_finalised", half2EndTs, { statusId: 100, period: 100 });

  return events;
}
