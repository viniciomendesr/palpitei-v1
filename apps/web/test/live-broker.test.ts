import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OddsEvent, ScoreEvent } from '@palpitei/core';
import {
  compactarEventoParaBroker,
  eventoDoBroker,
  redisDoLiveHabilitado,
} from '../src/server/live-broker.ts';

test('broker transmite somente o evento normalizado, sem payload cru TxLINE', () => {
  const score: ScoreEvent = {
    kind: 'score',
    fixtureId: 18257865,
    seq: 14,
    ts: 1_000,
    action: 'goal',
    hasScore: true,
    goals: { p1: 1, p2: 0 },
    corners: { p1: 2, p2: 1 },
    totals: { p1: { Goals: 1, Corners: 2 }, p2: { Goals: 0, Corners: 1 } },
    data: { licensedDetail: 'não deve sair do processo líder' },
    raw: { payload: 'TxLINE cru' },
  };

  const compact = compactarEventoParaBroker(score);
  assert.equal('raw' in compact, false);
  assert.equal('data' in compact, false);
  const restored = eventoDoBroker(compact);
  assert.deepEqual(restored && {
    kind: restored.kind,
    fixtureId: restored.fixtureId,
    seq: restored.kind === 'score' ? restored.seq : undefined,
    ts: restored.ts,
    action: restored.kind === 'score' ? restored.action : undefined,
    hasScore: restored.kind === 'score' ? restored.hasScore : undefined,
    goals: restored.kind === 'score' ? restored.goals : undefined,
    corners: restored.kind === 'score' ? restored.corners : undefined,
    totals: restored.kind === 'score' ? restored.totals : undefined,
  }, {
    kind: 'score',
    fixtureId: 18257865,
    seq: 14,
    ts: 1_000,
    action: 'goal',
    hasScore: true,
    goals: { p1: 1, p2: 0 },
    corners: { p1: 2, p2: 1 },
    totals: { p1: { Goals: 1, Corners: 2 }, p2: { Goals: 0, Corners: 1 } },
  });
  assert.equal(restored?.raw, null);
  assert.equal('data' in (restored ?? {}), false);
});

test('broker preserva odds normalizadas e rejeita envelopes incompletos', () => {
  const odds: OddsEvent = {
    kind: 'odds',
    fixtureId: 18257865,
    ts: 2_000,
    messageId: 'm:7',
    marketType: '1X2_PARTICIPANT_RESULT',
    prices: [{ name: 'p1', odds: 2.1, pct: 47.6 }],
    raw: { licensed: true },
  };
  assert.deepEqual(eventoDoBroker(compactarEventoParaBroker(odds)), { ...odds, raw: null });
  assert.equal(eventoDoBroker({ kind: 'score', fixtureId: 1 }), null);
  assert.equal(eventoDoBroker({ kind: 'odds', fixtureId: 1, ts: 0, marketType: '1X2', prices: [{}] }), null);
});

test('Redis é opt-in: uma URL presente liga o modo distribuído', () => {
  assert.equal(redisDoLiveHabilitado({}), false);
  assert.equal(redisDoLiveHabilitado({ REDIS_URL: '  ' }), false);
  assert.equal(redisDoLiveHabilitado({ REDIS_URL: 'redis://redis.railway.internal:6379' }), true);
});
