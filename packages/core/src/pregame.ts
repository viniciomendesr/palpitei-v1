// Palpite pré-jogo — a regra de pontuação, pura e determinística.
//
// Antes do apito o fã crava até quatro palpites sobre uma partida futura; no fim
// da partida cada mercado acertado paga XP. Esta é a fonte ÚNICA dessa conta: a
// liquidação no servidor importa `gradePregame` daqui em vez de recopiar a tabela
// (copiar a tabela de XP já foi o bug nº 1 desta v1). Sem I/O, sem Date.now().
//
// Os pesos e as linhas vêm do mockup (`PALPITE PRÉ-JOGO`): resultado 30, placar
// exato 60, total de gols 25, escanteios 25 — 140 no total.

/** Quanto vale cada mercado acertado. */
export const PREGAME_XP = { result: 30, score: 60, goals: 25, corners: 25 } as const;

/** As linhas de Acima/Abaixo. Fixas por produto (o mockup não varia por partida). */
export const PREGAME_LINES = { goals: 2.5, corners: 9.5 } as const;

/** O que o fã escolheu. `null` = mercado não preenchido (não pontua, não penaliza). */
export interface PregamePickInput {
  result: "home" | "draw" | "away" | null;
  scoreA: number;
  scoreB: number;
  /** true quando o fã mexeu no stepper — placar 0×0 "de fábrica" não conta como palpite. */
  scoreSet: boolean;
  goals: "over" | "under" | null;
  corners: "over" | "under" | null;
}

/** O desfecho real da partida, lido do dado no apito final. */
export interface PregameFinal {
  goalsP1: number;
  goalsP2: number;
  /** Soma dos escanteios das duas equipes. */
  cornersTotal: number;
}

/** O veredito de cada mercado. `null` = não preenchido. `awardedXp` soma só os acertos. */
export interface PregameGrade {
  resultCorrect: boolean | null;
  scoreCorrect: boolean | null;
  goalsCorrect: boolean | null;
  cornersCorrect: boolean | null;
  awardedXp: number;
}

/** Quem venceu, a partir do placar final. */
function outcomeOf(final: PregameFinal): "home" | "draw" | "away" {
  if (final.goalsP1 > final.goalsP2) return "home";
  if (final.goalsP2 > final.goalsP1) return "away";
  return "draw";
}

/** Acima/Abaixo de uma linha. `total > linha` (as linhas são .5, então nunca empata). */
function overUnder(total: number, line: number): "over" | "under" {
  return total > line ? "over" : "under";
}

export function gradePregame(pick: PregamePickInput, final: PregameFinal): PregameGrade {
  const resultCorrect = pick.result === null ? null : pick.result === outcomeOf(final);

  const scoreCorrect = !pick.scoreSet
    ? null
    : pick.scoreA === final.goalsP1 && pick.scoreB === final.goalsP2;

  const goalsCorrect =
    pick.goals === null ? null : pick.goals === overUnder(final.goalsP1 + final.goalsP2, PREGAME_LINES.goals);

  const cornersCorrect =
    pick.corners === null ? null : pick.corners === overUnder(final.cornersTotal, PREGAME_LINES.corners);

  const awardedXp =
    (resultCorrect ? PREGAME_XP.result : 0) +
    (scoreCorrect ? PREGAME_XP.score : 0) +
    (goalsCorrect ? PREGAME_XP.goals : 0) +
    (cornersCorrect ? PREGAME_XP.corners : 0);

  return { resultCorrect, scoreCorrect, goalsCorrect, cornersCorrect, awardedXp };
}
