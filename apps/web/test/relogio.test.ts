import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutoDoReplay } from '../src/lib/relogio.ts';

// A âncora é o ÚLTIMO evento do feed (B2): o relógio de parede só preenche o
// intervalo até o próximo lance, que re-ancora tudo. Nunca o contrário.

test('interpola o minuto entre eventos pela velocidade do replay', () => {
  const t0 = 1_000_000;
  // âncora no kickoff (0s de jogo), replay a 12×: 5s reais = 1 min de jogo
  assert.equal(minutoDoReplay(0, t0, 12, t0), 0);
  assert.equal(minutoDoReplay(0, t0, 12, t0 + 5_000), 1);
  assert.equal(minutoDoReplay(0, t0, 12, t0 + 30_000), 6);
  // âncora no meio do jogo (34 min = 2040s), 10s reais depois a 12× → 36'
  assert.equal(minutoDoReplay(2_040, t0, 12, t0 + 10_000), 36);
});

test('ao vivo (1×) o minuto anda em tempo real', () => {
  const t0 = 5_000_000;
  assert.equal(minutoDoReplay(600, t0, 1, t0 + 59_000), 10);
  assert.equal(minutoDoReplay(600, t0, 1, t0 + 60_000), 11);
});

test('relógio de parede atrasado nunca REGRIDE o minuto da âncora', () => {
  const t0 = 2_000_000;
  // agora < âncora (clock skew, aba que dormiu): fica no minuto da âncora
  assert.equal(minutoDoReplay(360, t0, 12, t0 - 10_000), 6);
});
