/** Tests the SSE heartbeat timer without HTTP or a Privy bearer. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PULSO, PULSO_MS, iniciarPulso } from '../src/server/pulso.ts';

test('o pulso é comentário SSE de verdade: começa em ":" e fecha o pacote', () => {
  // A `:` line is an SSE comment: it keeps the connection alive without firing `onmessage`.
  assert.ok(PULSO.startsWith(':'));
  assert.ok(PULSO.endsWith('\n\n'));
  // A newline would create a second SSE field instead of one comment.
  assert.equal(PULSO.indexOf('\n'), PULSO.length - 2);
});

test('bate a cada intervalo e para quando mandam parar', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let batidas = 0;
  const parar = iniciarPulso(() => {
    batidas += 1;
  }, PULSO_MS);

  t.mock.timers.tick(PULSO_MS - 1);
  assert.equal(batidas, 0, 'não pode falar antes da hora');
  t.mock.timers.tick(1);
  assert.equal(batidas, 1);
  t.mock.timers.tick(PULSO_MS * 2);
  assert.equal(batidas, 3);

  parar();
  t.mock.timers.tick(PULSO_MS * 5);
  assert.equal(batidas, 3, 'depois de parar, silêncio');
});

test('enqueue em conexão morta (enviar que lança) não derruba o timer', (t) => {
  // A closed controller can throw; the timer must absorb it and clean up safely.
  t.mock.timers.enable({ apis: ['setInterval'] });
  let chamadas = 0;
  const parar = iniciarPulso(() => {
    chamadas += 1;
    throw new Error('conexão fechada');
  }, PULSO_MS);

  t.mock.timers.tick(PULSO_MS * 2);
  assert.equal(chamadas, 2, 'a exceção de um pulso não cancela o seguinte');
  parar();
});
