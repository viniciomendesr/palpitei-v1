import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chaveDaSala, parsePartyId, parseRoomId } from '../src/server/room-id.ts';

test('grupo isola runners da mesma fixture e mantém treino separado', () => {
  assert.notEqual(chaveDaSala(18241006, false, 'ABC123'), chaveDaSala(18241006, false, 'XYZ789'));
  assert.notEqual(chaveDaSala(18241006, false, 'ABC123'), chaveDaSala(18241006, true, 'ABC123'));
});

test('ids da sala e do grupo falham fechados', () => {
  assert.deepEqual(parseRoomId('treino-18241006'), { fixtureId: 18241006, treino: true });
  assert.equal(parsePartyId(' abc123 '), 'ABC123');
  assert.equal(parsePartyId('curto'), null);
  assert.equal(parsePartyId('../segredo'), null);
});
