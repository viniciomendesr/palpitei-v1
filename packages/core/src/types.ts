// Shared @palpitei/core contracts for ingestion, engines, rooms, server, and UI.
// Normalized events are produced by ./normalize.ts.

export type ScoreEvent = {
  kind: "score";
  fixtureId: number;
  seq: number;
  ts: number; // feed epoch milliseconds on the match timeline
  action: string; // goal, corner, shot, kickoff, halftime_finalised, game_finalised, ...
  statusId?: number;
  period?: number; // 100 with statusId=100 marks game end
  gameStateRaw?: string | number;
  clockRunning?: boolean;
  clockSeconds?: number;
  // Not every feed event includes Score. When hasScore=false, goals and corners
  // are placeholders and must not be treated as the score.
  hasScore: boolean;
  goals: { p1: number; p2: number }; // Score.ParticipantN.Total.Goals
  corners: { p1: number; p2: number }; // Score.ParticipantN.Total.Corners
  // Numeric fields from Score.ParticipantN.Total. The available set varies by
  // fixture; engines use goals/corners and the UI can render the remainder.
  totals?: { p1: Record<string, number>; p2: Record<string, number> };
  data?: any; // action detail (shot or penalty outcome, etc.)
  raw: any;
};

export type OddsEvent = {
  kind: "odds";
  fixtureId: number;
  ts: number;
  // String, not number: real message IDs are structured and form the
  // deduplication key. Keep this consistent with packages/db OddsEvent.messageId.
  messageId?: string;
  marketType: string; // SuperOddsType, e.g. OVERUNDER_PARTICIPANT_GOALS
  marketPeriod?: string | number;
  line?: number; // MarketParameters.line, when available
  inRunning?: boolean;
  bookmaker?: string;
  prices: { name: string; odds: number; pct: number }[]; // odds already divided by 1000
  raw: any;
};

export type NormEvent = ScoreEvent | OddsEvent;

export type Fixture = {
  fixtureId: number;
  p1: string;
  p2: string;
  p1Id?: number;
  p2Id?: number;
  competition?: string;
  competitionId?: number;
  startTime?: number; // epoch milliseconds
  gameState?: number; // 1 = scheduled, 6 = cancelled
  raw?: any;
};

// User wallet origin. External wallets remain user-controlled; the server never
// receives their private key.
export type WalletSource = "simulated" | "privy_embedded" | "external";

export type User = {
  id: string;
  // Public ranking/league handle. Never derive it from email.
  handle: string;
  wallet: string; // Solana public key (base58)
  walletSource: WalletSource;
  // Privy DID is the canonical identity. It is absent in demo mode.
  privyId?: string;
  // External wallets linked to the same DID.
  linkedWallets?: string[];
  xp: number;
  level: number;
  balanceCents: number; // simulated USDC in integer cents (v2 preview)
  createdAt: number;
};

export type QuestionType = "final_result" | "next_goal" | "hilo_corners";

export type QuestionOption = { id: string; label: string };

/** Versioned template definition pinned for the entire session. */
export type QuestionTemplateRef = { id: string; version: number };

export type Question = {
  id: string;
  fixtureId: number;
  /** Social game session that owns this question; absent only for legacy data. */
  sessionId?: string;
  template?: QuestionTemplateRef;
  /** Deterministic trigger key used for idempotent reprocessing. */
  triggerKey?: string;
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  opensAt: number; // feed timestamp on the match timeline
  closesAt: number;
  state: "open" | "closed" | "resolved" | "void";
  correct?: string; // winning option ID
  voidReason?: string;
  resolvedAt?: number;
  resolvedBySeq?: number;
};

export type Prediction = {
  id: string;
  userId: string;
  questionId: string;
  choice: string; // option ID
  placedAt: number; // match-timeline timestamp
  result?: "won" | "lost" | "void";
  awardedXp?: number;
};

// v2 preview: simulated-USDC parimutuel market. v1 has no real money.
export type MarketOutcome = "p1" | "draw" | "p2";

export type Market = {
  id: string;
  fixtureId: number;
  kind: "resultado_final";
  labels: Record<MarketOutcome, string>;
  rakeBps: number; // house rake in basis points (500 = 5%)
  closesAt: number | null; // set at kickoff
  state: "open" | "closed" | "resolved";
  pools: Record<MarketOutcome, number>; // cents
  winner?: MarketOutcome;
  payouts?: { userId: string; amountCents: number }[];
  refunded?: boolean; // true when no one won and bets were refunded
  proof?: any; // TxLINE Merkle proof receipt (stat-validation)
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

// Room messages (server to UI via WebSocket). question_open includes
// closesInRealMs so the UI can animate its timer without knowing the clock.

export type RoomMessage = { type: string; [k: string]: any };

export type EngineEmit = (msg: RoomMessage) => void;
