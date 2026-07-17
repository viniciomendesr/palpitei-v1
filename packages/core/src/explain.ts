import type { EngineEmit, Fixture, OddsEvent, ScoreEvent } from "./types.ts";

// Explicação didática da cotação: template + matemática sobre a probabilidade
// implícita do StablePrice. Deliberadamente SEM LLM — determinístico.

const DELTA_THRESHOLD_PP = 3; // pontos percentuais
const CONTEXT_WINDOW_MS = 180_000;

// Já contraídos com a preposição do template ("depois de" + isto). Guardar o
// artigo solto ("o gol") gerava "depois de o gol" na tela do usuário.
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
  private lastPcts = new Map<string, number>(); // `${mercado}|${priceName}` -> pct
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
      const prev = this.lastPcts.get(key);
      this.lastPcts.set(key, price.pct); // cache atualiza SEMPRE, mesmo sem emitir
      if (prev === undefined) continue;

      const delta = price.pct - prev;
      if (Math.abs(delta) < DELTA_THRESHOLD_PP) continue;

      let contexto = "";
      let contextAction: string | undefined;
      if (this.lastAction && Math.abs(ev.ts - this.lastAction.ts) <= CONTEXT_WINDOW_MS) {
        const acao = ACTION_PT[this.lastAction.action];
        if (acao) {
          contexto = ` depois ${acao}`;
          // A causa em FORMA, não só em frase: é o que deixa a tela redigir
          // no idioma do fã sem perder o "depois do gol".
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
    // O feed 1X2 real manda "part1"/"draw"/"part2" — só "draw" estava mapeado,
    // então a explicação saía "A chance de part2 subiu…" na cara do usuário.
    // Os aliases 1/home/2/away ficam por segurança (outros mercados/fontes).
    if (n === "1" || n === "home" || n === "part1") return this.fixture.p1;
    if (n === "2" || n === "away" || n === "part2") return this.fixture.p2;
    if (n === "x" || n === "draw") return "empate";
    if (name === this.fixture.p1) return this.fixture.p1;
    if (name === this.fixture.p2) return this.fixture.p2;
    return name;
  }
}
