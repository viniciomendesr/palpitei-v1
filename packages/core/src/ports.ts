import type { Bet, Prediction, User } from "./types.ts";

/**
 * Persistence dependencies required by engines. They are injected to keep the
 * core pure; engines only request writes and never read application state.
 */
export type EnginePorts = {
  /** Generates a unique identifier with the provided prefix. */
  uid(prefix: string): string;

  savePrediction(p: Prediction): void;

  saveBet(b: Bet): void;

  /**
   * Called after the engine mutates a user (XP or balance). In-memory test
   * doubles observe object mutation directly; persistent adapters must save it.
   */
  saveUser?(u: User): void;
};
