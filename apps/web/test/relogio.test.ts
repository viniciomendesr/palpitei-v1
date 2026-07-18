import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formataRelogio, limitarSegundoDoReplay, minutoDoReplay, segundoDoReplay } from '../src/lib/relogio.ts';

// The latest feed event anchors the clock; wall time only fills the interval to
// the next event, which establishes a new anchor.

test('interpola o minuto entre eventos pela velocidade do replay', () => {
  const t0 = 1_000_000;
  // Kickoff anchor at 12× replay speed: 5 real seconds equal one match minute.
  assert.equal(minutoDoReplay(0, t0, 12, t0), 0);
  assert.equal(minutoDoReplay(0, t0, 12, t0 + 5_000), 1);
  assert.equal(minutoDoReplay(0, t0, 12, t0 + 30_000), 6);
  // Mid-match anchor: 10 real seconds at 12× advances 34' to 36'.
  assert.equal(minutoDoReplay(2_040, t0, 12, t0 + 10_000), 36);
});

test('ao vivo (1×) o minuto anda em tempo real', () => {
  const t0 = 5_000_000;
  assert.equal(minutoDoReplay(600, t0, 1, t0 + 59_000), 10);
  assert.equal(minutoDoReplay(600, t0, 1, t0 + 60_000), 11);
});

test('relógio de parede atrasado nunca REGRIDE o minuto da âncora', () => {
  const t0 = 2_000_000;
  // A clock-skewed timestamp must not move before the anchor.
  assert.equal(minutoDoReplay(360, t0, 12, t0 - 10_000), 6);
});

test('segundoDoReplay conta os segundos DE JOGO desde a âncora', () => {
  const t0 = 3_000_000;
  // At 12×, one real second equals 12 match seconds.
  assert.equal(segundoDoReplay(0, t0, 12, t0), 0);
  assert.equal(segundoDoReplay(0, t0, 12, t0 + 1_000), 12);
  assert.equal(segundoDoReplay(0, t0, 12, t0 + 250), 3);
  // A six-minute anchor starts at 360 seconds and never regresses.
  assert.equal(segundoDoReplay(360, t0, 12, t0 + 500), 366);
  assert.equal(segundoDoReplay(360, t0, 12, t0 - 5_000), 360);
  // Live mode (1×) follows wall-clock speed.
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
