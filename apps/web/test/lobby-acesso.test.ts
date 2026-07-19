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

test('acesso da sala só aceita o membro ativo do lobby iniciado correspondente', () => {
  assert.equal(canAccessStartedLobby(membroAtivo, sala, agora), true, 'membro ativo entra');
  assert.equal(canAccessStartedLobby(null, sala, agora), false, 'ex-membro não entra');
  assert.equal(canAccessStartedLobby(null, sala, agora), false, 'estranho não entra');
});

test('acesso da sala rejeita convite vencido ou lobby de outra partida/modo/fase', () => {
  assert.equal(canAccessStartedLobby({ ...membroAtivo, expiresAt: agora }, sala, agora), false);
  assert.equal(canAccessStartedLobby({ ...membroAtivo, fixtureId: 18257739 }, sala, agora), false);
  assert.equal(canAccessStartedLobby({ ...membroAtivo, treino: true }, sala, agora), false);
  assert.equal(canAccessStartedLobby({ ...membroAtivo, phase: 'waiting' }, sala, agora), false);
});

test('depois do apito o fã ainda entra para ver o resultado — reiniciar exige party nova', () => {
  // finalizarSala writes 'finished'; requiring 'started' made the whistle itself revoke
  // access, so a fan who had dropped never saw the result or the ranking.
  assert.equal(
    canAccessStartedLobby({ ...membroAtivo, phase: 'finished' }, sala, agora),
    true,
    'partida encerrada continua legível para quem participou',
  );
  // Reading a result is not replaying: waiting stays barred and expiry still applies.
  assert.equal(canAccessStartedLobby({ ...membroAtivo, phase: 'waiting' }, sala, agora), false);
  assert.equal(
    canAccessStartedLobby({ ...membroAtivo, phase: 'finished', expiresAt: agora }, sala, agora),
    false,
    'convite vencido não reabre pelo fim de jogo',
  );
});

test('o portão em memória tem que aceitar as MESMAS fases que o portão do Postgres', () => {
  // The in-memory lobby is rehydrated from Postgres (openLobby copies the phase). After
  // reconciliation the persisted phase becomes 'finished'; if this gate required 'started',
  // canAccessStartedLobby would allow entry and the route would answer 409 right after —
  // the fan would bounce off their own room forever without seeing the result.
  assert.equal(inMemoryLobbyAllowsRoom('started'), true);
  assert.equal(inMemoryLobbyAllowsRoom('finished'), true);
  assert.equal(inMemoryLobbyAllowsRoom('waiting'), false, 'quem não começou não tem sala');
  assert.equal(inMemoryLobbyAllowsRoom(undefined), false, 'lobby ausente não libera nada');
});
