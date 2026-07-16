// Tipos compartilhados do @palpitei/core. Este arquivo é o CONTRATO entre os
// módulos (ingestão, motores, salas, servidor, UI). Mudou aqui, mudou em todo lugar.

// ---------------------------------------------------------------------------
// Eventos normalizados (saída de ./normalize.ts)
// ---------------------------------------------------------------------------

export type ScoreEvent = {
  kind: "score";
  fixtureId: number;
  seq: number;
  ts: number; // epoch ms do feed (linha do tempo da partida)
  action: string; // goal, corner, shot, kickoff, halftime_finalised, game_finalised, ...
  statusId?: number;
  period?: number; // 100 junto com statusId=100 => fim de jogo
  gameStateRaw?: string | number;
  clockRunning?: boolean;
  clockSeconds?: number;
  // Nem todo evento do feed carrega o bloco Score (ex.: kickoff, lineups).
  // hasScore=false => goals/corners abaixo são placeholder 0 e NÃO valem como placar.
  hasScore: boolean;
  goals: { p1: number; p2: number }; // Score.ParticipantN.Total.Goals
  corners: { p1: number; p2: number }; // Score.ParticipantN.Total.Corners
  // Bloco Score.ParticipantN.Total inteiro (só campos numéricos): Goals,
  // Corners, YellowCards, RedCards, Shots… O conjunto varia por partida, por
  // isso é um mapa aberto. Os motores usam goals/corners; a UI mostra o resto.
  // Opcional: evento sem bloco Score não tem totais (A4), e o replay sintético
  // não os gera.
  totals?: { p1: Record<string, number>; p2: Record<string, number> };
  data?: any; // detalhe da ação (Outcome de chute/pênalti, etc.)
  raw: any;
};

export type OddsEvent = {
  kind: "odds";
  fixtureId: number;
  ts: number;
  // STRING, não número: o MessageId real é estruturado
  // ("1837922149:00003:000572-10021-stab") e Number() dele é NaN. Parser
  // numérico aqui zera a chave de dedupe e colapsa a série inteira num único
  // registro, sem erro nenhum (v0, G2). Igual a packages/db (OddsEvent.messageId).
  messageId?: string;
  marketType: string; // SuperOddsType, ex.: OVERUNDER_PARTICIPANT_GOALS
  marketPeriod?: string | number;
  line?: number; // MarketParameters.line, se houver
  inRunning?: boolean;
  bookmaker?: string;
  prices: { name: string; odds: number; pct: number }[]; // odds já divididas por 1000
  raw: any;
};

export type NormEvent = ScoreEvent | OddsEvent;

// ---------------------------------------------------------------------------
// Domínio
// ---------------------------------------------------------------------------

export type Fixture = {
  fixtureId: number;
  p1: string;
  p2: string;
  p1Id?: number;
  p2Id?: number;
  competition?: string;
  competitionId?: number;
  startTime?: number; // epoch ms
  gameState?: number; // 1 = agendada, 6 = cancelada
  raw?: any;
};

// De onde veio a carteira do usuário:
//   simulated      = modo demo (regra §5.1: o jurado testa sem criar carteira)
//   privy_embedded = Opção A: carteira provisionada pela Privy no login social
//   external       = Opção B: o usuário entrou COM a carteira dele (Phantom,
//                    Solflare, Backpack); a chave é dele e o servidor nunca a vê.
// As duas primeiras cumprem "sign up through Solana".
export type WalletSource = "simulated" | "privy_embedded" | "external";

export type User = {
  id: string;
  // Público (ranking/ligas). NUNCA derivado do e-mail — o onboarding pergunta.
  handle: string;
  wallet: string; // pubkey Solana (base58)
  walletSource: WalletSource;
  // DID da Privy (did:privy:...) — a identidade de verdade. Ausente no modo demo.
  privyId?: string;
  // Carteiras externas vinculadas ao MESMO DID. Portabilidade de entrada.
  linkedWallets?: string[];
  xp: number;
  level: number;
  balanceCents: number; // USDC simulado em centavos inteiros (prévia da v2)
  createdAt: number;
};

export type QuestionType = "final_result" | "next_goal" | "hilo_corners";

export type QuestionOption = { id: string; label: string };

export type Question = {
  id: string;
  fixtureId: number;
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  opensAt: number; // linha do tempo da partida (ts do feed)
  closesAt: number;
  state: "open" | "closed" | "resolved" | "void";
  correct?: string; // option id vencedora
  voidReason?: string;
  resolvedAt?: number;
  resolvedBySeq?: number;
};

export type Prediction = {
  id: string;
  userId: string;
  questionId: string;
  choice: string; // option id
  placedAt: number; // linha do tempo da partida
  result?: "won" | "lost" | "void";
  awardedXp?: number;
};

// Prévia da v2 — mercado paramutuel com USDC simulado. Não há dinheiro real na v1.
export type MarketOutcome = "p1" | "draw" | "p2";

export type Market = {
  id: string;
  fixtureId: number;
  kind: "resultado_final";
  labels: Record<MarketOutcome, string>;
  rakeBps: number; // taxa da casa em basis points (500 = 5%)
  closesAt: number | null; // definido no kickoff
  state: "open" | "closed" | "resolved";
  pools: Record<MarketOutcome, number>; // centavos
  winner?: MarketOutcome;
  payouts?: { userId: string; amountCents: number }[];
  refunded?: boolean; // true quando ninguém acertou e houve reembolso
  proof?: any; // recibo: prova de Merkle da TxLINE (stat-validation)
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

// ---------------------------------------------------------------------------
// Mensagens de sala (servidor -> UI via WebSocket). type discrimina o formato.
// question_open leva closesInRealMs (ms REAIS até fechar, já convertidos pela
// velocidade do replay) para a UI animar o cronômetro sem conhecer o clock.
// ---------------------------------------------------------------------------

export type RoomMessage = { type: string; [k: string]: any };

export type EngineEmit = (msg: RoomMessage) => void;
