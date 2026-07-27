import assert from 'node:assert/strict';
import test from 'node:test';

import { formatKickoff } from '../src/lib/kickoff.ts';

const local = (y: number, m: number, d: number, h = 0, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime();

const AGORA = local(2026, 7, 20, 12, 0);

test('o card mostra a data com ano de cada perna, e as duas ficam diferentes', () => {
  // Australia x Brazil, as duas pernas do snapshot medido em 20/07.
  assert.equal(formatKickoff(local(2026, 9, 25, 12, 0), AGORA, 'pt', 'label'), '25/09/2026');
  assert.equal(formatKickoff(local(2026, 9, 29, 12, 0), AGORA, 'pt', 'label'), '29/09/2026');
  assert.equal(formatKickoff(local(2026, 9, 25, 12, 0), AGORA, 'en', 'label'), 'SEP 25, 2026');
  assert.equal(formatKickoff(local(2026, 9, 29, 12, 0), AGORA, 'en', 'label'), 'SEP 29, 2026');
});

test('o ano do mesmo ano também aparece — a torcida pediu para não parecer partida velha', () => {
  assert.equal(formatKickoff(local(2026, 10, 5, 18, 45), AGORA, 'pt', 'label'), '05/10/2026');
  assert.equal(formatKickoff(local(2026, 10, 5, 18, 45), AGORA, 'en', 'label'), 'OCT 5, 2026');
});

test('a perna anexada de um par (withYear=false) não repete o ano do card', () => {
  assert.equal(formatKickoff(local(2026, 9, 29, 12, 0), AGORA, 'pt', 'label', false), '29/09');
  assert.equal(formatKickoff(local(2026, 9, 29, 12, 0), AGORA, 'en', 'label', false), 'SEP 29');
});

test('hoje e amanhã ganham palavra em vez de data, e nunca ano', () => {
  assert.equal(formatKickoff(local(2026, 7, 20, 19, 0), AGORA, 'pt', 'label'), 'HOJE');
  assert.equal(formatKickoff(local(2026, 7, 21, 16, 0), AGORA, 'pt', 'label'), 'AMANHÃ');
  assert.equal(formatKickoff(local(2026, 7, 20, 19, 0), AGORA, 'en', 'label'), 'TODAY');
  assert.equal(formatKickoff(local(2026, 7, 21, 16, 0), AGORA, 'en', 'label'), 'TOMORROW');
});

test('o estilo de frase do pré-palpite não carrega hora — só a data com ano', () => {
  assert.equal(formatKickoff(local(2026, 7, 20, 19, 0), AGORA, 'pt'), 'Hoje');
  assert.equal(formatKickoff(local(2026, 10, 5, 18, 45), AGORA, 'pt'), '05/10/2026');
  assert.equal(formatKickoff(local(2026, 10, 5, 18, 45), AGORA, 'en'), 'Oct 5, 2026');
});

test('em inglês o mês vem por nome — 05/10 seria lido como 10 de maio', () => {
  const rotulo = formatKickoff(local(2026, 10, 5, 18, 45), AGORA, 'en', 'label');
  assert.equal(rotulo, 'OCT 5, 2026');
  assert.ok(!rotulo.includes('/'));
});

test('outro ano aparece no rótulo, para não mentir a data', () => {
  assert.equal(formatKickoff(local(2027, 3, 4, 9, 0), AGORA, 'pt', 'label'), '04/03/2027');
  assert.equal(formatKickoff(local(2027, 3, 4, 9, 0), AGORA, 'en', 'label'), 'MAR 4, 2027');
});

test('partida de hoje que já começou segue "hoje"; a de ontem mostra a data real com ano', () => {
  assert.equal(formatKickoff(local(2026, 7, 20, 9, 0), AGORA, 'pt', 'label'), 'HOJE');
  assert.equal(formatKickoff(local(2026, 7, 19, 9, 0), AGORA, 'pt', 'label'), '19/07/2026');
});
