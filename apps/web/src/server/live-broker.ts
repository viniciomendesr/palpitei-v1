/**
 * TxLINE distributed ingest broker. PostgreSQL remains durable truth; Redis
 * elects the SSE leader and fans out normalized events without raw payloads.
 */

import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import type { NormEvent, OddsEvent, ScoreEvent } from '@palpitei/core';

const CHAVE_LOCK = 'palpitei:txline:ingest:leader';
const PREFIXO_CANAL = 'palpitei:txline:fixture:';
const LEASE_MS = 15_000;
const RENOVAR_A_CADA_MS = 5_000;

type ClienteRedis = RedisClientType;

type Envelope = {
  version: 1;
  origin: string;
  event: Record<string, unknown>;
};

export type EstadoDoBroker = 'connecting' | 'follower' | 'leader' | 'failed';

export type EstadoDoRedis = {
  enabled: boolean;
  state: EstadoDoBroker | 'disabled';
  leader: boolean;
  lastError: string | null;
};

export type CallbacksDoBroker = {
  /** Event already persisted by another replica; it must not be persisted again. */
  onEvent: (event: NormEvent) => void;
  /** Lease transition; the caller opens or closes the TxLINE SSE stream. */
  onLeadershipChange: (leader: boolean) => void;
  /** Pub/Sub ready or reconnected; the caller reconciles rooms from PostgreSQL. */
  onSubscriberReady: () => void;
};

function numero(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function inteiroPositivo(value: unknown): number | null {
  const n = numero(value);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
}

function dupla(value: unknown): { p1: number; p2: number } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const p1 = numero(record.p1);
  const p2 = numero(record.p2);
  return p1 === null || p2 === null ? null : { p1, p2 };
}

function mapaNumerico(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const n = numero(item);
    if (n !== null) out[key] = n;
  }
  return out;
}

/** Removes raw fields so Redis cannot become a copy of the licensed dataset. */
export function compactarEventoParaBroker(event: NormEvent): Record<string, unknown> {
  if (event.kind === 'score') {
    return {
      kind: event.kind,
      fixtureId: event.fixtureId,
      seq: event.seq,
      ts: event.ts,
      action: event.action,
      statusId: event.statusId,
      period: event.period,
      gameStateRaw: event.gameStateRaw,
      clockRunning: event.clockRunning,
      clockSeconds: event.clockSeconds,
      hasScore: event.hasScore,
      goals: event.goals,
      corners: event.corners,
      totals: event.totals,
    };
  }
  return {
    kind: event.kind,
    fixtureId: event.fixtureId,
    ts: event.ts,
    messageId: event.messageId,
    marketType: event.marketType,
    marketPeriod: event.marketPeriod,
    line: event.line,
    inRunning: event.inRunning,
    bookmaker: event.bookmaker,
    prices: event.prices,
  };
}

/** Validates and restores the shared contract without accepting Redis raw payloads. */
export function eventoDoBroker(value: unknown): NormEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const fixtureId = inteiroPositivo(event.fixtureId);
  const ts = numero(event.ts);
  if (fixtureId === null || ts === null) return null;

  if (event.kind === 'score') {
    const seq = inteiroPositivo(event.seq);
    const goals = dupla(event.goals);
    const corners = dupla(event.corners);
    if (seq === null || goals === null || corners === null || typeof event.action !== 'string' || typeof event.hasScore !== 'boolean') {
      return null;
    }
    const restored: ScoreEvent = {
      kind: 'score',
      fixtureId,
      seq,
      ts,
      action: event.action,
      hasScore: event.hasScore,
      goals,
      corners,
      raw: null,
    };
    if (typeof event.statusId === 'number') restored.statusId = event.statusId;
    if (typeof event.period === 'number') restored.period = event.period;
    if (typeof event.gameStateRaw === 'string' || typeof event.gameStateRaw === 'number') restored.gameStateRaw = event.gameStateRaw;
    if (typeof event.clockRunning === 'boolean') restored.clockRunning = event.clockRunning;
    if (typeof event.clockSeconds === 'number') restored.clockSeconds = event.clockSeconds;
    if (event.totals && typeof event.totals === 'object') {
      const totals = event.totals as Record<string, unknown>;
      const p1 = mapaNumerico(totals.p1);
      const p2 = mapaNumerico(totals.p2);
      if (p1 && p2) restored.totals = { p1, p2 };
    }
    return restored;
  }

  if (event.kind !== 'odds' || typeof event.marketType !== 'string' || !Array.isArray(event.prices)) return null;
  const prices: OddsEvent['prices'] = [];
  for (const price of event.prices) {
    if (!price || typeof price !== 'object') return null;
    const item = price as Record<string, unknown>;
    const odds = numero(item.odds);
    const pct = numero(item.pct);
    if (typeof item.name !== 'string' || odds === null || pct === null) return null;
    prices.push({ name: item.name, odds, pct });
  }
  const restored: OddsEvent = { kind: 'odds', fixtureId, ts, marketType: event.marketType, prices, raw: null };
  if (typeof event.messageId === 'string') restored.messageId = event.messageId;
  if (typeof event.marketPeriod === 'string' || typeof event.marketPeriod === 'number') restored.marketPeriod = event.marketPeriod;
  if (typeof event.line === 'number') restored.line = event.line;
  if (typeof event.inRunning === 'boolean') restored.inRunning = event.inRunning;
  if (typeof event.bookmaker === 'string') restored.bookmaker = event.bookmaker;
  return restored;
}

function canalDaFixture(fixtureId: number): string {
  return `${PREFIXO_CANAL}${fixtureId}`;
}

/** Redis is opt-in so local and legacy configurations remain dependency-free. */
export function redisDoLiveHabilitado(env?: { REDIS_URL?: string }): boolean {
  const url = env ? env.REDIS_URL : process.env.REDIS_URL;
  return typeof url === 'string' && url.trim().length > 0;
}

/** Token-based lease prevents a stale replica from deleting another leader's lock. */
export class BrokerRedisAoVivo {
  private readonly token = randomUUID();
  private readonly command: ClienteRedis;
  private readonly subscriber: ClienteRedis;
  private callbacks: CallbacksDoBroker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private leader = false;
  private status: EstadoDoRedis = { enabled: true, state: 'connecting', leader: false, lastError: null };

  constructor(url: string) {
    this.command = createClient({ url });
    this.subscriber = this.command.duplicate();
    const onError = (error: Error) => {
      this.status = { ...this.status, state: 'failed', lastError: error.message };
      this.definirLider(false);
    };
    this.command.on('error', onError);
    this.subscriber.on('error', onError);
    this.subscriber.on('ready', () => this.callbacks?.onSubscriberReady());
  }

  estado(): EstadoDoRedis {
    return { ...this.status };
  }

  ehLider(): boolean {
    return this.leader;
  }

  async iniciar(callbacks: CallbacksDoBroker): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.callbacks = callbacks;
    try {
      await this.command.connect();
      await this.subscriber.connect();
      await this.subscriber.pSubscribe(`${PREFIXO_CANAL}*`, (message) => this.receber(message));
      await this.renovarLease();
      this.callbacks.onSubscriberReady();
      this.timer = setInterval(() => void this.renovarLease(), RENOVAR_A_CADA_MS);
      this.timer.unref?.();
    } catch (error) {
      this.started = false;
      this.status = {
        ...this.status,
        state: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
      };
      this.definirLider(false);
      throw error;
    }
  }

  async publicar(event: NormEvent): Promise<void> {
    if (!this.leader) throw new Error('tentativa de publicar evento TxLINE sem lease Redis');
    const envelope: Envelope = {
      version: 1,
      origin: this.token,
      event: compactarEventoParaBroker(event),
    };
    await this.command.publish(canalDaFixture(event.fixtureId), JSON.stringify(envelope));
  }

  private receber(message: string): void {
    try {
      const envelope = JSON.parse(message) as Partial<Envelope>;
      if (envelope.version !== 1 || envelope.origin === this.token) return;
      const event = eventoDoBroker(envelope.event);
      if (event) this.callbacks?.onEvent(event);
    } catch (error) {
      this.status = {
        ...this.status,
        lastError: error instanceof Error ? `mensagem Redis inválida: ${error.message}` : 'mensagem Redis inválida',
      };
    }
  }

  private async renovarLease(): Promise<void> {
    try {
      const renovado = await this.command.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end",
        { keys: [CHAVE_LOCK], arguments: [this.token, String(LEASE_MS)] },
      );
      let lider = Number(renovado) === 1;
      if (!lider) {
        const adquirido = await this.command.set(CHAVE_LOCK, this.token, { NX: true, PX: LEASE_MS });
        lider = adquirido === 'OK';
      }
      this.status = { enabled: true, state: lider ? 'leader' : 'follower', leader: lider, lastError: null };
      this.definirLider(lider);
    } catch (error) {
      this.status = {
        ...this.status,
        state: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
      };
      this.definirLider(false);
    }
  }

  private definirLider(leader: boolean): void {
    if (this.leader === leader) return;
    this.leader = leader;
    this.status = { ...this.status, leader, state: leader ? 'leader' : this.status.state === 'failed' ? 'failed' : 'follower' };
    this.callbacks?.onLeadershipChange(leader);
  }
}

const CHAVE_BROKER = '__palpitei_broker_redis_ao_vivo__' as const;
type GlobalComBroker = typeof globalThis & { [CHAVE_BROKER]?: BrokerRedisAoVivo };

/** One client per process, preserved across Next.js hot reload. */
export function brokerRedisAoVivo(): BrokerRedisAoVivo | null {
  const url = process.env.REDIS_URL;
  if (!redisDoLiveHabilitado({ REDIS_URL: url })) return null;
  const globalComBroker = globalThis as GlobalComBroker;
  return (globalComBroker[CHAVE_BROKER] ??= new BrokerRedisAoVivo(url!));
}
