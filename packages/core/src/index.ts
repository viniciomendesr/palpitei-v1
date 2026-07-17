// @palpitei/core — motores puros de domínio.
//
// Regras que este pacote sustenta e que não se negociam:
//   - Nenhum motor lê Date.now(): o tempo vem do ts do evento, via Clock.
//   - Nenhum motor conhece banco: persistência entra por EnginePorts (injeção).
//   - Nada de I/O, nada de rede, nada de singleton. É tudo determinístico.
//
// O pacote é consumido CRU (exports -> ./src/index.ts, via transpilePackages do
// Next). Por isso todo import relativo carrega a extensão ".ts" de verdade.

export type { Clock, ReplayCursor } from "./clock.ts";
export { cursorClock, liveClock, manualClock, replayClock } from "./clock.ts";

export type { EnginePorts } from "./ports.ts";

export type {
  Bet,
  EngineEmit,
  Fixture,
  Market,
  MarketOutcome,
  NormEvent,
  OddsEvent,
  Prediction,
  Question,
  QuestionOption,
  QuestionType,
  RoomMessage,
  ScoreEvent,
  User,
  WalletSource,
} from "./types.ts";

export type { ResolvedResult } from "./questions.ts";
export {
  FAIRNESS_VOID_REASON,
  HILO_HORIZON_MS,
  MIN_REAL_WINDOW_MS,
  QuestionEngine,
  WINDOW_FINAL_MS,
  WINDOW_HILO_MS,
  WINDOW_NEXT_GOAL_MS,
} from "./questions.ts";

export { MarketEngine, START_BALANCE_CENTS } from "./markets.ts";
export { XP_BASE } from "./questions.ts";

export { addXp, levelForXp, Ranking } from "./ranking.ts";

export { OddsExplainer } from "./explain.ts";

export { normalizeOdds, normalizeScore } from "./normalize.ts";
