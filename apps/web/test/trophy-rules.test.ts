import test from 'node:test';
import assert from 'node:assert/strict';

import { canAwardDebutTrophy } from '../src/server/trophy-rules.ts';

const FA = 'did:privy:cmxyz';

test('a live sala, counting for XP, grants the debut trophy', () => {
  assert.equal(canAwardDebutTrophy({ roomMode: 'live', training: false, privyDid: FA }), true);
});

test('a replay does NOT grant a trophy — "has events" is not "is live"', () => {
  // 18241006 has 962 recorded events and is exactly the trap: any rule of the form
  // "this fixture has events" would reward whoever opens the Replays tab.
  assert.equal(canAwardDebutTrophy({ roomMode: 'replay', training: false, privyDid: FA }), false);
});

test('a sala for an already finished match does NOT grant a trophy', () => {
  // 18257865 was live on 18/07 and today is `finished`: judging by the current state
  // answers wrong in both directions, so the decision is made at the palpite.
  assert.equal(canAwardDebutTrophy({ roomMode: 'finished', training: false, privyDid: FA }), false);
});

test('treino does NOT grant a trophy even when live', () => {
  assert.equal(canAwardDebutTrophy({ roomMode: 'live', training: true, privyDid: FA }), false);
});

test('a demo account does NOT grant a trophy', () => {
  assert.equal(canAwardDebutTrophy({ roomMode: 'live', training: false, privyDid: 'demo:abc' }), false);
});

test('an absent did does NOT grant a trophy — absent is not authorized', () => {
  assert.equal(canAwardDebutTrophy({ roomMode: 'live', training: false, privyDid: undefined }), false);
});
