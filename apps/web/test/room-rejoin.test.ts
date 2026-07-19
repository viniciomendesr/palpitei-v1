import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_REJOIN_ATTEMPTS,
  rejoinAction,
  type RejoinContext,
} from '../src/lib/room-rejoin.ts';

const membroQueVoltou: RejoinContext = {
  status: 403,
  hasParty: true,
  privyAuthenticated: true,
  tentativas: 0,
};

test('403 com código de party e Privy autenticado tenta entrar de novo na mesma sala', () => {
  assert.equal(rejoinAction(membroQueVoltou), 'rejoin');
  // 404 is the same case: the lobby left process memory and the join reopens it.
  assert.equal(rejoinAction({ ...membroQueVoltou, status: 404 }), 'rejoin');
});

test('403 sem código de party desiste — não existe sala para voltar', () => {
  assert.equal(rejoinAction({ ...membroQueVoltou, hasParty: false }), 'giveUp');
});

test('erro de rede passageiro reconecta pelo backoff, nunca faz rejoin', () => {
  // EventSource exposes no status: a statusless failure is a network blip, not eviction.
  assert.equal(rejoinAction({ ...membroQueVoltou, status: null }), 'reconnect');
  assert.equal(rejoinAction({ ...membroQueVoltou, status: 500 }), 'reconnect');
  assert.equal(rejoinAction({ ...membroQueVoltou, status: 502 }), 'reconnect');
  // No party and no 403 is still a reconnect: only 403/404 is an access verdict.
  assert.equal(
    rejoinAction({ ...membroQueVoltou, status: null, hasParty: false }),
    'reconnect',
  );
});

test('tentativas esgotadas desistem para o fã ler a mensagem, não girar em silêncio', () => {
  assert.equal(
    rejoinAction({ ...membroQueVoltou, tentativas: MAX_REJOIN_ATTEMPTS }),
    'giveUp',
  );
  assert.equal(
    rejoinAction({ ...membroQueVoltou, tentativas: MAX_REJOIN_ATTEMPTS + 5 }),
    'giveUp',
  );
});

test('Privy fora do ar não vira rejoin nem desistência — a ilha ainda pode subir', () => {
  // CONTEXT §11: Privy fails late, not loud. Giving up here would be the logged-in fan's 401.
  assert.equal(
    rejoinAction({ ...membroQueVoltou, privyAuthenticated: false }),
    'reconnect',
  );
});

test('401 não faz rejoin: sem sessão verificada o join falharia igual', () => {
  assert.equal(rejoinAction({ ...membroQueVoltou, status: 401 }), 'reconnect');
});
