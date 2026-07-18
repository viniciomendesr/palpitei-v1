// Pure domain engines. Time and persistence are injected; this package performs
// no I/O. Source exports are consumed through Next.js transpilePackages.

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
  QuestionTemplateRef,
  QuestionType,
  RoomMessage,
  ScoreEvent,
  User,
  WalletSource,
} from "./types.ts";

export type { QuestionEngineSnapshot, ResolvedResult } from "./questions.ts";
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

export type { PregameFinal, PregameGrade, PregamePickInput } from "./pregame.ts";
export { gradePregame, PREGAME_LEGACY_LINES, PREGAME_XP } from "./pregame.ts";
