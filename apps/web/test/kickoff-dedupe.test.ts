import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ScoreEvent } from '@palpitei/core';
import { criarDedupeDeKickoff } from '../src/server/lances.ts';

// O feed manda o kickoff EM PAR (medido na 18241006: seq 15 e 17, Δ2,8s; o 2º
// tempo idem, seq 428/430). A 12× o guard de janela mínima do motor ignora o
// segundo; a 1× (ao vivo) o guard autoriza fechamento imediato e o par fecharia
// a final_result ~3s depois de abrir. O dedupe usa a MESMA régua do feed de
// lances (`${action}:${clockSeconds ?? ts}`) — a regra tem um dono só.

const score = (over: Partial<ScoreEvent> = {}): ScoreEvent => ({
  kind: 'score',
  fixtureId: 18257865,
  seq: 1,
  ts: 1_000,
  action: 'kickoff',
  hasScore: false,
  goals: { p1: 0, p2: 0 },
  corners: { p1: 0, p2: 0 },
  raw: {},
  ...over,
});

test('o segundo kickoff do par (mesmo clock) é duplicata; o primeiro não', () => {
  const ehDuplicata = criarDedupeDeKickoff();
  assert.equal(ehDuplicata(score({ seq: 15, clockSeconds: 0 })), false);
  assert.equal(ehDuplicata(score({ seq: 17, ts: 3_834, clockSeconds: 0 })), true);
});

test('o kickoff do 2º tempo (clock diferente) passa', () => {
  const ehDuplicata = criarDedupeDeKickoff();
  assert.equal(ehDuplicata(score({ seq: 15, clockSeconds: 0 })), false);
  assert.equal(ehDuplicata(score({ seq: 428, clockSeconds: 2_700 })), false);
});

test('quem não é kickoff nunca é marcado, nem repetido no mesmo clock', () => {
  const ehDuplicata = criarDedupeDeKickoff();
  assert.equal(ehDuplicata(score({ action: 'corner', clockSeconds: 60 })), false);
  assert.equal(ehDuplicata(score({ action: 'corner', clockSeconds: 60 })), false);
});

test('kickoff sem clockSeconds cai para o ts como régua', () => {
  const ehDuplicata = criarDedupeDeKickoff();
  assert.equal(ehDuplicata(score({ ts: 5_000 })), false);
  assert.equal(ehDuplicata(score({ ts: 5_000 })), true);
  assert.equal(ehDuplicata(score({ ts: 9_000 })), false);
});
