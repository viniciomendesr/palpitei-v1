import assert from 'node:assert/strict';
import test from 'node:test';

import { formatKickoff } from '../src/lib/kickoff.ts';

const local = (y: number, m: number, d: number, h = 0, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime();

const AGORA = local(2026, 7, 20, 12, 0);

test('o card mostra dia e hora de cada perna, e as duas ficam diferentes', () => {
  // Australia x Brazil, as duas pernas do snapshot medido em 20/07.
  assert.equal(formatKickoff(local(2026, 9, 25, 12, 0), AGORA, 'pt', 'label'), '25/09');
  assert.equal(formatKickoff(local(2026, 9, 29, 12, 0), AGORA, 'pt', 'label'), '29/09');
  assert.equal(formatKickoff(local(2026, 9, 25, 12, 0), AGORA, 'en', 'label'), 'SEP 25');
  assert.equal(formatKickoff(local(2026, 9, 29, 12, 0), AGORA, 'en', 'label'), 'SEP 29');
});

test('hoje e amanhã ganham palavra em vez de data', () => {
  assert.equal(formatKickoff(local(2026, 7, 20, 19, 0), AGORA, 'pt', 'label'), 'HOJE');
  assert.equal(formatKickoff(local(2026, 7, 21, 16, 0), AGORA, 'pt', 'label'), 'AMANHÃ');
  assert.equal(formatKickoff(local(2026, 7, 20, 19, 0), AGORA, 'en', 'label'), 'TODAY');
  assert.equal(formatKickoff(local(2026, 7, 21, 16, 0), AGORA, 'en', 'label'), 'TOMORROW');
});

test('o estilo de frase é o do pré-palpite, com vírgula', () => {
  assert.equal(formatKickoff(local(2026, 7, 20, 19, 0), AGORA, 'pt'), 'Hoje, 19:00');
  assert.equal(formatKickoff(local(2026, 10, 5, 18, 45), AGORA, 'pt'), '05/10, 18:45');
  assert.equal(formatKickoff(local(2026, 10, 5, 18, 45), AGORA, 'en'), 'Oct 5, 18:45');
});

test('em inglês o mês vem por nome — 05/10 seria lido como 10 de maio', () => {
  const rotulo = formatKickoff(local(2026, 10, 5, 18, 45), AGORA, 'en', 'label');
  assert.equal(rotulo, 'OCT 5');
  assert.ok(!rotulo.includes('/'));
});

test('outro ano aparece no rótulo, para não mentir a data', () => {
  assert.equal(formatKickoff(local(2027, 3, 4, 9, 0), AGORA, 'pt', 'label'), '04/03/2027');
  assert.equal(formatKickoff(local(2027, 3, 4, 9, 0), AGORA, 'en', 'label'), 'MAR 4, 2027');
});

test('partida de hoje que já começou segue "hoje"; a de ontem mostra a data real', () => {
  assert.equal(formatKickoff(local(2026, 7, 20, 9, 0), AGORA, 'pt', 'label'), 'HOJE');
  assert.equal(formatKickoff(local(2026, 7, 19, 9, 0), AGORA, 'pt', 'label'), '19/07');
});
