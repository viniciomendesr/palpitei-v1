// Palpite pré-jogo — a regra de pontuação, pura e determinística.
//
// Antes do apito o fã crava até quatro palpites sobre uma partida futura; no fim
// da partida cada mercado acertado paga XP. Esta é a fonte ÚNICA dessa conta: a
// liquidação no servidor importa `gradePregame` daqui em vez de recopiar a tabela
// (copiar a tabela de XP já foi o bug nº 1 desta v1). Sem I/O, sem Date.now().
//
// Os pesos vêm do mockup (`PALPITE PRÉ-JOGO`): resultado 30, placar exato 60,
// total de gols 25, escanteios 25 — 140 no total. As LINHAS de total, por outro
// lado, pertencem à cotação da TxLINE vista pelo fã e ficam gravadas no palpite.

/** Quanto vale cada mercado acertado. */
export const PREGAME_XP = { result: 30, score: 60, goals: 25, corners: 25 } as const;

/**
 * Linhas que a primeira versão da tela mostrava antes de existir a cotação por
 * partida. São mantidas apenas para migrar e liquidar palpites JÁ feitos sob
 * aquela regra; novo código nunca deve escolhê-las para uma partida nova.
 */
export const PREGAME_LEGACY_LINES = { goals: 2.5, corners: 9.5 } as const;

/** O que o fã escolheu. `null` = mercado não preenchido (não pontua, não penaliza). */
export interface PregamePickInput {
  result: "home" | "draw" | "away" | null;
  scoreA: number;
  scoreB: number;
  /** true quando o fã mexeu no stepper — placar 0×0 "de fábrica" não conta como palpite. */
  scoreSet: boolean;
  goals: "over" | "under" | null;
  /** Linha de gols confirmada pela TxLINE junto com este palpite. */
  goalsLine: number | null;
  corners: "over" | "under" | null;
  /** Linha de escanteios confirmada pela TxLINE junto com este palpite. */
  cornersLine: number | null;
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

/**
 * Só linhas de meio gol são elegíveis. Com uma linha inteira, o total pode
 * empatar e "Acima/Abaixo" deixaria de ter resposta binária. O snapshot pode
 * oferecer linhas asiáticas (.25/.75) e inteiras; elas não entram até o produto
 * ter uma regra de push/meio ganho — nunca inventamos uma aqui.
 */
function linhaBinaria(line: number | null): line is number {
  return line !== null && Number.isFinite(line) && line >= 0 && line <= 20 && Math.abs(line * 2 - Math.round(line * 2)) < 1e-9 && !Number.isInteger(line);
}

export function gradePregame(pick: PregamePickInput, final: PregameFinal): PregameGrade {
  const resultCorrect = pick.result === null ? null : pick.result === outcomeOf(final);

  const scoreCorrect = !pick.scoreSet
    ? null
    : pick.scoreA === final.goalsP1 && pick.scoreB === final.goalsP2;

  // Sem a linha persistida não há como saber qual mercado a pessoa viu. Não
  // usamos uma constante como fallback: pagar/penalizar contra uma linha que a
  // TxLINE não ofereceu seria dado inventado. A migration preenche as linhas
  // legadas dos picks antigos, antes desta regra chegar à produção.
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
