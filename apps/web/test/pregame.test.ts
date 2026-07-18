import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePregameBody, isLockedAtKickoff, xpAtStake } from '../src/server/pregame.ts';

test('parse aceita um corpo válido com a linha TxLINE e normaliza ausentes', () => {
  const r = parsePregameBody({ result: 'home', scoreA: 2, scoreB: 1, scoreSet: true, goals: 'over', goalsLine: 2.5 });
  assert.ok(r.ok);
  assert.deepEqual(r.fields, {
    result: 'home',
    scoreA: 2,
    scoreB: 1,
    scoreSet: true,
    goals: 'over',
    goalsLine: 2.5,
    corners: null, // Missing means not selected.
    cornersLine: null,
  });
});

test('parse recusa enum inválido e placar fora do intervalo', () => {
  assert.equal(parsePregameBody({ result: 'casa' }).ok, false, 'resultado fora do enum');
  assert.equal(parsePregameBody({ goals: 'acima', goalsLine: 2.5 }).ok, false, 'gols fora do enum');
  assert.equal(parsePregameBody({ corners: 'x', cornersLine: 9.5 }).ok, false, 'escanteios fora do enum');
  assert.equal(parsePregameBody({ result: 'home', scoreA: 16, scoreB: 0, scoreSet: true }).ok, false, 'placar > 15');
  assert.equal(parsePregameBody({ result: 'home', scoreA: -1, scoreB: 0, scoreSet: true }).ok, false, 'placar < 0');
  assert.equal(parsePregameBody({ result: 'home', scoreA: 1.5, scoreB: 0, scoreSet: true }).ok, false, 'placar não inteiro');
  assert.equal(parsePregameBody(null).ok, false, 'corpo nulo');
  assert.equal(parsePregameBody({ goals: 'over' }).ok, false, 'mercado sem linha não vira fixo silencioso');
  assert.equal(parsePregameBody({ goalsLine: 2.5 }).ok, false, 'linha sem mercado é recusada');
  assert.equal(parsePregameBody({ goals: 'over', goalsLine: 3 }).ok, false, 'linha inteira tem push e não é binária');
  assert.equal(parsePregameBody({ corners: 'under', cornersLine: 9.25 }).ok, false, 'linha asiática não é fingida como binária');
});

test('parse exige ao menos um mercado preenchido', () => {
  assert.equal(parsePregameBody({}).ok, false, 'nada preenchido não é palpite');
  assert.equal(parsePregameBody({ scoreA: 0, scoreB: 0, scoreSet: false }).ok, false, 'placar 0×0 de fábrica não conta');
  assert.equal(parsePregameBody({ corners: 'under', cornersLine: 9.5 }).ok, true, 'um mercado basta');
});

test('trava no apito: agendada e antes do apito libera; depois trava', () => {
  const agora = 1_000_000;
  assert.equal(isLockedAtKickoff({ state: 'scheduled', startTs: agora + 1 }, agora), false, 'antes do apito edita');
  assert.equal(isLockedAtKickoff({ state: 'scheduled', startTs: agora }, agora), true, 'no apito trava');
  assert.equal(isLockedAtKickoff({ state: 'scheduled', startTs: agora - 1 }, agora), true, 'depois do apito trava');
  assert.equal(isLockedAtKickoff({ state: 'live', startTs: agora + 999 }, agora), true, 'ao vivo trava mesmo se o horário não bateu');
  assert.equal(isLockedAtKickoff({ state: 'finished', startTs: null }, agora), true, 'encerrada trava');
  assert.equal(isLockedAtKickoff({ state: 'scheduled', startTs: null }, agora), false, 'sem horário conhecido, agendada ainda edita');
});

test('xp em jogo soma só os mercados preenchidos', () => {
  assert.equal(xpAtStake({ result: 'home', scoreA: 0, scoreB: 0, scoreSet: false, goals: null, goalsLine: null, corners: null, cornersLine: null }), 30);
  assert.equal(xpAtStake({ result: 'home', scoreA: 2, scoreB: 1, scoreSet: true, goals: 'over', goalsLine: 2.5, corners: 'over', cornersLine: 9.5 }), 140);
  assert.equal(xpAtStake({ result: null, scoreA: 0, scoreB: 0, scoreSet: false, goals: null, goalsLine: null, corners: 'under', cornersLine: 9.5 }), 25);
});
