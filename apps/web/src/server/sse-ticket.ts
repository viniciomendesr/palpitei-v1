/**
 * Tickets efêmeros para o SSE. O EventSource não permite Authorization header;
 * por isso a URL carrega apenas este segredo descartável, nunca o Bearer da
 * Privy. A store é intencionalmente por processo: uma conexão SSE também fica
 * presa ao processo que a abriu.
 */

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

/**
 * Uma pequena store em memória, com expiração preguiçosa e teto rígido. Não há
 * timer global: processos frios não ficam vivos só para limpar tickets.
 */
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
    // Map preserva a ordem de inserção; remove os mais antigos quando houver
    // pressão, em vez de deixar um cliente autenticado crescer a memória.
    while (tickets.size >= maxEntries) {
      const oldest = tickets.keys().next().value;
      if (!oldest) break;
      tickets.delete(oldest);
    }
  };

  const emitir = (scope: SseTicketScope, now = Date.now()): string => {
    limpar(now);
    let ticket = createToken();
    // Em produção `randomBytes(32)` torna colisão impraticável; a proteção
    // também mantém determinísticos os testes com uma fábrica controlada.
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
    // Escopo errado não revela o DID e não consome a conexão legítima. Só a
    // rota exatamente correspondente recebe o ticket de uso único.
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
