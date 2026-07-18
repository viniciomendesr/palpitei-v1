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

test('depois do apito o fã ainda entra para ver o resultado — reiniciar exige party nova', () => {
  // finalizarSala grava 'finished'; exigir 'started' fazia o próprio apito revogar
  // o acesso, e quem tinha perdido a conexão nunca via resultado nem ranking.
  assert.equal(
    canAccessStartedLobby({ ...membroAtivo, phase: 'finished' }, sala, agora),
    true,
    'partida encerrada continua legível para quem participou',
  );
  // Ler o resultado não é rejogar: waiting segue barrado e a expiração vale igual.
  assert.equal(canAccessStartedLobby({ ...membroAtivo, phase: 'waiting' }, sala, agora), false);
  assert.equal(
    canAccessStartedLobby({ ...membroAtivo, phase: 'finished', expiresAt: agora }, sala, agora),
    false,
    'convite vencido não reabre pelo fim de jogo',
  );
});
