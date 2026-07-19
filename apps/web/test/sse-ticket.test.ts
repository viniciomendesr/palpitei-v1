import assert from 'node:assert/strict';
import test from 'node:test';
import { createSseTicketStore } from '../src/server/sse-ticket.ts';

const scope = {
  did: 'did:privy:fan-1',
  purpose: 'room' as const,
  roomId: '18257865',
  partyId: 'FRANCE1',
};

test('it issues an SSE ticket and consumes it exactly once', () => {
  const store = createSseTicketStore({ ttlMs: 30_000 });
  const ticket = store.emitir(scope, 1_000);
  const expected = { purpose: scope.purpose, roomId: scope.roomId, partyId: scope.partyId };

  assert.equal(store.consumir(ticket, expected, 1_001), scope.did);
  assert.equal(store.consumir(ticket, expected, 1_002), null);
});

test('an SSE ticket does not authorize another purpose, sala or party', () => {
  const store = createSseTicketStore({ ttlMs: 30_000 });
  const ticket = store.emitir(scope, 1_000);
  const expected = { purpose: scope.purpose, roomId: scope.roomId, partyId: scope.partyId };

  assert.equal(store.consumir(ticket, { ...expected, purpose: 'lobby' }, 1_001), null);
  assert.equal(store.consumir(ticket, { ...expected, roomId: '18257739' }, 1_001), null);
  assert.equal(store.consumir(ticket, { ...expected, partyId: 'ARGENT1' }, 1_001), null);
  assert.equal(store.consumir(ticket, expected, 1_001), scope.did);
});

test('an expired SSE ticket is removed before it can open the stream', () => {
  const store = createSseTicketStore({ ttlMs: 30 });
  const ticket = store.emitir(scope, 1_000);

  assert.equal(
    store.consumir(ticket, { purpose: scope.purpose, roomId: scope.roomId, partyId: scope.partyId }, 1_030),
    null,
  );
  assert.equal(store.size(), 0);
});

test('cleanup keeps the SSE ticket store bounded', () => {
  let n = 0;
  const store = createSseTicketStore({ maxEntries: 2, createToken: () => `ticket-${++n}` });
  const first = store.emitir(scope, 1_000);
  store.emitir(scope, 1_001);
  store.emitir(scope, 1_002);

  assert.equal(store.size(), 2);
  assert.equal(
    store.consumir(first, { purpose: scope.purpose, roomId: scope.roomId, partyId: scope.partyId }, 1_003),
    null,
  );
});
