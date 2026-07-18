import type { User } from "./types.ts";

// Mirrors Redis sorted-set semantics (ZINCRBY/ZREVRANGE).
export class Ranking {
  private scores = new Map<string, number>();

  incr(member: string, by: number): void {
    this.scores.set(member, (this.scores.get(member) ?? 0) + by);
  }

  get(member: string): number {
    return this.scores.get(member) ?? 0;
  }

  /** Descending score; member ascending breaks ties deterministically. */
  top(n: number): { member: string; score: number }[] {
    return [...this.scores.entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => b.score - a.score || (a.member < b.member ? -1 : a.member > b.member ? 1 : 0))
      .slice(0, n);
  }
}

/** Level curve: each level requires progressively more XP. */
export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

/** Credits XP and recalculates the level. Persistence remains the caller's job. */
export function addXp(user: User, amount: number): void {
  user.xp += amount;
  user.level = levelForXp(user.xp);
}
