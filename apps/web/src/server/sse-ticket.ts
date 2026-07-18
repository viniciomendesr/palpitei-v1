/** Short-lived SSE tickets keep Privy Bearer tokens out of EventSource URLs. */

import { randomBytes } from 'node:crypto';

export const SSE_TICKET_TTL_MS = 30_000;
const SSE_TICKET_MAX_ENTRIES = 2_048;

export type SseTicketPurpose = 'lobby' | 'room';

export type SseTicketScope = {
  did: string;
  purpose: SseTicketPurpose;
  roomId: string;
  partyId: string;
};

type StoredSseTicket = SseTicketScope & {
  expiresAt: number;
};

type SseTicketStoreOptions = {
  ttlMs?: number;
  maxEntries?: number;
  createToken?: () => string;
};

/** Bounded in-memory ticket store with lazy expiry; no global cleanup timer. */
export function createSseTicketStore(options: SseTicketStoreOptions = {}) {
  const ttlMs = options.ttlMs ?? SSE_TICKET_TTL_MS;
  const maxEntries = options.maxEntries ?? SSE_TICKET_MAX_ENTRIES;
  const createToken = options.createToken ?? (() => randomBytes(32).toString('base64url'));
  const tickets = new Map<string, StoredSseTicket>();

  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttl do ticket SSE inválido');
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error('limite de tickets SSE inválido');
  }

  const limpar = (now: number) => {
    for (const [ticket, stored] of tickets) {
      if (stored.expiresAt <= now) tickets.delete(ticket);
    }
    // Remove oldest entries under pressure to bound authenticated-client memory use.
    while (tickets.size >= maxEntries) {
      const oldest = tickets.keys().next().value;
      if (!oldest) break;
      tickets.delete(oldest);
    }
  };

  const emitir = (scope: SseTicketScope, now = Date.now()): string => {
    limpar(now);
    let ticket = createToken();
    // Handle collisions even with a deterministic test token factory.
    while (tickets.has(ticket)) ticket = createToken();
    tickets.set(ticket, { ...scope, expiresAt: now + ttlMs });
    return ticket;
  };

  const consumir = (
    ticket: string | null | undefined,
    expected: Omit<SseTicketScope, 'did'>,
    now = Date.now(),
  ): string | null => {
    limpar(now);
    if (!ticket) return null;
    const stored = tickets.get(ticket);
    if (!stored) return null;
    // A scope mismatch neither reveals the DID nor consumes the valid ticket.
    if (
      stored.purpose !== expected.purpose ||
      stored.roomId !== expected.roomId ||
      stored.partyId !== expected.partyId
    ) {
      return null;
    }
    tickets.delete(ticket);
    return stored.did;
  };

  return { emitir, consumir, size: () => tickets.size };
}

const store = createSseTicketStore();

export function emitirTicketSse(scope: SseTicketScope): string {
  return store.emitir(scope);
}

export function consumirTicketSse(
  ticket: string | null | undefined,
  expected: Omit<SseTicketScope, 'did'>,
): string | null {
  return store.consumir(ticket, expected);
}

export function ehFinalidadeTicketSse(value: unknown): value is SseTicketPurpose {
  return value === 'lobby' || value === 'room';
}
