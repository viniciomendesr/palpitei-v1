/** Tests the pure SSE reconnection schedule independently of React and EventSource. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECONEXAO_BASE_MS,
  RECONEXAO_TETO_MS,
  esperaDeReconexao,
} from '../src/lib/reconexao.ts';

test('it doubles on each attempt and hits the ceiling', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map(esperaDeReconexao),
    [1_000, 2_000, 4_000, 8_000, 15_000, 15_000],
  );
});

test('the first attempt is fast — a drop during a hot play must not cost minutes', () => {
  assert.equal(esperaDeReconexao(0), RECONEXAO_BASE_MS);
  assert.ok(RECONEXAO_BASE_MS <= 1_000);
});

test('an absurd attempt neither blows up the number nor exceeds the ceiling', () => {
  // `2 ** 1e9` is Infinity, so the exponent must be capped before calculation.
  assert.equal(esperaDeReconexao(1_000_000_000), RECONEXAO_TETO_MS);
  assert.equal(esperaDeReconexao(Number.MAX_SAFE_INTEGER), RECONEXAO_TETO_MS);
});

test('a negative attempt (which should not exist) falls to the floor, not to a fraction', () => {
  assert.equal(esperaDeReconexao(-3), RECONEXAO_BASE_MS);
});
