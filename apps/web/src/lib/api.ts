/**
 * Contratos que o front consome — herdados do v0 (CONTEXT.md §8).
 *
 * Aqui só existem TIPOS e um cliente fino. As telas ainda rodam no mock; quando
 * o backend subir, quem troca é o provedor de dados, não o componente.
 *
 * DUAS REGRAS QUE NÃO SE NEGOCIAM, e por isso estão gravadas no tipo:
 *
 * 1. NUNCA mande `userId` no body. A identidade é o `privy_did` VERIFICADO no
 *    servidor a partir do Bearer. O v0 tinha um resolveUser() que caía pro
 *    body.userId quando não havia header — atrás de link público com ranking
 *    valendo, isso é fraude trivial. Nenhum tipo de request abaixo tem userId,
 *    e é de propósito: se você precisar dele, o desenho está errado.
 *
 * 2. O token vai no header Authorization, sempre. `authTokenProvider` é
 *    plugado pelo PrivyIsland no boot.
 */

/** Como a conta entrou. As duas primeiras cumprem "sign up through Solana". */
export type WalletSource = 'privy_embedded' | 'external' | 'simulated';

/**
 * De onde o replay saiu. `synthetic` é dev-only e nunca vai pra demo (§7 / regra da trilha).
 *
 * Espelha `CacheSource` do @palpitei/db de propósito: o selo tem que poder dizer a
 * VERDADE. O que o cache grava na prática é `txline-updates` (a linha do tempo de
 * /scores/updates — a única fonte que vale cachear); sem esse valor aqui, a única
 * saída era rotular a partida gravada como `txline-cache`, que é rótulo de
 * proveniência mentindo — o G6 literal. O CONTEXT §8 herdou a lista do v0 sem
 * `txline-updates`; quem está certo é o código que grava.
 */
export type ReplaySource =
  | 'txline-updates'
  | 'txline-cache'
  | 'txline-historical'
  | 'txline-snapshot'
  | 'txline-live'
  | 'synthetic';

export interface ApiUser {
  /** A identidade. Não é a carteira: a carteira muda, o DID não. */
  privyDid: string;
  nickname: string | null;
  level: number;
  xp: number;
  streak: number;
  /**
   * `null` = o fã entrou e NÃO ganhou carteira Solana. É a regressão E2 visível,
   * e o tipo a mantém visível de propósito: colapsar para 'simulated' marcaria um
   * fã real de Google como conta de teste da §5.1.
   */
  walletSource: WalletSource | null;
}

export interface ApiState {
  user: ApiUser;
  leaguesCount: number;
  isPremium: boolean;
}

export interface ApiFixture {
  id: string;
  live: boolean;
  status: string;
  group: string;
  teamA: string;
  teamB: string;
  scoreA: number | null;
  scoreB: number | null;
  /** Selo de origem do dado — a trilha exige a TxLINE como fonte primária. */
  source: 'txline' | ReplaySource;
}

/** Um palpite. Sem userId: quem responde é quem o Bearer diz que é. */
export interface PredictionRequest {
  questionId: string;
  optionId: string;
}

// ---------------------------------------------------------------------------
// Eventos do WS /ws
// ---------------------------------------------------------------------------

/**
 * Todo evento traz `ts` — o carimbo do evento da TxLINE. É ELE o relógio, não o
 * Date.now() do browser (CONTEXT.md §3). Em replay o `ts` ancora no último
 * evento emitido; um contador derivado do relógio de parede diverge do agendador
 * e fecha a janela sozinho — foi bug real no v0 (B2).
 */
interface WsBase {
  ts: number;
}

export interface ScoreEvent extends WsBase {
  type: 'score_event';
  minute: number;
  /** Bloco Score AUSENTE ≠ zero (A4): quando não vier, mantenha o placar anterior. */
  scoreA: number | null;
  scoreB: number | null;
  text: string;
}

export interface OddsEvent extends WsBase {
  type: 'odds_event';
  /** Arrays paralelos: confira o tamanho dos três antes de mapear (G8). */
  priceNames: string[];
  pct: number[];
}

export interface OddsExplainEvent extends WsBase {
  type: 'odds_explain';
  before: number;
  after: number;
  reading: string;
}

export interface QuestionOpenEvent extends WsBase {
  type: 'question_open';
  questionId: string;
  prompt: string;
  options: { id: string; label: string; pct: number | null }[];
  xp: number;
  /** Prazo em ts do FEED, não do browser. A janela fecha antes do lance que resolve. */
  closesAt: number;
}

export interface QuestionClosedEvent extends WsBase {
  type: 'question_closed';
  questionId: string;
}

export interface QuestionResolvedEvent extends WsBase {
  type: 'question_resolved';
  questionId: string;
  correctOptionId: string;
  gained: number;
}

/** Anulada: o lance resolvedor chegou com a janela ainda aberta. Sem XP, e é justo. */
export interface QuestionVoidEvent extends WsBase {
  type: 'question_void';
  questionId: string;
  reason: string;
}

export interface RankingEvent extends WsBase {
  type: 'ranking';
  rows: { name: string; xp: number; me?: boolean }[];
}

export interface GameEndEvent extends WsBase {
  type: 'game_end';
  scoreA: number;
  scoreB: number;
}

export interface ReplayDoneEvent extends WsBase {
  type: 'replay_done';
  source: ReplaySource;
}

export type WsEvent =
  | ScoreEvent
  | OddsEvent
  | OddsExplainEvent
  | QuestionOpenEvent
  | QuestionClosedEvent
  | QuestionResolvedEvent
  | QuestionVoidEvent
  | RankingEvent
  | GameEndEvent
  | ReplayDoneEvent;

// ---------------------------------------------------------------------------
// Cliente REST
// ---------------------------------------------------------------------------

type TokenProvider = () => Promise<string | null>;

let authTokenProvider: TokenProvider = async () => null;

/** O PrivyIsland pluga o getAccessToken aqui no boot. */
export function setAuthTokenProvider(fn: TokenProvider): void {
  authTokenProvider = fn;
}

/**
 * O Bearer, para quem NÃO consegue mandar header: o EventSource do SSE só aceita
 * URL. É por isso que o /stream é somente leitura — token em query entra em log
 * de proxy e em histórico. Palpite é POST, com o header, por aqui.
 */
export function getAuthToken(): Promise<string | null> {
  return authTokenProvider();
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await authTokenProvider();
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  // Sem token não há identidade — e sem identidade o servidor recusa. É o desenho.
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `falha em ${path}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  /** Bearer da Privy → find-or-create por DID. O corpo é vazio de propósito. */
  login: () => request<{ ok: true; user: ApiUser }>('/api/login', { method: 'POST', body: '{}' }),

  /** O fã escolhe o apelido. Nunca derive do e-mail (E12): o apelido é público. */
  setHandle: (nickname: string) =>
    request<{ ok: true; user: ApiUser }>('/api/account/handle', {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    }),

  state: () => request<ApiState>('/api/state'),

  fixtures: () => request<{ fixtures: ApiFixture[] }>('/api/fixtures'),

  joinRoom: (roomId: string) =>
    request<{ ok: true }>(`/api/rooms/${encodeURIComponent(roomId)}/join`, { method: 'POST' }),

  leaveRoom: (roomId: string) =>
    request<{ ok: true }>(`/api/rooms/${encodeURIComponent(roomId)}/leave`, { method: 'POST' }),

  predict: (roomId: string, body: PredictionRequest) =>
    request<{ ok: true }>(`/api/rooms/${encodeURIComponent(roomId)}/predictions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
