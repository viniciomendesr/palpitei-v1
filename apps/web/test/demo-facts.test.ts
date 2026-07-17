import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGES, MATCH_START, ROOM_SIZE, feedInit, fixtures } from '../src/lib/mock.ts';

const pt = {
  statusThirdPlace: 'SÁB · 18:00 BRT',
  stageThirdPlace: 'DISPUTA DE 3º · COPA 2026',
  tFranca: 'França',
  tInglaterra: 'Inglaterra',
  ctaRemind: 'Me lembra →',
  srcDemoFifa: 'DEMO · FATOS FIFA',
  statusFinal: 'DOM · 16:00 BRT',
  stageFinal: 'FINAL · COPA 2026',
  tEspanha: 'Espanha',
  tArgentina: 'Argentina',
  statusArgCab: 'ENCERRADO · 3 JUL',
  stageRound32: 'FASE DE 32 · COPA 2026',
  tCaboVerde: 'Cabo Verde',
  ctaReplay: 'Rever partida →',
} as never;

test('demo usa a agenda atual e o replay factual da Copa de 2026', () => {
  const cards = fixtures(pt);

  assert.deepEqual(cards.live, [], 'em 17/07 não há partida do Mundial marcada como ao vivo no demo');
  assert.deepEqual(
    cards.next.map(({ id, teamA, teamB, startTs }) => ({ id, teamA, teamB, startTs })),
    [
      { id: 'fra-eng', teamA: 'França', teamB: 'Inglaterra', startTs: Date.UTC(2026, 6, 18, 21, 0) },
      { id: 'esp-arg', teamA: 'Espanha', teamB: 'Argentina', startTs: Date.UTC(2026, 6, 19, 19, 0) },
    ],
  );
  assert.deepEqual(
    cards.replays.map(({ id, teamA, teamB, scoreA, scoreB }) => ({ id, teamA, teamB, scoreA, scoreB })),
    [{ id: 'arg-cab', teamA: 'Argentina', teamB: 'Cabo Verde', scoreA: 3, scoreB: 2 }],
  );
});

test('roteiro do replay respeita os gols oficiais de Argentina 3-2 Cabo Verde', () => {
  assert.deepEqual(MATCH_START, { minute: 64, scoreA: 1, scoreB: 1 });
  assert.deepEqual(feedInit().map((event) => event.t), ["59'", "29'"]);
  assert.deepEqual(
    CHALLENGES.map(({ correct, resolve }) => ({ correct, resolve })),
    [
      { correct: 'arg', resolve: { minute: 92, scoreA: 2, scoreB: 1 } },
      { correct: 'cab', resolve: { minute: 103, scoreA: 2, scoreB: 2 } },
      { correct: 'arg', resolve: { minute: 111, scoreA: 3, scoreB: 2 } },
      { correct: 'arg', resolve: { minute: 120, scoreA: 3, scoreB: 2, final: true } },
    ],
  );
  assert.equal(ROOM_SIZE, 1, 'o demo não inventa outros fãs no ranking da sala');
});

test('chances do replay são plausíveis, normalizadas e explicitamente locais ao demo', () => {
  for (const challenge of CHALLENGES) {
    assert.equal(Object.values(challenge.pct).every((pct) => pct !== null), true);
    assert.equal(Object.values(challenge.pct).reduce<number>((sum, pct) => sum + (pct ?? 0), 0), 100);
  }
});
