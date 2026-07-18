// Domain types persisted and read by the repository layer.
// Structural compatibility with core avoids a circular dependency.
// TxLINE messageId values are opaque strings because structured IDs are not numeric.

export type WalletSource = 'privy_embedded' | 'external' | 'simulated';

export type User = {
  id: string;
  handle: string | null; // Null until onboarding collects it; never derive it from email.
  wallet: string | null; // pubkey Solana (base58)
  // Null means the fan has no wallet; it is not 'simulated'.
  //
  // Privy social login may have no Solana wallet. Preserve null rather than
  // inventing a simulated wallet source.
  walletSource: WalletSource | null;
  privyId: string; // DID: 'did:privy:...' ou 'demo:...' no modo demo
  isPremium: boolean;
  xp: number;
  level: number; // derivado do xp pelo banco — leitura apenas
  currentStreak: number;
  bestStreak: number;
  balanceCents: number;
  linkedWallets: string[];
  createdAt: number;
};

export type Fixture = {
  fixtureId: number;
  p1: string;
  p2: string;
  p1Id?: number;
  p2Id?: number;
  competition?: string;
  competitionId?: number;
  startTime?: number; // Epoch ms; anchor for the final-question window.
  gameState?: number;
  state?: MatchState;
  /**
   * Undefined means the match came from the live feed or snapshot rather than
   * the local cache, allowing callers to show accurate provenance.
   */
  cacheSource?: CacheSource;
  raw?: unknown;
};

export type MatchState = 'scheduled' | 'live' | 'finished' | 'cancelled';

export type CacheSource =
  | 'txline-updates'
  | 'txline-cache'
  | 'txline-historical'
  | 'txline-snapshot'
  | 'txline-live'
  | 'synthetic';

export type ScoreEvent = {
  kind: 'score';
  fixtureId: number;
  seq: number;
  ts: number;
  action: string;
  statusId?: number;
  period?: number;
  gameStateRaw?: string | number;
  clockRunning?: boolean;
  clockSeconds?: number;
  // False means the event omitted Score. goals/corners are placeholders, not scores.
  hasScore: boolean;
  goals: { p1: number; p2: number };
  corners: { p1: number; p2: number };
  totals?: { p1: Record<string, number>; p2: Record<string, number> };
  data?: unknown;
  raw: unknown;
};

export type OddsEvent = {
  kind: 'odds';
  fixtureId: number;
  ts: number;
  messageId?: string; // Opaque string identifier.
  marketType: string;
  marketPeriod?: string | number;
  line?: number;
  inRunning?: boolean;
  bookmaker?: string;
  prices: { name: string; odds: number; pct: number }[];
  raw: unknown;
};

export type NormEvent = ScoreEvent | OddsEvent;

export type QuestionType = 'final_result' | 'next_goal' | 'hilo_corners';
export type QuestionOption = { id: string; label: string };
export type QuestionTemplateRef = { id: string; version: number };

export type Question = {
  id: string;
  fixtureId: number;
  sessionId?: string;
  template?: QuestionTemplateRef;
  triggerKey?: string;
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  opensAt: number; // ts de PARTIDA
  closesAt: number;
  state: 'open' | 'closed' | 'resolved' | 'void';
  correct?: string;
  voidReason?: string;
  resolvedAt?: number;
  resolvedBySeq?: number;
};

export type Prediction = {
  id: string;
  userId: string;
  questionId: string;
  choice: string;
  placedAt: number;
  result?: 'won' | 'lost' | 'void';
  awardedXp?: number;
};

export type MarketOutcome = 'p1' | 'draw' | 'p2';

export type Market = {
  id: string;
  fixtureId: number;
  kind: string;
  labels: Record<MarketOutcome, string>;
  rakeBps: number;
  closesAt: number | null;
  state: 'open' | 'closed' | 'resolved';
  pools: Record<MarketOutcome, number>;
  winner?: MarketOutcome;
  payouts?: { userId: string; amountCents: number }[];
  refunded?: boolean;
  proof?: unknown;
  proofError?: string;
};

export type Bet = {
  id: string;
  marketId: string;
  userId: string;
  outcome: MarketOutcome;
  amountCents: number;
  ts: number;
  payoutCents?: number;
};

// Full match timeline. v1 stores it in Postgres rather than the public repository.
export type MatchCache = {
  fixtureId: number;
  p1: string;
  p2: string;
  startTime: number;
  gravadoEm: number;
  fonte: CacheSource;
  scores: unknown[];
  odds: unknown[];
};

export type Achievement = {
  code: string;
  title: string;
  description: string;
  xpReward: number;
  sortOrder: number;
  active: boolean;
  unlockedAt?: number;
};

export type Mission = {
  code: string;
  title: string;
  description: string;
  kind: 'daily' | 'season';
  target: number;
  xpReward: number;
  sortOrder: number;
  active: boolean;
  progress?: number;
  completedAt?: number;
};

/** League role. The creator is the sole owner (enforced by a partial index). */
export type LeagueRole = 'owner' | 'member';

export type League = {
  id: string;
  name: string;
  ownerId: string;
  /** Invitation credential, returned only to existing members. */
  inviteCode: string;
  /**
   * Counted in the database so the UI does not rely on a static label.
   */
  memberCount: number;
  createdAt: number;
};

export type LeagueMember = {
  userId: string;
  /**
   * Null until the fan chooses a handle. Never expose or derive an email address.
   */
  handle: string | null;
  role: LeagueRole;
  joinedAt: number;
};

export type LobbyPhase = 'waiting' | 'started' | 'finished' | 'cancelled' | 'expired';
export type LobbyRole = 'host' | 'player';

export type Lobby = {
  id: string;
  inviteCode: string;
  fixtureId: number;
  treino: boolean;
  hostUserId: string;
  phase: LobbyPhase;
  maxPlayers: number;
  memberCount: number;
  expiresAt: number;
  createdAt: number;
};
