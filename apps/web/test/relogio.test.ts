import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formataRelogio, limitarSegundoDoReplay, minutoDoReplay, segundoDoReplay } from '../src/lib/relogio.ts';

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

test('segundoDoReplay conta os segundos DE JOGO desde a âncora', () => {
  const t0 = 3_000_000;
  // 12×: 1s real = 12s de jogo
  assert.equal(segundoDoReplay(0, t0, 12, t0), 0);
  assert.equal(segundoDoReplay(0, t0, 12, t0 + 1_000), 12);
  assert.equal(segundoDoReplay(0, t0, 12, t0 + 250), 3);
  // âncora aos 6 min: parte de 360, nunca regride
  assert.equal(segundoDoReplay(360, t0, 12, t0 + 500), 366);
  assert.equal(segundoDoReplay(360, t0, 12, t0 - 5_000), 360);
  // ao vivo (1×) é o relógio de verdade
  assert.equal(segundoDoReplay(600, t0, 1, t0 + 32_000), 632);
});

test('formataRelogio escreve MM:SS como cronômetro de partida', () => {
  assert.equal(formataRelogio(0), '00:00');
  assert.equal(formataRelogio(392), '06:32');
  assert.equal(formataRelogio(5_407), '90:07');
});

test('relógio interpolado não passa do último segundo real da TxLINE', () => {
  assert.equal(limitarSegundoDoReplay(6_245, 6_103), 6_103);
  assert.equal(limitarSegundoDoReplay(5_900, 6_103), 5_900);
  assert.equal(limitarSegundoDoReplay(6_245, null), 6_245);
});
