import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupLegs } from '../src/lib/legs.ts';

const fx = (id: string, teamA: string, teamB: string, startTs: number | undefined) => ({
  id,
  teamA,
  teamB,
  startTs,
});

// Measured 2026-07-20 on the devnet snapshot: the friendlies calendar carries two
// legs of the same pair days apart.
const AUS_BRA_1 = fx('18182808', 'Austrália', 'Brasil', 3);
const AUS_BRA_2 = fx('18182864', 'Austrália', 'Brasil', 7);
const AZE_TJK = fx('18272873', 'Azerbaijan', 'Tajikistan', 1);

test('as duas pernas do mesmo confronto viram um card só', () => {
  const grupos = groupLegs([AZE_TJK, AUS_BRA_1, AUS_BRA_2]);

  assert.equal(grupos.length, 2, 'três fixtures, dois confrontos');
  assert.deepEqual(grupos[0]!.lead, AZE_TJK);
  assert.deepEqual(grupos[0]!.rest, []);
  assert.deepEqual(grupos[1]!.lead, AUS_BRA_1, 'a perna mais próxima lidera o card');
  assert.deepEqual(grupos[1]!.rest, [AUS_BRA_2]);
});

test('nenhuma partida é descartada: toda fixture continua na saída', () => {
  const entrada = [AZE_TJK, AUS_BRA_1, AUS_BRA_2];
  const grupos = groupLegs(entrada);
  const ids = grupos.flatMap((g) => [g.lead, ...g.rest]).map((f) => f.id).sort();

  // Agrupar é apresentação, não filtro. Esconder uma partida real seria dado
  // faltando numa tela pública.
  assert.deepEqual(ids, entrada.map((f) => f.id).sort());
});

test('mandante invertido é o mesmo confronto', () => {
  const grupos = groupLegs([AUS_BRA_1, fx('x', 'Brasil', 'Austrália', 9)]);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0]!.rest.length, 1);
});

test('a ordem de chegada dos confrontos é preservada', () => {
  const grupos = groupLegs([AUS_BRA_1, AZE_TJK, AUS_BRA_2]);
  assert.deepEqual(
    grupos.map((g) => g.lead.id),
    ['18182808', '18272873'],
  );
});

test('sem horário conhecido, a fixture não é promovida na frente de quem tem', () => {
  const semData = fx('sem', 'Austrália', 'Brasil', undefined);
  const grupos = groupLegs([semData, AUS_BRA_1]);
  assert.equal(grupos[0]!.lead.id, '18182808', 'quem tem data lidera');
  assert.equal(grupos[0]!.rest[0]!.id, 'sem');
});
