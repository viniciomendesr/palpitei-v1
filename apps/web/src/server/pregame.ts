// Lógica pura do palpite pré-jogo — validação do corpo, trava-no-apito e o XP em
// jogo. A rota (route.ts) é fina de propósito: autentica, chama isto, persiste.
// Assim o que dá para testar não depende de Privy nem de banco.

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

/** Enum opcional: null/ausente = mercado não preenchido; qualquer outra string é recusada. */
function enumOpcional(v: unknown, permitido: Set<string>): { ok: true; value: string | null } | { ok: false } {
  if (v == null) return { ok: true, value: null };
  if (typeof v === 'string' && permitido.has(v)) return { ok: true, value: v };
  return { ok: false };
}

/** Inteiro no intervalo; ausente vira o mínimo (o stepper começa em 0). */
function intNoIntervalo(v: unknown, min: number, max: number): number | null {
  if (v == null) return min;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return null;
  return v;
}

/**
 * A tela só aceita linhas binárias de meio gol. A TxLINE também entrega linhas
 * inteiras e asiáticas (.25/.75); sem uma regra de push/meio ganho elas NÃO
 * podem ser apresentadas como Acima/Abaixo simples.
 */
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

/**
 * Valida o corpo do POST. NÃO confia em nada do cliente: enums fechados, placar
 * 0–15 inteiro, e ao menos um mercado (0×0 de fábrica sem `scoreSet` não conta).
 */
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

/**
 * Travado quando a partida saiu de "agendada" (já vive/encerrou) OU o apito
 * conhecido já passou. Sem horário conhecido, uma partida agendada segue editável
 * — não dá para provar que começou (G4: start_ts é nullable no feed).
 */
export function travadoNoApito(match: { state: string; startTs: number | null }, agora: number): boolean {
  if (match.state !== 'scheduled') return true;
  if (match.startTs != null && agora >= match.startTs) return true;
  return false;
}

/** XP "em jogo": a soma dos pesos dos mercados preenchidos (fonte: PREGAME_XP do core). */
export function xpEmJogo(f: PregameFields): number {
  return (
    (f.result ? PREGAME_XP.result : 0) +
    (f.scoreSet ? PREGAME_XP.score : 0) +
    (f.goals ? PREGAME_XP.goals : 0) +
    (f.corners ? PREGAME_XP.corners : 0)
  );
}
