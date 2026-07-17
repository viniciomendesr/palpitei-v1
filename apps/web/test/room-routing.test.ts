import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chaveDaSala,
  parsePartyId,
  parseRoomId,
  politicaDaSala,
} from '../src/server/room-id.ts';

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

test('replay repetido e parties diferentes continuam elegíveis a XP; só treino não persiste', () => {
  const rodadaA = parseRoomId('18241006')!;
  const rodadaB = parseRoomId('18241006')!;

  assert.deepEqual(politicaDaSala(rodadaA.treino), { pagaXp: true, persiste: true });
  assert.deepEqual(politicaDaSala(rodadaB.treino), { pagaXp: true, persiste: true });
  assert.notEqual(
    chaveDaSala(rodadaA.fixtureId, rodadaA.treino, 'ABC123'),
    chaveDaSala(rodadaB.fixtureId, rodadaB.treino, 'XYZ789'),
    'cada party ganha seu próprio runner e seus próprios questionIds',
  );

  assert.deepEqual(politicaDaSala(parseRoomId('treino-18241006')!.treino), {
    pagaXp: false,
    persiste: false,
  });
});
