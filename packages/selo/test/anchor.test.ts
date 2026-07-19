import assert from 'node:assert/strict';
import test from 'node:test';

import { ANCHOR_PROGRAM_IDS, dailyScoresRootsSeeds, epochDayFrom } from '../src/anchor.ts';

test('the anchor day is UTC and is the same from kickoff to the end of the match', () => {
  const apito = Date.UTC(2026, 6, 18, 21, 0, 0);
  const fim = Date.UTC(2026, 6, 18, 23, 0, 0);
  assert.equal(epochDayFrom(apito), epochDayFrom(fim), 'the whole match falls on the same day');
  assert.equal(epochDayFrom(Date.UTC(1970, 0, 1)), 0);
  assert.equal(epochDayFrom(Date.UTC(1970, 0, 2)), 1);
});

test('the UTC day rollover does not use the local timezone', () => {
  const antes = Date.UTC(2026, 6, 18, 23, 59, 59);
  const depois = Date.UTC(2026, 6, 19, 0, 0, 0);
  assert.equal(epochDayFrom(depois) - epochDayFrom(antes), 1);
});

test('the day seed is a LITTLE-endian u16 — wrong endianness derives an empty account', () => {
  // 0x1234 = 4660: little-endian writes the low byte first.
  assert.deepEqual([...dailyScoresRootsSeeds(0x1234)[1]!], [0x34, 0x12]);
  assert.deepEqual([...dailyScoresRootsSeeds(0)[1]!], [0, 0]);
  assert.deepEqual([...dailyScoresRootsSeeds(0xffff)[1]!], [0xff, 0xff]);
});

test('the seed prefix is the literal daily_scores_roots', () => {
  const [prefixo] = dailyScoresRootsSeeds(20_651);
  assert.equal(new TextDecoder().decode(prefixo), 'daily_scores_roots');
});

test('an epoch day outside u16 range fails instead of deriving a wrong address', () => {
  assert.throws(() => dailyScoresRootsSeeds(-1), /u16/);
  assert.throws(() => dailyScoresRootsSeeds(0x10000), /u16/);
  assert.throws(() => epochDayFrom(Number.NaN), /inválido/);
});

test('devnet and mainnet have DIFFERENT validation programs', () => {
  assert.notEqual(ANCHOR_PROGRAM_IDS.devnet, ANCHOR_PROGRAM_IDS['mainnet-beta']);
  assert.equal(ANCHOR_PROGRAM_IDS.devnet, '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J');
});
