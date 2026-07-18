import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradePregame,
  PREGAME_XP,
  PREGAME_LEGACY_LINES,
  type PregamePickInput,
  type PregameFinal,
} from "../src/pregame.ts";

/** Empty pick; each test enables only the market it exercises. */
const EMPTY: PregamePickInput = {
  result: null,
  scoreA: 0,
  scoreB: 0,
  scoreSet: false,
  goals: null,
  goalsLine: null,
  corners: null,
  cornersLine: null,
};

test("pesos vêm do produto e as linhas fixas são apenas legado", () => {
  assert.deepEqual(PREGAME_XP, { result: 30, score: 60, goals: 25, corners: 25 });
  assert.deepEqual(PREGAME_LEGACY_LINES, { goals: 2.5, corners: 9.5 });
});

test("tudo certo credita os 140 XP e marca cada mercado", () => {
  const final: PregameFinal = { goalsP1: 2, goalsP2: 1, cornersTotal: 12 };
  const pick: PregamePickInput = {
    result: "home",
    scoreA: 2,
    scoreB: 1,
    scoreSet: true,
    goals: "over", // 3 goals > 2.5
    goalsLine: 2.5,
    corners: "over", // 12 > 9.5
    cornersLine: 9.5,
  };
  const g = gradePregame(pick, final);
  assert.deepEqual(g, {
    resultCorrect: true,
    scoreCorrect: true,
    goalsCorrect: true,
    cornersCorrect: true,
    awardedXp: 140,
  });
});

test("resultado: mapeia p1>p2=home, p2>p1=away, igual=draw", () => {
  const draw: PregameFinal = { goalsP1: 1, goalsP2: 1, cornersTotal: 0 };
  assert.equal(gradePregame({ ...EMPTY, result: "draw" }, draw).resultCorrect, true);
  assert.equal(gradePregame({ ...EMPTY, result: "home" }, draw).resultCorrect, false);

  const away: PregameFinal = { goalsP1: 0, goalsP2: 2, cornersTotal: 0 };
  assert.equal(gradePregame({ ...EMPTY, result: "away" }, away).resultCorrect, true);

  const home: PregameFinal = { goalsP1: 3, goalsP2: 0, cornersTotal: 0 };
  const g = gradePregame({ ...EMPTY, result: "home" }, home);
  assert.equal(g.resultCorrect, true);
  assert.equal(g.awardedXp, PREGAME_XP.result);
});

test("total de gols: usa a linha que estava na cotação confirmada", () => {
  const dois: PregameFinal = { goalsP1: 1, goalsP2: 1, cornersTotal: 0 };
  assert.equal(gradePregame({ ...EMPTY, goals: "under", goalsLine: 2.5 }, dois).goalsCorrect, true);
  assert.equal(gradePregame({ ...EMPTY, goals: "over", goalsLine: 2.5 }, dois).goalsCorrect, false);

  const tres: PregameFinal = { goalsP1: 2, goalsP2: 1, cornersTotal: 0 };
  assert.equal(gradePregame({ ...EMPTY, goals: "over", goalsLine: 2.5 }, tres).goalsCorrect, true);
  assert.equal(gradePregame({ ...EMPTY, goals: "over", goalsLine: 2.5 }, tres).awardedXp, PREGAME_XP.goals);
  assert.equal(gradePregame({ ...EMPTY, goals: "under", goalsLine: 3.5 }, tres).goalsCorrect, true, 'a linha de 3,5 não cai para 2,5');
});

test("escanteios: 9 é Abaixo, 10 é Acima de 9,5", () => {
  const nove: PregameFinal = { goalsP1: 0, goalsP2: 0, cornersTotal: 9 };
  assert.equal(gradePregame({ ...EMPTY, corners: "under", cornersLine: 9.5 }, nove).cornersCorrect, true);
  assert.equal(gradePregame({ ...EMPTY, corners: "over", cornersLine: 9.5 }, nove).cornersCorrect, false);

  const dez: PregameFinal = { goalsP1: 0, goalsP2: 0, cornersTotal: 10 };
  assert.equal(gradePregame({ ...EMPTY, corners: "over", cornersLine: 9.5 }, dez).cornersCorrect, true);
  assert.equal(gradePregame({ ...EMPTY, corners: "over", cornersLine: 9.5 }, dez).awardedXp, PREGAME_XP.corners);
});

test("linha ausente, inteira ou asiática não liquida como se fosse uma cotação real", () => {
  const final: PregameFinal = { goalsP1: 2, goalsP2: 1, cornersTotal: 12 };
  assert.equal(gradePregame({ ...EMPTY, goals: 'over', goalsLine: null }, final).goalsCorrect, null);
  assert.equal(gradePregame({ ...EMPTY, goals: 'over', goalsLine: 3 }, final).goalsCorrect, null);
  assert.equal(gradePregame({ ...EMPTY, corners: 'over', cornersLine: 9.25 }, final).cornersCorrect, null);
});

test("placar exato: só pontua com scoreSet, e exige os dois lados", () => {
  const final: PregameFinal = { goalsP1: 2, goalsP2: 1, cornersTotal: 0 };

  // A correct score does not count unless the fan set it explicitly.
  const naoTocou = gradePregame({ ...EMPTY, scoreA: 2, scoreB: 1, scoreSet: false }, final);
  assert.equal(naoTocou.scoreCorrect, null);
  assert.equal(naoTocou.awardedXp, 0);

  // Correct exact score.
  const cravou = gradePregame({ ...EMPTY, scoreA: 2, scoreB: 1, scoreSet: true }, final);
  assert.equal(cravou.scoreCorrect, true);
  assert.equal(cravou.awardedXp, PREGAME_XP.score);

  // One incorrect side makes the exact score incorrect.
  const meio = gradePregame({ ...EMPTY, scoreA: 2, scoreB: 0, scoreSet: true }, final);
  assert.equal(meio.scoreCorrect, false);
  assert.equal(meio.awardedXp, 0);
});

test("acertar o resultado mas errar o placar credita só o resultado", () => {
  const final: PregameFinal = { goalsP1: 2, goalsP2: 1, cornersTotal: 0 };
  const pick: PregamePickInput = { ...EMPTY, result: "home", scoreA: 3, scoreB: 0, scoreSet: true };
  const g = gradePregame(pick, final);
  assert.equal(g.resultCorrect, true);
  assert.equal(g.scoreCorrect, false);
  assert.equal(g.awardedXp, PREGAME_XP.result);
});

test("mercado não preenchido fica null e não penaliza", () => {
  const final: PregameFinal = { goalsP1: 2, goalsP2: 1, cornersTotal: 12 };
  const g = gradePregame(EMPTY, final);
  assert.deepEqual(g, {
    resultCorrect: null,
    scoreCorrect: null,
    goalsCorrect: null,
    cornersCorrect: null,
    awardedXp: 0,
  });
});
