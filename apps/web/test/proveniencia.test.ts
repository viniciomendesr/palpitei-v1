import assert from 'node:assert/strict';
import test from 'node:test';
import { ehAoVivo } from '../src/lib/proveniencia.ts';

test('só a fonte ao vivo declarada conta como ao vivo', () => {
  assert.equal(ehAoVivo('txline-live'), true);
});

test('toda fonte gravada é replay — rótulo que mente é o G6', () => {
  // rooms.ts writes the DB `cacheSource` whenever the room is not live.
  for (const fonte of [
    'txline-updates',
    'txline-cache',
    'txline-historical',
    'txline-snapshot',
    'synthetic',
  ]) {
    assert.equal(ehAoVivo(fonte), false, `${fonte} não é ao vivo`);
  }
});

test('fonte desconhecida ou ausente cai em replay, nunca em ao vivo', () => {
  // `source` is a free-form DB string: "not a replay" must NEVER become "is live".
  assert.equal(ehAoVivo('txline'), false);
  assert.equal(ehAoVivo('fonte-que-ainda-nao-existe'), false);
  assert.equal(ehAoVivo(''), false);
  assert.equal(ehAoVivo(undefined), false);
  assert.equal(ehAoVivo(null), false);
});
