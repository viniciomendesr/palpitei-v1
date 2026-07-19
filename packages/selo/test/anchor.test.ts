import assert from 'node:assert/strict';
import test from 'node:test';

import { ANCHOR_PROGRAM_IDS, dailyScoresRootsSeeds, epochDayFrom } from '../src/anchor.ts';

test('o dia da âncora é UTC e é o mesmo do apito ao fim da partida', () => {
  const apito = Date.UTC(2026, 6, 18, 21, 0, 0);
  const fim = Date.UTC(2026, 6, 18, 23, 0, 0);
  assert.equal(epochDayFrom(apito), epochDayFrom(fim), 'a partida inteira cai no mesmo dia');
  assert.equal(epochDayFrom(Date.UTC(1970, 0, 1)), 0);
  assert.equal(epochDayFrom(Date.UTC(1970, 0, 2)), 1);
});

test('a virada do dia em UTC não usa o fuso local', () => {
  const antes = Date.UTC(2026, 6, 18, 23, 59, 59);
  const depois = Date.UTC(2026, 6, 19, 0, 0, 0);
  assert.equal(epochDayFrom(depois) - epochDayFrom(antes), 1);
});

test('o seed do dia é u16 LITTLE-endian — endianness errada deriva conta vazia', () => {
  // 0x1234 = 4660: little-endian escreve o byte baixo primeiro.
  assert.deepEqual([...dailyScoresRootsSeeds(0x1234)[1]!], [0x34, 0x12]);
  assert.deepEqual([...dailyScoresRootsSeeds(0)[1]!], [0, 0]);
  assert.deepEqual([...dailyScoresRootsSeeds(0xffff)[1]!], [0xff, 0xff]);
});

test('o prefixo do seed é daily_scores_roots literal', () => {
  const [prefixo] = dailyScoresRootsSeeds(20_651);
  assert.equal(new TextDecoder().decode(prefixo), 'daily_scores_roots');
});

test('epoch day fora do alcance de u16 falha em vez de derivar endereço errado', () => {
  assert.throws(() => dailyScoresRootsSeeds(-1), /u16/);
  assert.throws(() => dailyScoresRootsSeeds(0x10000), /u16/);
  assert.throws(() => epochDayFrom(Number.NaN), /inválido/);
});

test('devnet e mainnet têm programas de validação DIFERENTES', () => {
  assert.notEqual(ANCHOR_PROGRAM_IDS.devnet, ANCHOR_PROGRAM_IDS['mainnet-beta']);
  assert.equal(ANCHOR_PROGRAM_IDS.devnet, '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J');
});
