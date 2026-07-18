import type { EngineEmit, Fixture, OddsEvent, ScoreEvent } from "./types.ts";

// Deterministic odds explanation from templates and implied probability.

const DELTA_THRESHOLD_PP = 3; // percentage points
const CONTEXT_WINDOW_MS = 180_000;

// Phrases are stored with the template preposition to preserve grammar.
const ACTION_PT: Record<string, string> = {
  goal: "do gol",
  corner: "do escanteio",
  red_card: "do cartão vermelho",
  yellow_card: "do cartão amarelo",
  penalty: "do pênalti",
  var: "da revisão do VAR",
  kickoff: "do pontapé inicial",
};

function fmtPct(x: number): string {
  return x.toFixed(1);
}

export class OddsExplainer {
  private fixture: Fixture;
  private emit: EngineEmit;
  /**
   * Last published value per option, rather than the raw previous tick, so
   * small changes accumulate until they cross the explanation threshold.
   */
  private lastExplainedPcts = new Map<string, number>(); // `${market}|${priceName}` -> pct
  private lastAction: { action: string; ts: number } | null = null;

  constructor(opts: { fixture: Fixture; emit: EngineEmit }) {
    this.fixture = opts.fixture;
    this.emit = opts.emit;
  }

  onScoreEvent(ev: ScoreEvent): void {
    if (ACTION_PT[ev.action]) this.lastAction = { action: ev.action, ts: ev.ts };
  }

  onOddsEvent(ev: OddsEvent): void {
    const marketKey = `${ev.marketType}|${ev.marketPeriod ?? ""}|${ev.line ?? ""}`;
    for (const price of ev.prices) {
      const key = `${marketKey}|${price.name}`;
      const prev = this.lastExplainedPcts.get(key);
      // The first price establishes a baseline. Update it only when publishing
      // an explanation so consecutive small changes can accumulate.
      if (prev === undefined) {
        this.lastExplainedPcts.set(key, price.pct);
        continue;
      }

      const delta = price.pct - prev;
      if (Math.abs(delta) < DELTA_THRESHOLD_PP) continue;
      this.lastExplainedPcts.set(key, price.pct);

      let contexto = "";
      let contextAction: string | undefined;
      const desdeOContexto = this.lastAction ? ev.ts - this.lastAction.ts : null;
      if (this.lastAction && desdeOContexto !== null && desdeOContexto >= 0 && desdeOContexto <= CONTEXT_WINDOW_MS) {
        const acao = ACTION_PT[this.lastAction.action];
        if (acao) {
          contexto = ` depois ${acao}`;
          // Preserve structured context so the UI can render it in its locale.
          contextAction = this.lastAction.action;
        }
      }

      const text = `A chance de ${this.describe(price.name, ev.line)} ${
        delta > 0 ? "subiu" : "caiu"
      } de ${fmtPct(prev)}% para ${fmtPct(price.pct)}%${contexto}`;

      this.emit({
        type: "odds_explain",
        fixtureId: this.fixture.fixtureId,
        text,
        marketType: ev.marketType,
        messageId: ev.messageId,
        priceName: price.name,
        fromPct: prev,
        toPct: price.pct,
        contextAction,
        ts: ev.ts,
      });
    }
  }

  private describe(name: string, line?: number): string {
    const n = name.toLowerCase();
    if (n === "over" && line !== undefined) return `mais de ${line} gols`;
    if (n === "under" && line !== undefined) return `menos de ${line} gols`;
    // TxLINE 1X2 uses part1/draw/part2; keep aliases for other sources.
    if (n === "1" || n === "home" || n === "part1") return this.fixture.p1;
    if (n === "2" || n === "away" || n === "part2") return this.fixture.p2;
    if (n === "x" || n === "draw") return "empate";
    if (name === this.fixture.p1) return this.fixture.p1;
    if (name === this.fixture.p2) return this.fixture.p2;
    return name;
  }
}
