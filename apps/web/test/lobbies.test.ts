import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  connectLobby,
  openLobby,
  resetLobby,
  setReady,
  startLobby,
  stateFor,
  type LobbyState,
} from '../src/server/lobbies.ts';

const meta = (key: string) => ({
  key,
  roomId: 'treino-18241006',
  partyId: 'ABC123',
  fixtureId: 18241006,
  treino: true,
  teamA: 'England',
  teamB: 'Argentina',
});

test('primeiro participante vira anfitrião e todos recebem presença/pronto', () => {
  const lobby = openLobby(meta('lobby-presence'));
  const a: LobbyState[] = [];
  const b: LobbyState[] = [];
  const leaveA = connectLobby(lobby, { id: 'a', name: 'Ana' }, (s) => a.push(s));
  const leaveB = connectLobby(lobby, { id: 'b', name: 'Beto' }, (s) => b.push(s));
  assert.equal(stateFor(lobby, 'a').meHost, true);
  assert.equal(stateFor(lobby, 'b').meHost, false);
  assert.equal(stateFor(lobby, 'a').players.length, 2);
  assert.equal(setReady(lobby, 'b', true), true);
  assert.equal(b.at(-1)?.meReady, true);
  leaveB();
  leaveA();
  resetLobby(lobby.key);
});

test('runner só pode iniciar pelo host quando todos estão prontos', () => {
  const lobby = openLobby(meta('lobby-start'));
  const leaveA = connectLobby(lobby, { id: 'a', name: 'Ana' }, () => {});
  const leaveB = connectLobby(lobby, { id: 'b', name: 'Beto' }, () => {});
  assert.equal(startLobby(lobby, 'b').ok, false);
  setReady(lobby, 'a', true);
  assert.equal(startLobby(lobby, 'a').ok, false);
  setReady(lobby, 'b', true);
  assert.equal(startLobby(lobby, 'a').ok, true);
  assert.equal(lobby.phase, 'started');
  leaveB();
  leaveA();
  resetLobby(lobby.key);
});
