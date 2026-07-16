import type { OddsEvent, ScoreEvent } from "./types.ts";

// Payload cru da TxLINE -> evento normalizado (contrato em ./types.ts).
// Tolerante a caixa (FixtureId/fixtureId) porque a doc mostra PascalCase mas
// não há garantia formal; o resto do sistema só conhece o formato normalizado.

function num(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Id opaco: preserva a forma que veio. NÃO passe por num() — o MessageId real é
 * uma string estruturada ("1837922149:00003:000572-10021-stab") e Number() dela
 * é NaN. No v0 isso zerou a chave de dedupe e colapsou 3.758 eventos de odds em
 * 1 registro, calado (G2). Aceita número (fontes sintéticas) virando string.
 */
function id(v: any): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "object") return undefined;
  const s = String(v);
  return s.length > 0 ? s : undefined;
}

function totals(score: any, participant: "Participant1" | "Participant2") {
  const p = score?.[participant] ?? score?.[participant.toLowerCase()];
  const total = p?.Total ?? p?.total ?? {};
  return {
    // Aqui, dentro do bloco Total, ausente = ZERO (G7): se a chave não vier, a
    // linha vale 0 — o contrário da regra do bloco Score inteiro (A4, ver hasScore).
    goals: num(total.Goals ?? total.goals) ?? 0,
    corners: num(total.Corners ?? total.corners) ?? 0,
    // O bloco Total inteiro, sem lista fixa: além de Goals/Corners o feed traz
    // YellowCards, RedCards, Shots… e o conjunto varia por partida. Os motores
    // usam goals/corners; a aba de estatísticas mostra o que vier.
    todas: numericos(total),
  };
}

/** Só os campos numéricos do bloco (ignora aninhados/estranhos). */
function numericos(bloco: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(bloco ?? {})) {
    const n = num(v);
    if (n !== undefined) out[k] = n;
  }
  return out;
}

export function normalizeScore(raw: any): ScoreEvent | null {
  if (raw == null || typeof raw !== "object") return null;
  const fixtureId = num(raw.FixtureId ?? raw.fixtureId);
  if (fixtureId === undefined) return null;

  const score = raw.Score ?? raw.score;
  const p1 = totals(score, "Participant1");
  const p2 = totals(score, "Participant2");
  const clock = raw.Clock ?? raw.clock;

  return {
    kind: "score",
    fixtureId,
    seq: num(raw.Seq ?? raw.seq) ?? 0,
    ts: num(raw.Ts ?? raw.ts) ?? 0,
    action: String(raw.Action ?? raw.action ?? "").toLowerCase(),
    statusId: num(raw.StatusId ?? raw.statusId),
    period: num(raw.Period ?? raw.period),
    gameStateRaw: raw.GameState ?? raw.gameState,
    clockRunning: clock ? Boolean(clock.Running ?? clock.running) : undefined,
    clockSeconds: clock ? num(clock.Seconds ?? clock.seconds) : undefined,
    // A4: bloco Score AUSENTE ≠ zero. hasScore=false avisa o motor de que
    // goals/corners abaixo são placeholder — tratar como placar faria o jogo
    // regredir a 0-0 e inventar gols fantasma no delta seguinte.
    hasScore: score != null,
    goals: { p1: p1.goals, p2: p2.goals },
    corners: { p1: p1.corners, p2: p2.corners },
    totals: { p1: p1.todas, p2: p2.todas },
    data: raw.Data ?? raw.data,
    raw,
  };
}

export function normalizeOdds(raw: any): OddsEvent | null {
  if (raw == null || typeof raw !== "object") return null;
  const fixtureId = num(raw.FixtureId ?? raw.fixtureId);
  if (fixtureId === undefined) return null;

  const names = raw.PriceNames ?? raw.priceNames;
  const priceInts = raw.Prices ?? raw.prices;
  if (!Array.isArray(names) || !Array.isArray(priceInts)) return null;
  // Prices VAZIO com PriceNames preenchido é real (26 de 3.758 nesta fixture:
  // mercado sem cotação no momento). Sem este corte, names.map() produzia 3
  // preços zerados, o explicador via a chance "desabar para 0%" e emitia
  // explicação fantasma — 115 delas. É o A4 de novo: aqui, vazio ≠ zero (G8).
  if (priceInts.length === 0) return null;
  const pcts = raw.Pct ?? raw.pct;
  // ...e o mesmo vale para o desalinhamento PARCIAL, que o corte acima não pega:
  // 3 PriceNames com 2 Prices fazia names.map() inventar um 3º preço zerado
  // (num(undefined) ?? 0), e o explicador anunciava "a chance caiu para 0.0%" —
  // a MESMA explicação fantasma do G8, entrando por outra porta. O CONTEXT §3 é
  // explícito: confira o tamanho DOS TRÊS antes de mapear. Desalinhou, descarta
  // o evento inteiro: preço que não veio é ausente, nunca zero.
  if (priceInts.length !== names.length) return null;
  if (Array.isArray(pcts) && pcts.length !== names.length) return null;

  const prices: { name: string; odds: number; pct: number }[] = [];
  names.forEach((name: any, i: number) => {
    // Ausente ≠ zero também DENTRO do array: um preço null/ilegível no meio de
    // arrays alinhados virava odds 0 -> pct 0 -> "a chance caiu para 0.0%".
    // Preço que não dá para ler é preço que não veio: some a LINHA, não o evento
    // (os outros preços da mensagem são legítimos e o explicador os usa).
    const raw1000 = num(priceInts[i]);
    if (raw1000 === undefined || raw1000 <= 0) return;
    const odds = raw1000 / 1000; // Prices vêm x1000: 2076 => 2.076
    let pct = Number.parseFloat(String(Array.isArray(pcts) ? pcts[i] : ""));
    if (!Number.isFinite(pct)) {
      // Sem Pct no payload: deriva a probabilidade implícita da própria odd.
      pct = Number(((1 / odds) * 100).toFixed(3));
    }
    prices.push({ name: String(name), odds, pct });
  });
  // Todos os preços ilegíveis => não há o que dizer sobre este mercado.
  if (prices.length === 0) return null;

  const params = raw.MarketParameters ?? raw.marketParameters;
  const lineNum = params?.line != null ? num(params.line) : undefined;

  return {
    kind: "odds",
    fixtureId,
    ts: num(raw.Ts ?? raw.ts) ?? 0,
    messageId: id(raw.MessageId ?? raw.messageId),
    marketType: String(raw.SuperOddsType ?? raw.superOddsType ?? "?"),
    marketPeriod: raw.MarketPeriod ?? raw.marketPeriod,
    line: lineNum,
    inRunning: raw.InRunning ?? raw.inRunning,
    bookmaker: raw.Bookmaker ?? raw.bookmaker,
    prices,
    raw,
  };
}
