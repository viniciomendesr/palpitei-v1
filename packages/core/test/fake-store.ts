// Fake em memória das EnginePorts — o que o singleton `store` do v0 era, agora
// como dependência injetada e descartável (uma instância por teste, sem estado
// global vazando entre casos).
//
// Não é um arquivo *.test.ts, então o `node --test test/*.test.ts` não o executa.

import type { Bet, EnginePorts, Prediction, User } from "../src/index.ts";
import { START_BALANCE_CENTS } from "../src/index.ts";

export function makeFakeStore() {
  let counter = 0;
  const predictions = new Map<string, Prediction>();
  const bets = new Map<string, Bet>();
  const users = new Map<string, User>();
  const savedUsers: User[] = []; // toda mutação de usuário que o motor anunciou

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

  // Conta de teste: sem provedor, sem keypair de verdade — os motores só olham
  // id/handle/xp/level/balanceCents. createdAt é fixo para o teste ser determinístico.
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
