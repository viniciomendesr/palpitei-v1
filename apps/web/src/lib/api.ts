/** Client contracts. The server derives identity from a verified Bearer token; request bodies never carry `userId`. */

/** Account entry method. */
export type WalletSource = 'privy_embedded' | 'external' | 'simulated';

/** Replay provenance. `synthetic` is development-only and never used by demo mode. */
export type ReplaySource =
  | 'txline-updates'
  | 'txline-cache'
  | 'txline-historical'
  | 'txline-snapshot'
  | 'txline-live'
  | 'synthetic';

export interface ApiUser {
  /** Stable identity; wallets may change. */
  privyDid: string;
  nickname: string | null;
  level: number;
  xp: number;
  streak: number;
  /** `null` means the user has no Solana wallet; it must not be represented as simulated. */
  walletSource: WalletSource | null;
}

/** Prediction outcome totals settled by the engine. */
export interface ApiStats {
  total: number;
  acertos: number;
  erros: number;
  anuladas: number;
  abertos: number;
  xpDePalpites: number;
}

export interface ApiState {
  user: ApiUser;
  leaguesCount: number;
  isPremium: boolean;
  stats: ApiStats;
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
  /** Data provenance displayed to the user. */
  source: 'txline' | ReplaySource;
  /** Training rooms do not persist state or award XP. */
  training?: boolean;
}

export interface LobbyState {
  type: 'lobby_state';
  roomId: string;
  partyId: string;
  fixtureId: number;
  training: boolean;
  teamA: string;
  teamB: string;
  phase: 'waiting' | 'started' | 'finished';
  meReady: boolean;
  meHost: boolean;
  players: {
    name: string;
    ready: boolean;
    host: boolean;
    me: boolean;
    presence: 'watching' | 'away' | 'left';
  }[];
}

export interface ApiLobbyPreview {
  inviteCode: string;
  roomId: string;
  training: boolean;
  teamA: string;
  teamB: string;
  memberCount: number;
  maxPlayers: number;
  /** Present on the invite preview: a running match still accepts a late friend. */
  phase?: 'waiting' | 'started' | 'finished';
}

/** Private league summary backed by persisted membership. */
export interface ApiLeague {
  id: string;
  name: string;
  memberCount: number;
  /** Leader status is server-derived. */
  iLead: boolean;
  /** Invite code is returned only to members. */
  inviteCode: string;
}

/** League list and free-tier entitlement data. */
export interface ApiLeagues {
  leagues: ApiLeague[];
  /** Created leagues; joining another league does not consume this quota. */
  ownedCount: number;
  freeLimit: number;
  isPremium: boolean;
}

export interface ApiLeagueDetail {
  league: ApiLeague & { iLead: boolean };
  /** `null` handle means no nickname yet; email is never exposed. */
  members: { handle: string | null; iLead: boolean; me: boolean }[];
}

/** Global ranking row. `pos: null` represents the current user outside the ranked cutoff. */
export interface ApiRankRow {
  pos: number | null;
  name: string;
  xp: number;
  level: number;
  me: boolean;
}

/** Prediction request; the server derives the user from the Bearer token. */
export interface PredictionRequest {
  questionId: string;
  optionId: string;
}

// ---------------------------------------------------------------------------
// Pre-game prediction
// ---------------------------------------------------------------------------

/** POST body includes only markets changed by the user. */
export interface PregamePickRequest {
  result?: 'home' | 'draw' | 'away' | null;
  scoreA?: number;
  scoreB?: number;
  scoreSet?: boolean;
  goals?: 'over' | 'under' | null;
  /** TxLINE line displayed for total goals. */
  goalsLine?: number | null;
  corners?: 'over' | 'under' | null;
  /** TxLINE line displayed for total corners. */
  cornersLine?: number | null;
}

/** Persisted pre-game prediction; timestamps use epoch milliseconds. */
export interface PregamePick {
  id: string;
  userId: string;
  fixtureId: number;
  result: 'home' | 'draw' | 'away' | null;
  scoreA: number;
  scoreB: number;
  scoreSet: boolean;
  goals: 'over' | 'under' | null;
  goalsLine: number | null;
  corners: 'over' | 'under' | null;
  cornersLine: number | null;
  submittedAt: number | null;
  settledAt: number | null;
  resultCorrect: boolean | null;
  scoreCorrect: boolean | null;
  goalsCorrect: boolean | null;
  cornersCorrect: boolean | null;
  awardedXp: number | null;
}

/** Safe market projection from TxLINE, without licensed raw payloads. */
export type PregameMarket =
  | {
      id: 'result';
      kind: 'result';
      options: { id: 'home' | 'draw' | 'away'; pct: number }[];
    }
  | {
      id: 'goals' | 'corners';
      kind: 'over_under';
      line: number;
      options: { id: 'over' | 'under'; pct: number }[];
    };

export interface PregameView {
  match: {
    fixtureId: number;
    teamA: string;
    teamB: string;
    startTs: number | null;
    competition: string | null;
    state: 'scheduled' | 'live' | 'finished' | 'cancelled';
  };
  pick: PregamePick | null;
  /** Current TxLINE markets; an empty list means no usable quote was available. */
  markets: PregameMarket[];
  /** `false` means the TxLINE read failed, not that no market exists. */
  txlineOddsAvailable: boolean;
  /** Locks the view after kickoff or when the fixture leaves its scheduled state. */
  locked: boolean;
  finished: boolean;
  /** Final score and corners, available only after the fixture ends. */
  final: { goalsA: number; goalsB: number; cornersTotal: number } | null;
}

// ---------------------------------------------------------------------------
// WebSocket events
// ---------------------------------------------------------------------------

/** Event time comes from TxLINE; client wall-clock time must not drive game windows. */
interface WsBase {
  ts: number;
}

export interface ScoreEvent extends WsBase {
  type: 'score_event';
  minute: number;
  /** Missing score is not zero; retain the previous score. */
  scoreA: number | null;
  scoreB: number | null;
  text: string;
}

export interface OddsEvent extends WsBase {
  type: 'odds_event';
  /** Parallel arrays must have matching lengths before mapping. */
  priceNames: string[];
  pct: number[];
}

/** Shared chance reading. The client renders structured fields; `text` is fallback/logging only. */
export interface OddsExplainEvent extends WsBase {
  type: 'odds_explain';
  /** TxLINE message ID plus option, stable when events share a timestamp. */
  id: string;
  minute: number | null;
  priceName: string;
  fromPct: number;
  toPct: number;
  /** Structured cause; omitted when no event occurred in the engine window. */
  contextAction?: string;
  text: string;
}

export interface QuestionOpenEvent extends WsBase {
  type: 'question_open';
  questionId: string;
  prompt: string;
  options: { id: string; label: string; pct: number | null }[];
  xp: number;
  /** Feed-time deadline; the window closes before the resolving event. */
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

/** Voided when the resolving event arrives before the prediction window closes; awards no XP. */
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
// REST client
// ---------------------------------------------------------------------------

type TokenProvider = () => Promise<string | null>;

let authTokenProvider: TokenProvider = async () => null;

/** PrivyIsland registers `getAccessToken` during bootstrap. */
export function setAuthTokenProvider(fn: TokenProvider): void {
  authTokenProvider = fn;
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
  // Requests without a token remain anonymous and are rejected by protected endpoints.
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
  /** Privy Bearer token identifies the account by DID; the body is intentionally empty. */
  login: () => request<{ ok: true; user: ApiUser }>('/api/login', { method: 'POST', body: '{}' }),

  /** Public nickname selected by the user; never derive it from email. */
  setHandle: (nickname: string) =>
    request<{ ok: true; user: ApiUser }>('/api/account/handle', {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    }),

  state: () => request<ApiState>('/api/state'),

  /** Global ranking: top 50 plus the current user when outside the cutoff. */
  ranking: () => request<{ rows: ApiRankRow[] }>('/api/ranking'),

  /** User leagues and free-tier entitlement data. */
  leagues: () => request<ApiLeagues>('/api/leagues'),

  /** Creates a league for the Bearer-derived owner; 402 signals the free-tier limit. */
  createLeague: (name: string) =>
    request<{ ok: true; league: ApiLeague }>('/api/leagues', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  /** Joins by invite code without consuming the creator quota. */
  joinLeague: (code: string) =>
    request<{ ok: true; league: { id: string; name: string; memberCount: number } }>(
      '/api/leagues/join',
      { method: 'POST', body: JSON.stringify({ code }) },
    ),

  /** Returns 404 for non-members and nonexistent leagues to avoid existence disclosure. */
  league: (id: string) => request<ApiLeagueDetail>(`/api/leagues/${encodeURIComponent(id)}`),

  /** Deletes a leader-owned league; non-members receive the same 404 as nonexistent leagues. */
  deleteLeague: (id: string) =>
    request<{ ok: true }>(`/api/leagues/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  fixtures: () => request<{ fixtures: ApiFixture[] }>('/api/fixtures'),

  /** Reads and saves the pre-game prediction state. */
  pregame: {
    get: (fixtureId: number) => request<PregameView>(`/api/pregame/${fixtureId}`),
    save: (fixtureId: number, body: PregamePickRequest) =>
      request<{ ok: true; pick: PregamePick; xpAtStake: number }>(`/api/pregame/${fixtureId}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  createLobby: (roomId: string) =>
    request<{ ok: true; lobby: ApiLobbyPreview }>('/api/lobbies', {
      method: 'POST',
      body: JSON.stringify({ roomId }),
    }),

  previewLobby: (code: string) =>
    request<{ lobby: ApiLobbyPreview }>(`/api/lobbies/${encodeURIComponent(code)}`),

  joinLobby: (code: string) =>
    request<{ ok: true; lobby: { inviteCode: string; roomId: string } }>(
      `/api/lobbies/${encodeURIComponent(code)}`,
      { method: 'POST', body: '{}' },
    ),

  lobbyReady: (roomId: string, partyId: string, ready: boolean) =>
    request<{ ok: true }>(
      `/api/rooms/${encodeURIComponent(roomId)}/lobby?party=${encodeURIComponent(partyId)}`,
      { method: 'POST', body: JSON.stringify({ action: 'ready', ready }) },
    ),

  lobbyStart: (roomId: string, partyId: string) =>
    request<{ ok: true }>(
      `/api/rooms/${encodeURIComponent(roomId)}/lobby?party=${encodeURIComponent(partyId)}`,
      { method: 'POST', body: JSON.stringify({ action: 'start' }) },
    ),

  lobbyLeave: (roomId: string, partyId: string) =>
    request<{ ok: true }>(
      `/api/rooms/${encodeURIComponent(roomId)}/lobby?party=${encodeURIComponent(partyId)}`,
      { method: 'POST', body: JSON.stringify({ action: 'leave' }) },
    ),

  lobbyFinish: (roomId: string, partyId: string) =>
    request<{ ok: true }>(
      `/api/rooms/${encodeURIComponent(roomId)}/lobby?party=${encodeURIComponent(partyId)}`,
      { method: 'POST', body: JSON.stringify({ action: 'finish' }) },
    ),

  /** Exchanges the Bearer token for a short-lived, single-use, room-scoped SSE ticket. */
  sseTicket: (roomId: string, partyId: string, purpose: 'lobby' | 'room') =>
    request<{ ticket: string }>(
      `/api/rooms/${encodeURIComponent(roomId)}/sse-ticket?party=${encodeURIComponent(partyId)}`,
      { method: 'POST', body: JSON.stringify({ purpose }) },
    ),

  joinRoom: (roomId: string) =>
    request<{ ok: true }>(`/api/rooms/${encodeURIComponent(roomId)}/join`, { method: 'POST' }),

  leaveRoom: (roomId: string) =>
    request<{ ok: true }>(`/api/rooms/${encodeURIComponent(roomId)}/leave`, { method: 'POST' }),

  predict: (roomId: string, partyId: string, body: PredictionRequest) =>
    request<{ ok: true }>(`/api/rooms/${encodeURIComponent(roomId)}/predictions?party=${encodeURIComponent(partyId)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
