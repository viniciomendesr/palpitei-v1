import assert from 'node:assert/strict';
import test from 'node:test';
import { roomMode } from '../src/server/room-mode.ts';

const live = { matchState: 'live', liveChannel: true, hasPartySession: true };

test('an active live channel rules the sala, regardless of the recorded state', () => {
  assert.equal(roomMode(live), 'live');
  // Real race: game_finalised writes 'finished' before the channel drops.
  assert.equal(roomMode({ ...live, matchState: 'finished' }), 'live');
});

test('a finished match with a party session becomes a result screen, never a fresh replay', () => {
  // Without this, a restart-orphaned room reopened as a ReplayRunner and the fan watched
  // the match restart 0-0 at 12x, on persisting ports, creating fresh questions.
  assert.equal(
    roomMode({ matchState: 'finished', liveChannel: false, hasPartySession: true }),
    'finished',
  );
});

test('a finished match with no session stays a replay — that is how the cache is played', () => {
  // 18241006 is a recorded, finished match: opening a room on it is the legitimate replay.
  assert.equal(
    roomMode({ matchState: 'finished', liveChannel: false, hasPartySession: false }),
    'replay',
  );
});

test('an unfinished match with no channel is a replay, even with a party session', () => {
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
