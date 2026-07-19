/** Tests the SSE heartbeat timer without HTTP or a Privy bearer. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PULSO, PULSO_MS, iniciarPulso } from '../src/server/pulso.ts';

test('the pulso is a real SSE comment: it starts with ":" and closes the packet', () => {
  // A `:` line is an SSE comment: it keeps the connection alive without firing `onmessage`.
  assert.ok(PULSO.startsWith(':'));
  assert.ok(PULSO.endsWith('\n\n'));
  // A newline would create a second SSE field instead of one comment.
  assert.equal(PULSO.indexOf('\n'), PULSO.length - 2);
});

test('it beats every interval and stops when told to stop', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let batidas = 0;
  const parar = iniciarPulso(() => {
    batidas += 1;
  }, PULSO_MS);

  t.mock.timers.tick(PULSO_MS - 1);
  assert.equal(batidas, 0, 'it must not speak before its time');
  t.mock.timers.tick(1);
  assert.equal(batidas, 1);
  t.mock.timers.tick(PULSO_MS * 2);
  assert.equal(batidas, 3);

  parar();
  t.mock.timers.tick(PULSO_MS * 5);
  assert.equal(batidas, 3, 'after stopping, silence');
});

test('an enqueue on a dead connection (a sender that throws) does not take the timer down', (t) => {
  // A closed controller can throw; the timer must absorb it and clean up safely.
  t.mock.timers.enable({ apis: ['setInterval'] });
  let chamadas = 0;
  const parar = iniciarPulso(() => {
    chamadas += 1;
    throw new Error('conexão fechada');
  }, PULSO_MS);

  t.mock.timers.tick(PULSO_MS * 2);
  assert.equal(chamadas, 2, 'an exception in one pulso does not cancel the next');
  parar();
});
