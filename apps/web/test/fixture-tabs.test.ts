import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyFixture, bucketFixtures } from '../src/lib/fixture-tabs.ts';
import type { ApiFixture } from '../src/lib/api.ts';

const NOW = Date.UTC(2026, 6, 27, 12, 0);
const DIA = 86_400_000;

const fx = (over: Partial<ApiFixture> = {}): ApiFixture => ({
  id: '1',
  live: false,
  status: 'AGENDADA',
  group: 'FRIENDLIES',
  teamA: 'A',
  teamB: 'B',
  scoreA: null,
  scoreB: null,
  startTime: null,
  source: 'txline',
  ...over,
});

test('partida futura do snapshot vai para "próximos"', () => {
  assert.deepEqual(classifyFixture(fx({ startTime: NOW + DIA }), NOW), {
    tab: 'next',
    naoGravada: false,
  });
});

test('partida ao vivo vai para "ao vivo", mesmo com horário no passado', () => {
  assert.equal(classifyFixture(fx({ live: true, startTime: NOW - 1000 }), NOW).tab, 'live');
});

test('partida gravada (fonte de cache) vai para replays, sem aviso', () => {
  assert.deepEqual(classifyFixture(fx({ source: 'txline-live', startTime: NOW - DIA }), NOW), {
    tab: 'replays',
    naoGravada: false,
  });
});

test('partida passada que só existe no snapshot vira replay marcada como NÃO gravada', () => {
  // Ninguém acompanhou ao vivo, então nunca virou timeline. O tempo decide, não a fonte.
  assert.deepEqual(classifyFixture(fx({ source: 'txline', startTime: NOW - DIA }), NOW), {
    tab: 'replays',
    naoGravada: true,
  });
});

test('snapshot sem horário fica em "próximos" — não dá para afirmar que já passou', () => {
  assert.equal(classifyFixture(fx({ startTime: null }), NOW).tab, 'next');
});

test('a cópia do snapshot some quando a mesma partida já foi gravada', () => {
  const abas = bucketFixtures(
    [
      fx({ id: '9', source: 'txline', startTime: NOW - DIA }),
      fx({ id: '9', source: 'txline-live', startTime: NOW - DIA }),
    ],
    NOW,
  );
  assert.equal(abas.replays.length, 1);
  assert.equal(abas.replays[0]?.naoGravada, false);
});

test('bucket separa as três abas e carrega o aviso de não gravada', () => {
  const abas = bucketFixtures(
    [
      fx({ id: 'a', startTime: NOW + DIA }),
      fx({ id: 'b', live: true }),
      fx({ id: 'c', source: 'txline-updates', startTime: NOW - DIA }),
      fx({ id: 'd', source: 'txline', startTime: NOW - DIA }),
    ],
    NOW,
  );
  assert.deepEqual(abas.next.map((f) => f.id), ['a']);
  assert.deepEqual(abas.live.map((f) => f.id), ['b']);
  assert.deepEqual(abas.replays.map((f) => f.id).sort(), ['c', 'd']);
  assert.equal(abas.replays.find((f) => f.id === 'd')?.naoGravada, true);
  assert.equal(abas.replays.find((f) => f.id === 'c')?.naoGravada, false);
});
