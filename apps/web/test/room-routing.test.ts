import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roomKey,
  parsePartyId,
  parseRoomId,
  roomPolicy,
} from '../src/server/room-id.ts';

test('grupo isola runners da mesma fixture e mantém treino separado', () => {
  assert.notEqual(roomKey(18241006, false, 'ABC123'), roomKey(18241006, false, 'XYZ789'));
  assert.notEqual(roomKey(18241006, false, 'ABC123'), roomKey(18241006, true, 'ABC123'));
});

test('ids da sala e do grupo falham fechados', () => {
  assert.deepEqual(parseRoomId('treino-18241006'), { fixtureId: 18241006, training: true });
  assert.equal(parsePartyId(' abc123 '), 'ABC123');
  assert.equal(parsePartyId('curto'), null);
  assert.equal(parsePartyId('../segredo'), null);
});

test('replay repetido e parties diferentes continuam elegíveis a XP; só treino não persiste', () => {
  const rodadaA = parseRoomId('18241006')!;
  const rodadaB = parseRoomId('18241006')!;

  assert.deepEqual(roomPolicy(rodadaA.training), { paysXp: true, persists: true });
  assert.deepEqual(roomPolicy(rodadaB.training), { paysXp: true, persists: true });
  assert.notEqual(
    roomKey(rodadaA.fixtureId, rodadaA.training, 'ABC123'),
    roomKey(rodadaB.fixtureId, rodadaB.training, 'XYZ789'),
    'cada party ganha seu próprio runner e seus próprios questionIds',
  );

  assert.deepEqual(roomPolicy(parseRoomId('treino-18241006')!.training), {
    paysXp: false,
    persists: false,
  });
});
