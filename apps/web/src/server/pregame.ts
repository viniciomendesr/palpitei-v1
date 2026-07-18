/** Pure pregame-pick validation, kickoff locking, and XP calculation. */

import { PREGAME_XP } from '@palpitei/core';

export interface PregameFields {
  result: 'home' | 'draw' | 'away' | null;
  scoreA: number;
  scoreB: number;
  scoreSet: boolean;
  goals: 'over' | 'under' | null;
  goalsLine: number | null;
  corners: 'over' | 'under' | null;
  cornersLine: number | null;
}

const RESULTS = new Set(['home', 'draw', 'away']);
const OVER_UNDER = new Set(['over', 'under']);

/** Optional enum values accept null or undefined and reject all other strings. */
function enumOpcional(v: unknown, permitido: Set<string>): { ok: true; value: string | null } | { ok: false } {
  if (v == null) return { ok: true, value: null };
  if (typeof v === 'string' && permitido.has(v)) return { ok: true, value: v };
  return { ok: false };
}

/** Bounded integer with a minimum default for omitted values. */
function intNoIntervalo(v: unknown, min: number, max: number): number | null {
  if (v == null) return min;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return null;
  return v;
}

/** Accepts only half-goal lines, which have unambiguous over/under settlement. */
function linhaBinaria(v: unknown): number | null | undefined {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 20) return undefined;
  const dobro = v * 2;
  if (Math.abs(dobro - Math.round(dobro)) > 1e-9 || Number.isInteger(v)) return undefined;
  return v;
}

function algumMercado(f: PregameFields): boolean {
  return f.result !== null || f.scoreSet || f.goals !== null || f.corners !== null;
}

/** Validates an untrusted pregame-pick request body. */
export function parsePregameBody(
  body: unknown
): { ok: true; fields: PregameFields } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'corpo inválido' };
  const b = body as Record<string, unknown>;

  const result = enumOpcional(b.result, RESULTS);
  if (!result.ok) return { ok: false, error: 'resultado inválido' };
  const goals = enumOpcional(b.goals, OVER_UNDER);
  if (!goals.ok) return { ok: false, error: 'total de gols inválido' };
  const corners = enumOpcional(b.corners, OVER_UNDER);
  if (!corners.ok) return { ok: false, error: 'escanteios inválido' };

  const goalsLine = linhaBinaria(b.goalsLine);
  if (goalsLine === undefined) return { ok: false, error: 'linha de gols inválida' };
  const cornersLine = linhaBinaria(b.cornersLine);
  if (cornersLine === undefined) return { ok: false, error: 'linha de escanteios inválida' };
  if ((goals.value !== null) !== (goalsLine !== null)) {
    return { ok: false, error: 'a linha de gols não confere com o mercado' };
  }
  if ((corners.value !== null) !== (cornersLine !== null)) {
    return { ok: false, error: 'a linha de escanteios não confere com o mercado' };
  }

  const scoreA = intNoIntervalo(b.scoreA, 0, 15);
  const scoreB = intNoIntervalo(b.scoreB, 0, 15);
  if (scoreA === null || scoreB === null) return { ok: false, error: 'placar fora do intervalo (0 a 15)' };

  const fields: PregameFields = {
    result: result.value as PregameFields['result'],
    scoreA,
    scoreB,
    scoreSet: b.scoreSet === true,
    goals: goals.value as PregameFields['goals'],
    goalsLine,
    corners: corners.value as PregameFields['corners'],
    cornersLine,
  };
  if (!algumMercado(fields)) return { ok: false, error: 'faça ao menos um palpite' };
  return { ok: true, fields };
}

/** Locks picks once a fixture is no longer scheduled or its known kickoff has passed. */
export function isLockedAtKickoff(match: { state: string; startTs: number | null }, now: number): boolean {
  if (match.state !== 'scheduled') return true;
  if (match.startTs != null && now >= match.startTs) return true;
  return false;
}

/** Returns the sum of XP weights for selected markets. */
export function xpAtStake(fields: PregameFields): number {
  return (
    (fields.result ? PREGAME_XP.result : 0) +
    (fields.scoreSet ? PREGAME_XP.score : 0) +
    (fields.goals ? PREGAME_XP.goals : 0) +
    (fields.corners ? PREGAME_XP.corners : 0)
  );
}
