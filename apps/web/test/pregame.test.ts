import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePregameBody, isLockedAtKickoff, xpAtStake } from '../src/server/pregame.ts';

test('parse accepts a valid body with the TxLINE line and normalizes absent fields', () => {
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

test('parse refuses an invalid enum and a score out of range', () => {
  assert.equal(parsePregameBody({ result: 'casa' }).ok, false, 'result outside the enum');
  assert.equal(parsePregameBody({ goals: 'acima', goalsLine: 2.5 }).ok, false, 'goals outside the enum');
  assert.equal(parsePregameBody({ corners: 'x', cornersLine: 9.5 }).ok, false, 'corners outside the enum');
  assert.equal(parsePregameBody({ result: 'home', scoreA: 16, scoreB: 0, scoreSet: true }).ok, false, 'score > 15');
  assert.equal(parsePregameBody({ result: 'home', scoreA: -1, scoreB: 0, scoreSet: true }).ok, false, 'score < 0');
  assert.equal(parsePregameBody({ result: 'home', scoreA: 1.5, scoreB: 0, scoreSet: true }).ok, false, 'non-integer score');
  assert.equal(parsePregameBody(null).ok, false, 'null body');
  assert.equal(parsePregameBody({ goals: 'over' }).ok, false, 'a market with no line never becomes a silent fixed line');
  assert.equal(parsePregameBody({ goalsLine: 2.5 }).ok, false, 'a line with no market is refused');
  assert.equal(parsePregameBody({ goals: 'over', goalsLine: 3 }).ok, false, 'a whole line has a push and is not binary');
  assert.equal(parsePregameBody({ corners: 'under', cornersLine: 9.25 }).ok, false, 'an asian line is not faked as binary');
});

test('parse requires at least one filled market', () => {
  assert.equal(parsePregameBody({}).ok, false, 'nothing filled in is not a palpite');
  assert.equal(parsePregameBody({ scoreA: 0, scoreB: 0, scoreSet: false }).ok, false, 'a factory-default 0x0 score does not count');
  assert.equal(parsePregameBody({ corners: 'under', cornersLine: 9.5 }).ok, true, 'one market is enough');
});

test('kickoff lock: scheduled and before kickoff is open; after that it locks', () => {
  const agora = 1_000_000;
  assert.equal(isLockedAtKickoff({ state: 'scheduled', startTs: agora + 1 }, agora), false, 'before the whistle it is editable');
  assert.equal(isLockedAtKickoff({ state: 'scheduled', startTs: agora }, agora), true, 'at the whistle it locks');
  assert.equal(isLockedAtKickoff({ state: 'scheduled', startTs: agora - 1 }, agora), true, 'after the whistle it locks');
  assert.equal(isLockedAtKickoff({ state: 'live', startTs: agora + 999 }, agora), true, 'live locks even if the clock has not reached kickoff');
  assert.equal(isLockedAtKickoff({ state: 'finished', startTs: null }, agora), true, 'finished locks');
  assert.equal(isLockedAtKickoff({ state: 'scheduled', startTs: null }, agora), false, 'with no known kickoff time, scheduled is still editable');
});

test('xp at stake sums only the filled markets', () => {
  assert.equal(xpAtStake({ result: 'home', scoreA: 0, scoreB: 0, scoreSet: false, goals: null, goalsLine: null, corners: null, cornersLine: null }), 30);
  assert.equal(xpAtStake({ result: 'home', scoreA: 2, scoreB: 1, scoreSet: true, goals: 'over', goalsLine: 2.5, corners: 'over', cornersLine: 9.5 }), 140);
  assert.equal(xpAtStake({ result: null, scoreA: 0, scoreB: 0, scoreSet: false, goals: null, goalsLine: null, corners: 'under', cornersLine: 9.5 }), 25);
});
