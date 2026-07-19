import assert from 'node:assert/strict';
import test from 'node:test';
import { roomMode } from '../src/server/room-mode.ts';

const live = { matchState: 'live', liveChannel: true, hasPartySession: true };

test('canal ao vivo ativo manda na sala, independente do estado gravado', () => {
  assert.equal(roomMode(live), 'live');
  // Corrida real: o game_finalised grava 'finished' antes de o canal cair.
  assert.equal(roomMode({ ...live, matchState: 'finished' }), 'live');
});

test('partida encerrada com sessão da party vira tela de resultado, nunca replay novo', () => {
  // Without this, a restart-orphaned room reopened as a ReplayRunner and the fan watched
  // the match restart 0-0 at 12x, on persisting ports, creating fresh questions.
  assert.equal(
    roomMode({ matchState: 'finished', liveChannel: false, hasPartySession: true }),
    'finished',
  );
});

test('partida encerrada sem sessão continua sendo replay — é assim que o cache é jogado', () => {
  // 18241006 is a recorded, finished match: opening a room on it is the legitimate replay.
  assert.equal(
    roomMode({ matchState: 'finished', liveChannel: false, hasPartySession: false }),
    'replay',
  );
});

test('partida não encerrada sem canal é replay, mesmo com sessão da party', () => {
  // An unknown state is not permission to declare full time (absent != finished).
  assert.equal(
    roomMode({ matchState: 'live', liveChannel: false, hasPartySession: true }),
    'replay',
  );
  assert.equal(
    roomMode({ matchState: null, liveChannel: false, hasPartySession: true }),
    'replay',
  );
});
