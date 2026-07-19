import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roomKey,
  parsePartyId,
  parseRoomId,
  roomPolicy,
} from '../src/server/room-id.ts';

test('a party isolates runners of the same fixture and keeps treino separate', () => {
  assert.notEqual(roomKey(18241006, false, 'ABC123'), roomKey(18241006, false, 'XYZ789'));
  assert.notEqual(roomKey(18241006, false, 'ABC123'), roomKey(18241006, true, 'ABC123'));
});

test('sala and party ids fail closed', () => {
  assert.deepEqual(parseRoomId('treino-18241006'), { fixtureId: 18241006, training: true });
  assert.equal(parsePartyId(' abc123 '), 'ABC123');
  assert.equal(parsePartyId('curto'), null);
  assert.equal(parsePartyId('../segredo'), null);
});

test('repeated replays and different parties stay XP-eligible; only treino does not persist', () => {
  const rodadaA = parseRoomId('18241006')!;
  const rodadaB = parseRoomId('18241006')!;

  assert.deepEqual(roomPolicy(rodadaA.training), { paysXp: true, persists: true });
  assert.deepEqual(roomPolicy(rodadaB.training), { paysXp: true, persists: true });
  assert.notEqual(
    roomKey(rodadaA.fixtureId, rodadaA.training, 'ABC123'),
    roomKey(rodadaB.fixtureId, rodadaB.training, 'XYZ789'),
    'each party gets its own runner and its own questionIds',
  );

  assert.deepEqual(roomPolicy(parseRoomId('treino-18241006')!.training), {
    paysXp: false,
    persists: false,
  });
});
