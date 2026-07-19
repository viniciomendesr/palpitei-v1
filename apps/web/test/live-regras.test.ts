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

test('fixtureAoVivo: só liga com TXLINE_LIVE_INGEST="true" literal E fixture numérica', () => {
  assert.equal(
    fixtureAoVivo({ TXLINE_LIVE_INGEST: 'true', LIVE_FIXTURE_ID: '18257865' }),
    18257865,
  );
});

test('fixtureAoVivo: env ausente é DESLIGADO (o oposto do getter do pacote)', () => {
  assert.equal(fixtureAoVivo({ LIVE_FIXTURE_ID: '18257865' }), null);
  assert.equal(fixtureAoVivo({}), null);
});

test('a trava permite seleção dinâmica pelo banco sem reabrir o default inseguro', () => {
  assert.equal(ingestAoVivoHabilitado({ TXLINE_LIVE_INGEST: 'true' }), true);
  assert.equal(fixturesAoVivo({ TXLINE_LIVE_INGEST: 'true' }).length, 0, 'env pode ficar sem IDs quando o banco é o registro');
  assert.equal(ingestAoVivoHabilitado({}), false);
});

test('fixtureAoVivo: "false", "1" ou fixture não numérica não ligam nada', () => {
  assert.equal(fixtureAoVivo({ TXLINE_LIVE_INGEST: 'false', LIVE_FIXTURE_ID: '18257865' }), null);
  assert.equal(fixtureAoVivo({ TXLINE_LIVE_INGEST: '1', LIVE_FIXTURE_ID: '18257865' }), null);
  assert.equal(fixtureAoVivo({ TXLINE_LIVE_INGEST: 'true', LIVE_FIXTURE_ID: 'abc' }), null);
  assert.equal(fixtureAoVivo({ TXLINE_LIVE_INGEST: 'true' }), null);
});

test('fixturesAoVivo observa mais de uma fixture e elimina repetições', () => {
  assert.deepEqual(
    fixturesAoVivo({ TXLINE_LIVE_INGEST: 'true', LIVE_FIXTURE_IDS: '18257865, 18257739, 18257865, inválida' }),
    [18257865, 18257739],
  );
  assert.deepEqual(fixturesAoVivo({ TXLINE_LIVE_INGEST: 'false', LIVE_FIXTURE_IDS: '18257865,18257739' }), []);
});

test('evento terminal é game_finalised ou o status final do feed', () => {
  assert.equal(eventoEncerraPartida(score({ action: 'game_finalised' })), true);
  assert.equal(eventoEncerraPartida(score({ action: 'unknown', statusId: 100, period: 100 })), true);
  assert.equal(eventoEncerraPartida(score({ action: 'goal', hasScore: true })), false);
});

// ─── Who may ENTER live_fixtures ───
// Starting a lobby does not declare a match live — only the operator does, via
// LIVE_FIXTURE_IDS. Everything after that gate is defense in depth.

const ENV_PROD = { TXLINE_LIVE_INGEST: 'true', LIVE_FIXTURE_IDS: '18257865,18257739' };

test('REGRESSÃO: o replay gravado (18241006) NUNCA pode virar fixture ao vivo', () => {
  assert.equal(
    podeAtivarFixtureAoVivo(ENV_PROD, 18241006, { state: 'finished', cacheSource: 'txline-updates' }),
    false,
  );
});

test('fixture declarada pelo operador e ainda agendada pode ativar', () => {
  assert.equal(
    podeAtivarFixtureAoVivo(ENV_PROD, 18257865, { state: 'scheduled', cacheSource: 'txline-live' }),
    true,
  );
});

test('fixture declarada mas já encerrada não ativa (defesa em profundidade)', () => {
  assert.equal(
    podeAtivarFixtureAoVivo(ENV_PROD, 18257865, { state: 'finished', cacheSource: 'txline-live' }),
    false,
  );
});

test('fixture agendada fora de LIVE_FIXTURE_IDS não ativa', () => {
  assert.equal(
    podeAtivarFixtureAoVivo(ENV_PROD, 18241006, { state: 'scheduled', cacheSource: 'txline-live' }),
    false,
  );
});

test('sem TXLINE_LIVE_INGEST="true" nada ativa', () => {
  const agendada = { state: 'scheduled', cacheSource: 'txline-live' };
  assert.equal(podeAtivarFixtureAoVivo({ LIVE_FIXTURE_IDS: '18257865' }, 18257865, agendada), false);
  assert.equal(
    podeAtivarFixtureAoVivo({ TXLINE_LIVE_INGEST: 'false', LIVE_FIXTURE_IDS: '18257865' }, 18257865, agendada),
    false,
  );
});

test('partida desconhecida no banco não ativa — ausente NÃO é permissão', () => {
  assert.equal(podeAtivarFixtureAoVivo(ENV_PROD, 18257865, null), false);
});

// ─── Market filter used by live routing ───
// Live events use the same full-match 1X2 criterion as replay projections.

test('score da fixture-alvo roteia; de outra fixture, não', () => {
  assert.equal(classificarParaSala(score(), 18257865), 'rotear');
  assert.equal(classificarParaSala(score({ fixtureId: 18257739 }), 18257865), 'outra_fixture');
});

test('odds 1X2 de jogo inteiro roteia (marketPeriod ausente)', () => {
  assert.equal(classificarParaSala(odds(), 18257865), 'rotear');
});

test('odds 1X2 DE PERÍODO não roteia — é o que corromperia o pct da final_result', () => {
  assert.equal(classificarParaSala(odds({ marketPeriod: '1H' }), 18257865), 'fora_do_mercado');
  assert.equal(classificarParaSala(odds({ marketPeriod: 1 }), 18257865), 'fora_do_mercado');
});

test('odds de outro mercado (over/under etc.) não roteia', () => {
  assert.equal(
    classificarParaSala(odds({ marketType: 'OVERUNDER_PARTICIPANT_GOALS' }), 18257865),
    'fora_do_mercado',
  );
});

test('odds de outra fixture é outra_fixture antes de ser mercado', () => {
  assert.equal(classificarParaSala(odds({ fixtureId: 18257739 }), 18257865), 'outra_fixture');
});

// ─── Who LEAVES the local channel map ───
// The TxLINE SSE pair is shared by every fixture, so ending one match may only
// drop that fixture's channel — never the streams, never the other fixtures.

test('só encerra canal de fixture explicitamente desativada no banco', () => {
  assert.deepEqual(channelsToClose([18257865, 18257739], [18257865]), [18257865]);
});

test('fixture SEM linha em live_fixtures não é encerrada — foi semeada pela env', () => {
  // iniciarCanalAoVivo semeia LIVE_FIXTURE_IDS sem gravar em live_fixtures.
  // Closing "everything absent from listActive" would kill the legacy runbook channel.
  assert.deepEqual(channelsToClose([18257865, 18257739], []), []);
});

test('desativada que nem tem canal local não vira encerramento fantasma', () => {
  assert.deepEqual(channelsToClose([18257739], [18257865]), []);
  assert.deepEqual(channelsToClose([], [18257865, 18257739]), []);
});
