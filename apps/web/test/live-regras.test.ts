import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OddsEvent, ScoreEvent } from '@palpitei/core';
import { MERCADO_1X2 } from '@palpitei/db';
import {
  classificarParaSala,
  eventoEncerraPartida,
  fixtureAoVivo,
  channelsToClose,
  fixturesAoVivo,
  ingestAoVivoHabilitado,
  podeAtivarFixtureAoVivo,
} from '../src/server/live-regras.ts';

const score = (over: Partial<ScoreEvent> = {}): ScoreEvent => ({
  kind: 'score',
  fixtureId: 18257865,
  seq: 1,
  ts: 1_000,
  action: 'corner',
  hasScore: false,
  goals: { p1: 0, p2: 0 },
  corners: { p1: 0, p2: 0 },
  raw: {},
  ...over,
});

const odds = (over: Partial<OddsEvent> = {}): OddsEvent => ({
  kind: 'odds',
  fixtureId: 18257865,
  ts: 1_000,
  marketType: MERCADO_1X2,
  prices: [],
  raw: {},
  ...over,
});

// ─── Third gate: a literal `true` value with an explicit fixture ───
// The application gate is opt-in: a missing value leaves ingest disabled.

test('fixtureAoVivo: only turns on with a literal TXLINE_LIVE_INGEST="true" AND a numeric fixture', () => {
  assert.equal(
    fixtureAoVivo({ TXLINE_LIVE_INGEST: 'true', LIVE_FIXTURE_ID: '18257865' }),
    18257865,
  );
});

test('fixtureAoVivo: a missing env is OFF (the opposite of the package getter)', () => {
  assert.equal(fixtureAoVivo({ LIVE_FIXTURE_ID: '18257865' }), null);
  assert.equal(fixtureAoVivo({}), null);
});

test('the lock allows dynamic selection from the database without reopening the unsafe default', () => {
  assert.equal(ingestAoVivoHabilitado({ TXLINE_LIVE_INGEST: 'true' }), true);
  assert.equal(fixturesAoVivo({ TXLINE_LIVE_INGEST: 'true' }).length, 0, 'the env may carry no IDs when the database is the registry');
  assert.equal(ingestAoVivoHabilitado({}), false);
});

test('fixtureAoVivo: "false", "1" or a non-numeric fixture turn on nothing', () => {
  assert.equal(fixtureAoVivo({ TXLINE_LIVE_INGEST: 'false', LIVE_FIXTURE_ID: '18257865' }), null);
  assert.equal(fixtureAoVivo({ TXLINE_LIVE_INGEST: '1', LIVE_FIXTURE_ID: '18257865' }), null);
  assert.equal(fixtureAoVivo({ TXLINE_LIVE_INGEST: 'true', LIVE_FIXTURE_ID: 'abc' }), null);
  assert.equal(fixtureAoVivo({ TXLINE_LIVE_INGEST: 'true' }), null);
});

test('fixturesAoVivo watches more than one fixture and drops repeats', () => {
  assert.deepEqual(
    fixturesAoVivo({ TXLINE_LIVE_INGEST: 'true', LIVE_FIXTURE_IDS: '18257865, 18257739, 18257865, inválida' }),
    [18257865, 18257739],
  );
  assert.deepEqual(fixturesAoVivo({ TXLINE_LIVE_INGEST: 'false', LIVE_FIXTURE_IDS: '18257865,18257739' }), []);
});

test('a terminal event is game_finalised or the feed final status', () => {
  assert.equal(eventoEncerraPartida(score({ action: 'game_finalised' })), true);
  assert.equal(eventoEncerraPartida(score({ action: 'unknown', statusId: 100, period: 100 })), true);
  assert.equal(eventoEncerraPartida(score({ action: 'goal', hasScore: true })), false);
});

// ─── Who may ENTER live_fixtures ───
// Starting a lobby does not declare a match live — only the operator does, via
// LIVE_FIXTURE_IDS. Everything after that gate is defense in depth.

const ENV_PROD = { TXLINE_LIVE_INGEST: 'true', LIVE_FIXTURE_IDS: '18257865,18257739' };

test('REGRESSION: the recorded replay (18241006) can NEVER become a live fixture', () => {
  assert.equal(
    podeAtivarFixtureAoVivo(ENV_PROD, 18241006, { state: 'finished', cacheSource: 'txline-updates' }),
    false,
  );
});

test('a fixture declared by the operator and still scheduled may activate', () => {
  assert.equal(
    podeAtivarFixtureAoVivo(ENV_PROD, 18257865, { state: 'scheduled', cacheSource: 'txline-live' }),
    true,
  );
});

test('a declared but already finished fixture does not activate (defense in depth)', () => {
  assert.equal(
    podeAtivarFixtureAoVivo(ENV_PROD, 18257865, { state: 'finished', cacheSource: 'txline-live' }),
    false,
  );
});

test('a scheduled fixture outside LIVE_FIXTURE_IDS does not activate', () => {
  assert.equal(
    podeAtivarFixtureAoVivo(ENV_PROD, 18241006, { state: 'scheduled', cacheSource: 'txline-live' }),
    false,
  );
});

test('without TXLINE_LIVE_INGEST="true" nothing activates', () => {
  const agendada = { state: 'scheduled', cacheSource: 'txline-live' };
  assert.equal(podeAtivarFixtureAoVivo({ LIVE_FIXTURE_IDS: '18257865' }, 18257865, agendada), false);
  assert.equal(
    podeAtivarFixtureAoVivo({ TXLINE_LIVE_INGEST: 'false', LIVE_FIXTURE_IDS: '18257865' }, 18257865, agendada),
    false,
  );
});

test('a match unknown to the database does not activate — absent is NOT permission', () => {
  assert.equal(podeAtivarFixtureAoVivo(ENV_PROD, 18257865, null), false);
});

// ─── Market filter used by live routing ───
// Live events use the same full-match 1X2 criterion as replay projections.

test('a score from the target fixture routes; from another fixture it does not', () => {
  assert.equal(classificarParaSala(score(), 18257865), 'rotear');
  assert.equal(classificarParaSala(score({ fixtureId: 18257739 }), 18257865), 'outra_fixture');
});

test('full-match 1X2 odds route (marketPeriod absent)', () => {
  assert.equal(classificarParaSala(odds(), 18257865), 'rotear');
});

test('PERIOD 1X2 odds do not route — they are what would corrupt the final_result pct', () => {
  assert.equal(classificarParaSala(odds({ marketPeriod: '1H' }), 18257865), 'fora_do_mercado');
  assert.equal(classificarParaSala(odds({ marketPeriod: 1 }), 18257865), 'fora_do_mercado');
});

test('odds from another market (over/under etc.) do not route', () => {
  assert.equal(
    classificarParaSala(odds({ marketType: 'OVERUNDER_PARTICIPANT_GOALS' }), 18257865),
    'fora_do_mercado',
  );
});

test('odds from another fixture are outra_fixture before being a market question', () => {
  assert.equal(classificarParaSala(odds({ fixtureId: 18257739 }), 18257865), 'outra_fixture');
});

// ─── Who LEAVES the local channel map ───
// The TxLINE SSE pair is shared by every fixture, so ending one match may only
// drop that fixture's channel — never the streams, never the other fixtures.

test('only closes the channel of a fixture explicitly deactivated in the database', () => {
  assert.deepEqual(channelsToClose([18257865, 18257739], [18257865]), [18257865]);
});

test('a fixture with NO row in live_fixtures is not closed — it was seeded by the env', () => {
  // iniciarCanalAoVivo seeds LIVE_FIXTURE_IDS without writing to live_fixtures.
  // Closing "everything absent from listActive" would kill the legacy runbook channel.
  assert.deepEqual(channelsToClose([18257865, 18257739], []), []);
});

test('a deactivated fixture with no local channel does not become a phantom close', () => {
  assert.deepEqual(channelsToClose([18257739], [18257865]), []);
  assert.deepEqual(channelsToClose([], [18257865, 18257739]), []);
});
