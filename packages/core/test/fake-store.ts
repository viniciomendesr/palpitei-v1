// In-memory EnginePorts fake. Each test receives an isolated, disposable instance.

import type { Bet, EnginePorts, Prediction, User } from "../src/index.ts";
import { START_BALANCE_CENTS } from "../src/index.ts";

export function makeFakeStore() {
  let counter = 0;
  const predictions = new Map<string, Prediction>();
  const bets = new Map<string, Bet>();
  const users = new Map<string, User>();
  const savedUsers: User[] = []; // Every user mutation announced by the engine.

  const ports: EnginePorts = {
    uid: (prefix: string) => `${prefix}_${(++counter).toString(36)}`,
    savePrediction: (p) => {
      predictions.set(p.id, p);
    },
    saveBet: (b) => {
      bets.set(b.id, b);
    },
    saveUser: (u) => {
      savedUsers.push(u);
    },
  };

  // Deterministic test account; engines only need these domain fields.
  function createUser(handle: string): User {
    const user: User = {
      id: ports.uid("usr"),
      handle,
      wallet: `wlt_${handle}`,
      walletSource: "simulated",
      xp: 0,
      level: 1,
      balanceCents: START_BALANCE_CENTS,
      createdAt: 0,
    };
    users.set(user.id, user);
    return user;
  }

  return { ports, predictions, bets, users, savedUsers, createUser };
}
