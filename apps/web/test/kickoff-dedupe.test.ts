import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ScoreEvent } from '@palpitei/core';
import { createKickoffDeduper } from '../src/server/lances.ts';

// The feed can emit duplicate kickoff events. Deduplication uses the same
// `${action}:${clockSeconds ?? ts}` key as score events so the rule has one owner.

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

test('the second kickoff of the pair (same clock) is a duplicate; the first is not', () => {
  const ehDuplicata = createKickoffDeduper();
  assert.equal(ehDuplicata(score({ seq: 15, clockSeconds: 0 })), false);
  assert.equal(ehDuplicata(score({ seq: 17, ts: 3_834, clockSeconds: 0 })), true);
});

test('the second-half kickoff (different clock) passes through', () => {
  const ehDuplicata = createKickoffDeduper();
  assert.equal(ehDuplicata(score({ seq: 15, clockSeconds: 0 })), false);
  assert.equal(ehDuplicata(score({ seq: 428, clockSeconds: 2_700 })), false);
});

test('non-kickoff events are never marked, not even repeated on the same clock', () => {
  const ehDuplicata = createKickoffDeduper();
  assert.equal(ehDuplicata(score({ action: 'corner', clockSeconds: 60 })), false);
  assert.equal(ehDuplicata(score({ action: 'corner', clockSeconds: 60 })), false);
});

test('a kickoff with no clockSeconds falls back to ts as the ruler', () => {
  const ehDuplicata = createKickoffDeduper();
  assert.equal(ehDuplicata(score({ ts: 5_000 })), false);
  assert.equal(ehDuplicata(score({ ts: 5_000 })), true);
  assert.equal(ehDuplicata(score({ ts: 9_000 })), false);
});
