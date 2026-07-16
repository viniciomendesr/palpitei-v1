// Tipos do domínio que a camada de repositório grava e lê.
//
// POR QUE ESTES TIPOS VIVEM AQUI, E NÃO SÃO IMPORTADOS DE @palpitei/core:
// eles espelham, campo a campo, o contrato provado do v0 (src/core/types.ts).
// TypeScript é ESTRUTURAL: se o core declarar as mesmas formas, as funções
// deste pacote satisfazem as interfaces dele sem nenhum import — e os dois
// pacotes podem ser escritos em paralelo sem travar o build um do outro.
// Se um dia as formas divergirem, o erro aparece no ponto de ligação
// (apps/web), em vermelho, na compilação. É um erro barulhento — não silencioso.
//
// UMA DIFERENÇA DELIBERADA em relação ao v0: `messageId` aqui é STRING.
// No v0 era `number`, e passar o MessageId ("1837922149:00003:000572-10021-stab")
// por Number() devolvia -1 para todos, colapsando a série inteira num único
// registro. O banco guarda TEXT justamente por isso.

export type WalletSource = 'privy_embedded' | 'external' | 'simulated';

export type User = {
  id: string;
  handle: string | null; // NULL até o onboarding pedir. Nunca derive do e-mail (E12).
  wallet: string | null; // pubkey Solana (base58)
  // NULL = o fã não tem carteira. NÃO é 'simulated'.
  //
  // O `createOnLogin` da Privy defaulta a 'off' (E2): o login social entra e o fã
  // fica SEM carteira Solana. O banco guarda NULL de propósito para essa
  // regressão ficar VISÍVEL. Colapsar NULL para 'simulated' na leitura seria
  // inventar a origem que o schema recusa a inventar — e ainda marcaria o fã
  // real como modo demo (§5.1), que é justamente o que NÃO cumpre
  // "sign up through Solana".
  walletSource: WalletSource | null;
  privyId: string; // DID: 'did:privy:...' ou 'demo:...' no modo demo
  favoriteTeam: string | null;
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
  startTime?: number; // epoch ms — âncora da janela do desafio final (G4)
  gameState?: number;
  state?: MatchState;
  /**
   * De onde esta partida veio, quando veio do cache. O banco sempre soube
   * (coluna `cache_source`, e o COLS do matchRepo já a lia) — mas o mapper
   * descartava, e por isso a tela não TINHA como dizer a verdade sobre a
   * origem. A §2 exige selo de fonte em cada sala e o G6 diz que rótulo de
   * proveniência não pode mentir: sem este campo, só sobrava chutar.
   * `undefined` = veio do feed ao vivo/snapshot, não do cache.
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
  // false => o evento não trouxe o bloco Score. goals/corners são placeholder e
  // NÃO valem como placar (A4: ausente ≠ zero).
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
  messageId?: string; // STRING (ver cabeçalho)
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

export type Question = {
  id: string;
  fixtureId: number;
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

// A timeline completa de uma partida — o que o v0 gravava em .cache/fixtures/.
// Na v1 isso mora no Postgres (T&C §7: payload da TxLINE não vai para o repo).
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
