/** Tests the pure SSE reconnection schedule independently of React and EventSource. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECONEXAO_BASE_MS,
  RECONEXAO_TETO_MS,
  esperaDeReconexao,
} from '../src/lib/reconexao.ts';

test('dobra a cada tentativa e bate no teto', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map(esperaDeReconexao),
    [1_000, 2_000, 4_000, 8_000, 15_000, 15_000],
  );
});

test('a primeira tentativa é rápida — queda num lance quente não pode custar minutos', () => {
  assert.equal(esperaDeReconexao(0), RECONEXAO_BASE_MS);
  assert.ok(RECONEXAO_BASE_MS <= 1_000);
});

test('tentativa absurda não estoura o número nem passa do teto', () => {
  // `2 ** 1e9` is Infinity, so the exponent must be capped before calculation.
  assert.equal(esperaDeReconexao(1_000_000_000), RECONEXAO_TETO_MS);
  assert.equal(esperaDeReconexao(Number.MAX_SAFE_INTEGER), RECONEXAO_TETO_MS);
});

test('tentativa negativa (não deveria existir) cai no chão, não em fração', () => {
  assert.equal(esperaDeReconexao(-3), RECONEXAO_BASE_MS);
});
