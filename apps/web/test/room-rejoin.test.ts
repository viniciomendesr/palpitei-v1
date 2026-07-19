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

test('403 with a party code and Privy authenticated retries joining the same sala', () => {
  assert.equal(rejoinAction(membroQueVoltou), 'rejoin');
  // 404 is the same case: the lobby left process memory and the join reopens it.
  assert.equal(rejoinAction({ ...membroQueVoltou, status: 404 }), 'rejoin');
});

test('403 without a party code gives up — there is no sala to return to', () => {
  assert.equal(rejoinAction({ ...membroQueVoltou, hasParty: false }), 'giveUp');
});

test('a transient network error reconnects via backoff, it never rejoins', () => {
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

test('exhausted attempts give up so the fan reads the message instead of spinning in silence', () => {
  assert.equal(
    rejoinAction({ ...membroQueVoltou, tentativas: MAX_REJOIN_ATTEMPTS }),
    'giveUp',
  );
  assert.equal(
    rejoinAction({ ...membroQueVoltou, tentativas: MAX_REJOIN_ATTEMPTS + 5 }),
    'giveUp',
  );
});

test('Privy being down becomes neither a rejoin nor a give-up — the island may still come up', () => {
  // CONTEXT §11: Privy fails late, not loud. Giving up here would be the logged-in fan's 401.
  assert.equal(
    rejoinAction({ ...membroQueVoltou, privyAuthenticated: false }),
    'reconnect',
  );
});

test('401 does not rejoin: without a verified session the join would fail the same way', () => {
  assert.equal(rejoinAction({ ...membroQueVoltou, status: 401 }), 'reconnect');
});
