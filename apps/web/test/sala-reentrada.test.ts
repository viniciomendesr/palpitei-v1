import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_TENTATIVAS_REJOIN,
  acaoDeReentrada,
  type ReentradaContexto,
} from '../src/lib/sala-reentrada.ts';

const membroQueVoltou: ReentradaContexto = {
  status: 403,
  temParty: true,
  privyAuthenticated: true,
  tentativas: 0,
};

test('403 com código de party e Privy autenticado tenta entrar de novo na mesma sala', () => {
  assert.equal(acaoDeReentrada(membroQueVoltou), 'rejoin');
  // 404 is the same case: the lobby left process memory and the join reopens it.
  assert.equal(acaoDeReentrada({ ...membroQueVoltou, status: 404 }), 'rejoin');
});

test('403 sem código de party desiste — não existe sala para voltar', () => {
  assert.equal(acaoDeReentrada({ ...membroQueVoltou, temParty: false }), 'desistir');
});

test('erro de rede passageiro reconecta pelo backoff, nunca faz rejoin', () => {
  // EventSource exposes no status: a statusless failure is a network blip, not eviction.
  assert.equal(acaoDeReentrada({ ...membroQueVoltou, status: null }), 'reconectar');
  assert.equal(acaoDeReentrada({ ...membroQueVoltou, status: 500 }), 'reconectar');
  assert.equal(acaoDeReentrada({ ...membroQueVoltou, status: 502 }), 'reconectar');
  // No party and no 403 is still a reconnect: only 403/404 is an access verdict.
  assert.equal(
    acaoDeReentrada({ ...membroQueVoltou, status: null, temParty: false }),
    'reconectar',
  );
});

test('tentativas esgotadas desistem para o fã ler a mensagem, não girar em silêncio', () => {
  assert.equal(
    acaoDeReentrada({ ...membroQueVoltou, tentativas: MAX_TENTATIVAS_REJOIN }),
    'desistir',
  );
  assert.equal(
    acaoDeReentrada({ ...membroQueVoltou, tentativas: MAX_TENTATIVAS_REJOIN + 5 }),
    'desistir',
  );
});

test('Privy fora do ar não vira rejoin nem desistência — a ilha ainda pode subir', () => {
  // CONTEXT §11: Privy fails late, not loud. Giving up here would be the logged-in fan's 401.
  assert.equal(
    acaoDeReentrada({ ...membroQueVoltou, privyAuthenticated: false }),
    'reconectar',
  );
});

test('401 não faz rejoin: sem sessão verificada o join falharia igual', () => {
  assert.equal(acaoDeReentrada({ ...membroQueVoltou, status: 401 }), 'reconectar');
});
