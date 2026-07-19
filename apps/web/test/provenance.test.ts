import assert from 'node:assert/strict';
import test from 'node:test';
import { isLive } from '../src/lib/provenance.ts';

test('only the declared live source counts as live', () => {
  assert.equal(isLive('txline-live'), true);
});

test('every recorded source is a replay — a lying label is G6', () => {
  // rooms.ts writes the DB `cacheSource` whenever the room is not live.
  for (const fonte of [
    'txline-updates',
    'txline-cache',
    'txline-historical',
    'txline-snapshot',
    'synthetic',
  ]) {
    assert.equal(isLive(fonte), false, `${fonte} is not live`);
  }
});

test('an unknown or absent source falls back to replay, never to live', () => {
  // `source` is a free-form DB string: "not a replay" must NEVER become "is live".
  assert.equal(isLive('txline'), false);
  assert.equal(isLive('fonte-que-ainda-nao-existe'), false);
  assert.equal(isLive(''), false);
  assert.equal(isLive(undefined), false);
  assert.equal(isLive(null), false);
});
