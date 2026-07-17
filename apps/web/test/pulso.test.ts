/**
 * O pulso do SSE, provado sem HTTP — porque o /stream de verdade exige Bearer
 * verificado da Privy e não há como forjar um num teste. O que dá para provar
 * aqui é o contrato inteiro do timer: formato do comentário, cadência, parada
 * e o assinante morto que não derruba o processo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PULSO, PULSO_MS, iniciarPulso } from '../src/server/pulso.ts';

test('o pulso é comentário SSE de verdade: começa em ":" e fecha o pacote', () => {
  // Linha que começa com ":" é comentário no protocolo — atravessa o proxy,
  // mantém a conexão viva e NÃO dispara onmessage no browser.
  assert.ok(PULSO.startsWith(':'));
  assert.ok(PULSO.endsWith('\n\n'));
  // Uma linha só: um "\n" no meio viraria dois campos e o segundo não seria
  // comentário.
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
  // O route handler chama controller.enqueue direto; numa conexão já fechada
  // isso LANÇA. Dentro de setInterval, exceção não tratada mata o processo do
  // servidor — a sala inteira, de todo mundo. O pulso engole e o abort limpa.
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
