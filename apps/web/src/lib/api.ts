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
  /** Time do coração — escolha do onboarding, null = não escolheu (ou pulou). */
  favTeam: string | null;
  /**
   * `null` = o fã entrou e NÃO ganhou carteira Solana. É a regressão E2 visível,
   * e o tipo a mantém visível de propósito: colapsar para 'simulated' marcaria um
   * fã real de Google como conta de teste da §5.1.
   */
  walletSource: WalletSource | null;
}

/** Aproveitamento dos palpites, contado pela tabela que o MOTOR liquida. */
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
  /** Selo de origem do dado — a trilha exige a TxLINE como fonte primária. */
  source: 'txline' | ReplaySource;
  /** Sala de TREINO: mesma partida, XP sempre 0, nada persistido. */
  treino?: boolean;
}

export interface LobbyState {
  type: 'lobby_state';
  roomId: string;
  partyId: string;
  fixtureId: number;
  treino: boolean;
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
  treino: boolean;
  teamA: string;
  teamB: string;
  memberCount: number;
  maxPlayers: number;
}

/**
 * Uma liga privada, como a home a lista.
 *
 * `memberCount` vem do banco — o "1 membro" da tela era string fixa do
 * dicionário (`myLeagueSub`), e o `ligaSub: '8 amigos · você lidera'` é número
 * inventado que ninguém nunca contou. Este campo existe para que o número seja
 * o que o banco tem, ou nada.
 */
export interface ApiLeague {
  id: string;
  name: string;
  memberCount: number;
  /** Quem lidera sai da tabela, não de comparar ids na tela. */
  iLead: boolean;
  /** O convite. Só chega aqui para quem já é membro: a rota só lista as suas. */
  inviteCode: string;
}

/** O que a home precisa para listar as ligas E decidir o gate do free. */
export interface ApiLeagues {
  leagues: ApiLeague[];
  /** Ligas CRIADAS. Entrar na de um amigo não gasta a cota — ver /api/leagues/join. */
  ownedCount: number;
  freeLimit: number;
  isPremium: boolean;
}

export interface ApiLeagueDetail {
  league: ApiLeague & { iLead: boolean };
  /** `handle` null = ainda sem apelido. A tela diz "sem apelido" (E12: nunca o e-mail). */
  members: { handle: string | null; iLead: boolean; me: boolean }[];
}

/**
 * Uma linha do ranking global. `pos: null` = a minha linha fora do top — a
 * posição exata de quem está além do corte não é calculada (e a tela diz "—").
 * Sem userId de ninguém: apelido é o único nome que atravessa (E12).
 */
export interface ApiRankRow {
  pos: number | null;
  name: string;
  xp: number;
  level: number;
  me: boolean;
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

/**
 * A leitura de chance, broadcast IGUAL para todos (publicarBruto). A frase da
 * tela é redigida no cliente pelos campos estruturados (lib/chances.ts);
 * `text` é a frase pt do core — fallback/log, não a frase do fã.
 */
export interface OddsExplainEvent extends WsBase {
  type: 'odds_explain';
  /** MessageId da TxLINE + opção, estável mesmo quando dois eventos têm o mesmo ts. */
  id: string;
  minute: number | null;
  priceName: string;
  fromPct: number;
  toPct: number;
  /** A causa em FORMA ('goal', 'corner'…): ausente = sem lance na janela de
   *  3 min do core — e aí a frase sai SEM causa, nunca com uma inventada. */
  contextAction?: string;
  text: string;
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

  /** O time do coração. `null` limpa — o passo é pulável, e "pulei" não é um time. */
  setFavoriteTeam: (team: string | null) =>
    request<{ ok: true; favTeam: string | null }>('/api/account/team', {
      method: 'POST',
      body: JSON.stringify({ team }),
    }),

  state: () => request<ApiState>('/api/state'),

  /** O ranking global (top 50 + a minha linha, se eu estiver fora do corte). */
  ranking: () => request<{ rows: ApiRankRow[] }>('/api/ranking'),

  /** As ligas do fã + o que o gate do free precisa saber. */
  leagues: () => request<ApiLeagues>('/api/leagues'),

  /**
   * Cria a liga. Sem `ownerId` no corpo: o dono é o Bearer.
   * 402 quando o free já tem a dele — é o paywall, e a tela leva ao /premium.
   */
  createLeague: (name: string) =>
    request<{ ok: true; league: ApiLeague }>('/api/leagues', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  /** Entra pelo código do convite. Não gasta a cota do free: a cota é de quem CRIA. */
  joinLeague: (code: string) =>
    request<{ ok: true; league: { id: string; name: string; memberCount: number } }>(
      '/api/leagues/join',
      { method: 'POST', body: JSON.stringify({ code }) },
    ),

  /** A liga por dentro. 404 se você não é membro — o mesmo 404 de liga inexistente. */
  league: (id: string) => request<ApiLeagueDetail>(`/api/leagues/${encodeURIComponent(id)}`),

  /**
   * Apaga a liga — só o líder. Membro que não lidera leva 403; quem não é
   * membro leva o MESMO 404 de liga inexistente (apagar não vaza existência).
   * Apagar devolve a cota do free: ela conta ligas CRIADAS, e a linha some.
   */
  deleteLeague: (id: string) =>
    request<{ ok: true }>(`/api/leagues/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  fixtures: () => request<{ fixtures: ApiFixture[] }>('/api/fixtures'),

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
