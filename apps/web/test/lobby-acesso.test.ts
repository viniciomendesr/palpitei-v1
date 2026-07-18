import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessStartedLobby } from '../src/server/lobby-acesso.ts';

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
