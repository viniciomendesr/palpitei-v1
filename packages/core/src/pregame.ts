// Pure, deterministic pregame scoring. The server uses this module as the single
// source of truth for settlement; market lines are persisted with each pick.

/** XP awarded for each correct market. */
export const PREGAME_XP = { result: 30, score: 60, goals: 25, corners: 25 } as const;

/**
 * Legacy lines retained only to migrate and settle picks placed before
 * fixture-specific TxLINE lines were available.
 */
export const PREGAME_LEGACY_LINES = { goals: 2.5, corners: 9.5 } as const;

/** A fan's picks. `null` means the market was left unanswered. */
export interface PregamePickInput {
  result: "home" | "draw" | "away" | null;
  scoreA: number;
  scoreB: number;
  /** True when the fan changed the stepper; a default 0-0 is not a pick. */
  scoreSet: boolean;
  goals: "over" | "under" | null;
  /** Goals line supplied by TxLINE when this pick was submitted. */
  goalsLine: number | null;
  corners: "over" | "under" | null;
  /** Corners line supplied by TxLINE when this pick was submitted. */
  cornersLine: number | null;
}

/** Final match outcome derived from the final feed data. */
export interface PregameFinal {
  goalsP1: number;
  goalsP2: number;
  /** Sum of both teams' corners. */
  cornersTotal: number;
}

/** Settlement for each market. `null` means unanswered; awardedXp sums winners only. */
export interface PregameGrade {
  resultCorrect: boolean | null;
  scoreCorrect: boolean | null;
  goalsCorrect: boolean | null;
  cornersCorrect: boolean | null;
  awardedXp: number;
}

/** Determines the winner from the final score. */
function outcomeOf(final: PregameFinal): "home" | "draw" | "away" {
  if (final.goalsP1 > final.goalsP2) return "home";
  if (final.goalsP2 > final.goalsP1) return "away";
  return "draw";
}

/** Over/under for a half-point line, which cannot push. */
function overUnder(total: number, line: number): "over" | "under" {
  return total > line ? "over" : "under";
}

/**
 * Only half-point lines are eligible. Integer and Asian lines require explicit
 * push or half-win rules, which this product does not implement.
 */
function linhaBinaria(line: number | null): line is number {
  return line !== null && Number.isFinite(line) && line >= 0 && line <= 20 && Math.abs(line * 2 - Math.round(line * 2)) < 1e-9 && !Number.isInteger(line);
}

export function gradePregame(pick: PregamePickInput, final: PregameFinal): PregameGrade {
  const resultCorrect = pick.result === null ? null : pick.result === outcomeOf(final);

  const scoreCorrect = !pick.scoreSet
    ? null
    : pick.scoreA === final.goalsP1 && pick.scoreB === final.goalsP2;

  // A missing persisted line makes the original market unknowable; never settle
  // it against a fallback line that TxLINE did not offer.
  const goalsCorrect =
    pick.goals === null || !linhaBinaria(pick.goalsLine)
      ? null
      : pick.goals === overUnder(final.goalsP1 + final.goalsP2, pick.goalsLine);

  const cornersCorrect =
    pick.corners === null || !linhaBinaria(pick.cornersLine)
      ? null
      : pick.corners === overUnder(final.cornersTotal, pick.cornersLine);

  const awardedXp =
    (resultCorrect ? PREGAME_XP.result : 0) +
    (scoreCorrect ? PREGAME_XP.score : 0) +
    (goalsCorrect ? PREGAME_XP.goals : 0) +
    (cornersCorrect ? PREGAME_XP.corners : 0);

  return { resultCorrect, scoreCorrect, goalsCorrect, cornersCorrect, awardedXp };
}
