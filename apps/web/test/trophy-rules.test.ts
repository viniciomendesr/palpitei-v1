import test from 'node:test';
import assert from 'node:assert/strict';

import { canAwardDebutTrophy } from '../src/server/trophy-rules.ts';

const FA = 'did:privy:cmxyz';

test('sala ao vivo, valendo XP, concede o troféu de estreia', () => {
  assert.equal(canAwardDebutTrophy({ roomMode: 'live', training: false, privyDid: FA }), true);
});

test('replay NÃO concede troféu — "tem eventos" não é "está ao vivo"', () => {
  // A 18241006 tem 962 eventos gravados e é justamente a armadilha: qualquer
  // regra do tipo "essa fixture tem eventos" premiaria quem abre a aba Replays.
  assert.equal(canAwardDebutTrophy({ roomMode: 'replay', training: false, privyDid: FA }), false);
});

test('sala de partida já encerrada NÃO concede troféu', () => {
  // A 18257865 esteve ao vivo em 18/07 e hoje é `finished`: avaliar pelo estado
  // atual responde errado nos dois sentidos, por isso a decisão é no palpite.
  assert.equal(canAwardDebutTrophy({ roomMode: 'finished', training: false, privyDid: FA }), false);
});

test('treino NÃO concede troféu nem estando ao vivo', () => {
  assert.equal(canAwardDebutTrophy({ roomMode: 'live', training: true, privyDid: FA }), false);
});

test('conta demo NÃO concede troféu', () => {
  assert.equal(canAwardDebutTrophy({ roomMode: 'live', training: false, privyDid: 'demo:abc' }), false);
});

test('did ausente NÃO concede troféu — ausente não é autorizado', () => {
  assert.equal(canAwardDebutTrophy({ roomMode: 'live', training: false, privyDid: undefined }), false);
});
