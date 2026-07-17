import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePregameBody, travadoNoApito, xpEmJogo } from '../src/server/pregame.ts';

test('parse aceita um corpo válido e normaliza ausentes', () => {
  const r = parsePregameBody({ result: 'home', scoreA: 2, scoreB: 1, scoreSet: true, goals: 'over' });
  assert.ok(r.ok);
  assert.deepEqual(r.fields, {
    result: 'home',
    scoreA: 2,
    scoreB: 1,
    scoreSet: true,
    goals: 'over',
    corners: null, // ausente = não preenchido
  });
});

test('parse recusa enum inválido e placar fora do intervalo', () => {
  assert.equal(parsePregameBody({ result: 'casa' }).ok, false, 'resultado fora do enum');
  assert.equal(parsePregameBody({ goals: 'acima' }).ok, false, 'gols fora do enum');
  assert.equal(parsePregameBody({ corners: 'x' }).ok, false, 'escanteios fora do enum');
  assert.equal(parsePregameBody({ result: 'home', scoreA: 16, scoreB: 0, scoreSet: true }).ok, false, 'placar > 15');
  assert.equal(parsePregameBody({ result: 'home', scoreA: -1, scoreB: 0, scoreSet: true }).ok, false, 'placar < 0');
  assert.equal(parsePregameBody({ result: 'home', scoreA: 1.5, scoreB: 0, scoreSet: true }).ok, false, 'placar não inteiro');
  assert.equal(parsePregameBody(null).ok, false, 'corpo nulo');
});

test('parse exige ao menos um mercado preenchido', () => {
  assert.equal(parsePregameBody({}).ok, false, 'nada preenchido não é palpite');
  assert.equal(parsePregameBody({ scoreA: 0, scoreB: 0, scoreSet: false }).ok, false, 'placar 0×0 de fábrica não conta');
  assert.equal(parsePregameBody({ corners: 'under' }).ok, true, 'um mercado basta');
});

test('trava no apito: agendada e antes do apito libera; depois trava', () => {
  const agora = 1_000_000;
  assert.equal(travadoNoApito({ state: 'scheduled', startTs: agora + 1 }, agora), false, 'antes do apito edita');
  assert.equal(travadoNoApito({ state: 'scheduled', startTs: agora }, agora), true, 'no apito trava');
  assert.equal(travadoNoApito({ state: 'scheduled', startTs: agora - 1 }, agora), true, 'depois do apito trava');
  assert.equal(travadoNoApito({ state: 'live', startTs: agora + 999 }, agora), true, 'ao vivo trava mesmo se o horário não bateu');
  assert.equal(travadoNoApito({ state: 'finished', startTs: null }, agora), true, 'encerrada trava');
  assert.equal(travadoNoApito({ state: 'scheduled', startTs: null }, agora), false, 'sem horário conhecido, agendada ainda edita');
});

test('xp em jogo soma só os mercados preenchidos', () => {
  assert.equal(xpEmJogo({ result: 'home', scoreA: 0, scoreB: 0, scoreSet: false, goals: null, corners: null }), 30);
  assert.equal(xpEmJogo({ result: 'home', scoreA: 2, scoreB: 1, scoreSet: true, goals: 'over', corners: 'over' }), 140);
  assert.equal(xpEmJogo({ result: null, scoreA: 0, scoreB: 0, scoreSet: false, goals: null, corners: 'under' }), 25);
});
