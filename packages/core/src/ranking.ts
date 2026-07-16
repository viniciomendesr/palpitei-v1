import type { User } from "./types.ts";

// Espelha a semântica do sorted set do Redis (ZINCRBY/ZREVRANGE).
export class Ranking {
  private scores = new Map<string, number>();

  incr(member: string, by: number): void {
    this.scores.set(member, (this.scores.get(member) ?? 0) + by);
  }

  get(member: string): number {
    return this.scores.get(member) ?? 0;
  }

  /** Desc por score; empate desempatado por member asc (determinístico). */
  top(n: number): { member: string; score: number }[] {
    return [...this.scores.entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => b.score - a.score || (a.member < b.member ? -1 : a.member > b.member ? 1 : 0))
      .slice(0, n);
  }
}

// ---------------------------------------------------------------------------
// XP e nível — regra de domínio, não de armazenamento.
// No v0 isto morava no singleton `store`; aqui é função pura sobre o User, para
// o motor de perguntas creditar XP sem conhecer repositório nenhum.
// ---------------------------------------------------------------------------

/** Curva de nível: cada nível custa progressivamente mais XP (raiz). */
export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

/** Credita XP e recalcula o nível. Muta o objeto; persistir é com quem chamou. */
export function addXp(user: User, amount: number): void {
  user.xp += amount;
  user.level = levelForXp(user.xp);
}
