import type { Bet, EngineEmit, Fixture, Market, MarketOutcome, User } from "./types.ts";
import type { EnginePorts } from "./ports.ts";

const RAKE_BPS = 500; // 5% de rake da casa
const OUTCOMES: MarketOutcome[] = ["p1", "draw", "p2"];

/** Saldo inicial de USDC SIMULADO de cada conta (100 USDC em centavos). */
export const START_BALANCE_CENTS = 10000;

/**
 * Prévia da v2: mercado paramutuel de resultado final com USDC SIMULADO.
 * Não há dinheiro real na v1 — isto é vitrine do que a v2 (Presságio) fará.
 * Toda a matemática é em centavos inteiros (Math.floor) — determinística e
 * auditável, espelhando o que o contrato Anchor fará on-chain na v2.
 */
export class MarketEngine {
  market: Market;
  bets: Bet[] = [];

  private fixture: Fixture;
  private emit: EngineEmit;
  private ports: EnginePorts;
  private users = new Map<string, User>(); // p/ handle e crédito de saldo

  constructor(opts: { fixture: Fixture; emit: EngineEmit; ports: EnginePorts }) {
    this.fixture = opts.fixture;
    this.emit = opts.emit;
    this.ports = opts.ports;
    this.market = {
      id: this.ports.uid("mkt"),
      fixtureId: opts.fixture.fixtureId,
      kind: "resultado_final",
      labels: { p1: opts.fixture.p1, draw: "Empate", p2: opts.fixture.p2 },
      rakeBps: RAKE_BPS,
      closesAt: null,
      state: "open",
      pools: { p1: 0, draw: 0, p2: 0 },
    };
  }

  /** Define o prazo (kickoff). O prazo fecha ANTES do evento resolvedor. */
  setCloseAt(ts: number): void {
    this.market.closesAt = ts;
    this.emitUpdate();
  }

  closeIfDue(ts: number): void {
    if (
      this.market.state === "open" &&
      this.market.closesAt !== null &&
      ts >= this.market.closesAt
    ) {
      this.market.state = "closed";
      this.emitUpdate();
    }
  }

  placeBet(
    user: User,
    outcome: MarketOutcome,
    amountCents: number,
    ts: number
  ): { ok: true; bet: Bet } | { ok: false; error: string } {
    this.closeIfDue(ts);
    if (this.market.state !== "open") return { ok: false, error: "mercado fechado" };
    if (!(OUTCOMES as string[]).includes(outcome)) {
      return { ok: false, error: "resultado inválido" };
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return { ok: false, error: "valor inválido" };
    }
    if (user.balanceCents < amountCents) {
      return { ok: false, error: "saldo insuficiente" };
    }

    user.balanceCents -= amountCents;
    this.market.pools[outcome] += amountCents;
    const bet: Bet = {
      id: this.ports.uid("bet"),
      marketId: this.market.id,
      userId: user.id,
      outcome,
      amountCents,
      ts,
    };
    this.bets.push(bet);
    this.ports.saveBet(bet);
    this.ports.saveUser?.(user);
    this.users.set(user.id, user);
    this.emitUpdate();
    return { ok: true, bet };
  }

  resolve(winner: MarketOutcome): void {
    if (this.market.state === "resolved") {
      // Resolver duas vezes NÃO pode pagar em dobro — segunda chamada é no-op.
      this.emit({
        type: "log",
        level: "warn",
        fixtureId: this.fixture.fixtureId,
        text: `resolve(${winner}) ignorado: mercado ${this.market.id} já resolvido`,
      });
      return;
    }
    const m = this.market;
    m.state = "resolved";
    m.winner = winner;

    const total = m.pools.p1 + m.pools.draw + m.pools.p2;
    const winnersPool = m.pools[winner];
    const byUser = new Map<string, number>();

    if (winnersPool === 0) {
      // Ninguém acertou: reembolso integral, SEM rake.
      m.refunded = true;
      for (const bet of this.bets) {
        bet.payoutCents = bet.amountCents;
        const u = this.users.get(bet.userId);
        if (u) {
          u.balanceCents += bet.amountCents;
          this.ports.saveUser?.(u);
        }
        this.ports.saveBet(bet);
        byUser.set(bet.userId, (byUser.get(bet.userId) ?? 0) + bet.amountCents);
      }
    } else {
      const distributable = Math.floor((total * (10000 - m.rakeBps)) / 10000);
      for (const bet of this.bets) {
        if (bet.outcome !== winner) {
          bet.payoutCents = 0;
          this.ports.saveBet(bet);
          continue;
        }
        // floor por aposta: a sobra (dust) fica na casa junto com o rake.
        const payout = Math.floor((bet.amountCents * distributable) / winnersPool);
        bet.payoutCents = payout;
        const u = this.users.get(bet.userId);
        if (u) {
          u.balanceCents += payout;
          this.ports.saveUser?.(u);
        }
        this.ports.saveBet(bet);
        byUser.set(bet.userId, (byUser.get(bet.userId) ?? 0) + payout);
      }
    }

    m.payouts = [...byUser.entries()].map(([userId, amountCents]) => ({
      userId,
      amountCents,
    }));

    this.emit({
      type: "market_resolved",
      fixtureId: this.fixture.fixtureId,
      market: this.snapshot(),
      payouts: m.payouts.map((p) => ({
        ...p,
        handle: this.users.get(p.userId)?.handle ?? "?",
      })),
    });
  }

  /** Anexa o recibo (prova de Merkle da TxLINE) ou o erro de obtenção. */
  attachProof(proof: any | null, error?: string): void {
    if (proof) this.market.proof = proof;
    if (error) this.market.proofError = error;
    this.emit({
      type: "market_proof",
      fixtureId: this.fixture.fixtureId,
      marketId: this.market.id,
      ...(proof ? { proof } : {}),
      ...(error ? { proofError: error } : {}),
    });
  }

  snapshot(): Market & { betCount: number } {
    return {
      ...this.market,
      pools: { ...this.market.pools },
      betCount: this.bets.length,
    };
  }

  private emitUpdate(): void {
    this.emit({
      type: "market_update",
      fixtureId: this.fixture.fixtureId,
      market: this.snapshot(),
    });
  }
}
