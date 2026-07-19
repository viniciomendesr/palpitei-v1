import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessStartedLobby, inMemoryLobbyAllowsRoom } from '../src/server/lobby-acesso.ts';

const agora = 1_800_000_000_000;
const sala = { fixtureId: 18257865, training: false };
const membroAtivo = {
  fixtureId: sala.fixtureId,
  treino: sala.training,
  phase: 'started' as const,
  expiresAt: agora + 60_000,
};

test('sala access only accepts the active member of the matching started lobby', () => {
  assert.equal(canAccessStartedLobby(membroAtivo, sala, agora), true, 'an active member gets in');
  assert.equal(canAccessStartedLobby(null, sala, agora), false, 'a former member does not get in');
  assert.equal(canAccessStartedLobby(null, sala, agora), false, 'a stranger does not get in');
});

test('sala access rejects an expired invite or a lobby from another match/mode/phase', () => {
  assert.equal(canAccessStartedLobby({ ...membroAtivo, expiresAt: agora }, sala, agora), false);
  assert.equal(canAccessStartedLobby({ ...membroAtivo, fixtureId: 18257739 }, sala, agora), false);
  assert.equal(canAccessStartedLobby({ ...membroAtivo, treino: true }, sala, agora), false);
  assert.equal(canAccessStartedLobby({ ...membroAtivo, phase: 'waiting' }, sala, agora), false);
});

test('after the whistle the fan still gets in to see the result — restarting needs a new party', () => {
  // finalizarSala writes 'finished'; requiring 'started' made the whistle itself revoke
  // access, so a fan who had dropped never saw the result or the ranking.
  assert.equal(
    canAccessStartedLobby({ ...membroAtivo, phase: 'finished' }, sala, agora),
    true,
    'a finished match stays readable for whoever took part',
  );
  // Reading a result is not replaying: waiting stays barred and expiry still applies.
  assert.equal(canAccessStartedLobby({ ...membroAtivo, phase: 'waiting' }, sala, agora), false);
  assert.equal(
    canAccessStartedLobby({ ...membroAtivo, phase: 'finished', expiresAt: agora }, sala, agora),
    false,
    'an expired invite is not reopened by the end of the match',
  );
});

test('the in-memory gate must accept the SAME phases as the Postgres gate', () => {
  // The in-memory lobby is rehydrated from Postgres (openLobby copies the phase). After
  // reconciliation the persisted phase becomes 'finished'; if this gate required 'started',
  // canAccessStartedLobby would allow entry and the route would answer 409 right after —
  // the fan would bounce off their own room forever without seeing the result.
  assert.equal(inMemoryLobbyAllowsRoom('started'), true);
  assert.equal(inMemoryLobbyAllowsRoom('finished'), true);
  assert.equal(inMemoryLobbyAllowsRoom('waiting'), false, 'whoever has not started has no sala');
  assert.equal(inMemoryLobbyAllowsRoom(undefined), false, 'an absent lobby releases nothing');
});
