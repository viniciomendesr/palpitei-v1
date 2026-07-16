// Cliente dos endpoints de dados da TxLINE. Os cabeçalhos de auth entram no
// txlineGet(); aqui mora só o formato de cada endpoint e o que o v0 aprendeu
// apanhando de cada um.

import type { Fixture } from "@palpitei/core";
import { txlineGet } from "./auth.ts";
import { config } from "./config.ts";
import { TxlineSweepError } from "./errors.ts";
import { info, warn } from "./log.ts";

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Tolera resposta em array direto ou embrulhada em { updates } / { rows }. */
function rows(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  const d = data as { updates?: unknown; rows?: unknown } | null;
  if (Array.isArray(d?.updates)) return d.updates;
  if (Array.isArray(d?.rows)) return d.rows;
  return [];
}

function looksWorldCup(fx: unknown): boolean {
  return JSON.stringify(fx).toLowerCase().includes("world cup") ||
    JSON.stringify(fx).toLowerCase().includes("worldcup");
}

function toFixture(fx: any): Fixture | null {
  const fixtureId = num(fx?.FixtureId ?? fx?.fixtureId);
  if (fixtureId === undefined) return null;
  return {
    fixtureId,
    p1: String(fx.Participant1 ?? fx.participant1 ?? "?"),
    p2: String(fx.Participant2 ?? fx.participant2 ?? "?"),
    p1Id: num(fx.Participant1Id ?? fx.participant1Id),
    p2Id: num(fx.Participant2Id ?? fx.participant2Id),
    competition: fx.Competition ?? fx.competition,
    competitionId: num(fx.CompetitionId ?? fx.competitionId),
    startTime: num(fx.StartTime ?? fx.startTime),
    gameState: num(fx.GameState ?? fx.gameState),
    raw: fx,
  };
}

/** Snapshot de fixtures, com o fallback do spike (busca tudo + filtro por nome). */
export async function fetchFixtures(): Promise<Fixture[]> {
  const path = config.competitionId
    ? `/fixtures/snapshot?competitionId=${config.competitionId}`
    : `/fixtures/snapshot`;
  info(`GET ${config.apiBaseUrl}${path}`);

  const data = await txlineGet<any>(path);
  let list: any[] = Array.isArray(data) ? data : data?.fixtures ?? [];

  if (config.competitionId && list.length === 0) {
    warn(`competitionId=${config.competitionId} retornou 0 — buscando tudo e filtrando por "World Cup"…`);
    const todos = await txlineGet<any>(`/fixtures/snapshot`);
    const all: any[] = Array.isArray(todos) ? todos : todos?.fixtures ?? [];
    list = all.filter(looksWorldCup);
  } else if (!config.competitionId) {
    // TXLINE_COMPETITION_ID vazio é o opt-out documentado ("busca tudo e filtra
    // por World Cup"): sem este filtro a busca voltava TODAS as competições da
    // devnet, e a aba "Próximos" listava jogo que não é da Copa.
    list = list.filter(looksWorldCup);
  }

  return list
    .map(toFixture)
    .filter((f): f is Fixture => f !== null)
    .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
}

/**
 * Snapshot de placar. É um AMOSTRADOR (~37 linhas, 1 por tipo de ação), não a
 * linha do tempo: serve para estado atual, não para replay. A timeline é
 * /scores/updates (A3).
 *
 * `asOf` é parâmetro da API, não relógio de motor: aqui é a fronteira de I/O, o
 * único lugar do sistema onde Date.now() é legítimo. Motor nenhum lê o relógio
 * de parede — o tempo deles vem do ts do evento (Clock do core).
 */
export async function fetchScoresSnapshot(fixtureId: number, asOf?: number): Promise<any[]> {
  const data = await txlineGet(`/scores/snapshot/${fixtureId}`, { asOf: asOf ?? Date.now() });
  return rows(data);
}

/**
 * Nomes dos times de uma fixture que NÃO está mais no snapshot de fixtures (o
 * dataset da devnet rotaciona — A1). As linhas de score não trazem
 * Participant1/2 como nome, mas a linha de `lineups` traz Lineups[] com
 * normativeId + preferredName, e o id casa com Participant1Id/2Id.
 * Sem isto a sala mostra "Time 1 × Time 2" com dado real na tela.
 */
export async function fetchFixtureNames(
  fixtureId: number
): Promise<{ p1: string; p2: string; p1Id?: number; p2Id?: number; startTime?: number } | null> {
  let linhas: any[];
  try {
    linhas = await fetchScoresSnapshot(fixtureId);
  } catch {
    return null;
  }
  const linha = linhas.find((l) => Array.isArray(l?.Lineups) && l.Lineups.length);
  if (!linha) return null;

  const p1Id = num(linha.Participant1Id);
  const p2Id = num(linha.Participant2Id);
  const nome = (id?: number): string | undefined =>
    linha.Lineups.find((e: any) => num(e?.normativeId) === id)?.preferredName;

  const p1 = nome(p1Id);
  const p2 = nome(p2Id);
  if (!p1 || !p2) return null;

  // startTime não é enfeite: a janela do desafio "como termina?" é ancorada
  // nele. Sem ele a pergunta abre no 1º evento do feed (até 44 min antes do
  // apito) e expira antes de a bola rolar (G4).
  const startTime = num(linhas.find((l) => l?.StartTime)?.StartTime);
  return { p1: String(p1), p2: String(p2), p1Id, p2Id, startTime };
}

/**
 * Snapshot de odds. Devolve UMA linha — é foto, não série. Construir o
 * explicador em cima disto deixa a feature sem dados e SEM ERRO NENHUM (G2).
 * A série vem de fetchOddsUpdates().
 */
export async function fetchOddsSnapshot(fixtureId: number, asOf?: number): Promise<any[]> {
  const data = await txlineGet(`/odds/snapshot/${fixtureId}`, { asOf: asOf ?? Date.now() });
  return rows(data);
}

/**
 * Sequência completa de uma partida encerrada (2 semanas a 6h atrás).
 * Na devnet voltou VAZIO para tudo (A2) — reconferir antes de confiar. Erros propagam.
 */
export async function fetchHistorical(fixtureId: number): Promise<any[]> {
  const data = await txlineGet(`/scores/historical/${fixtureId}`);
  return rows(data);
}

// ---------------------------------------------------------------------------
// /updates — a linha do tempo COMPLETA (o snapshot é só um amostrador, A3)
// ---------------------------------------------------------------------------

// `interval` é um balde de 5 min dentro da hora => 12 por hora (0..11).
// Descoberto medindo os Ts de cada balde; varrer só 0..9 perde 10 min por hora
// em SILÊNCIO (G1).
const INTERVALOS_POR_HORA = 12;

export type Balde = { dia: number; hora: number };

/** Baldes (epochDay, hora UTC) que cobrem a janela de uma partida. */
export function baldes(
  startTime: number,
  horasAntes = config.sweepHoursBefore,
  horasDepois = config.sweepHoursAfter
): Balde[] {
  const out: Balde[] = [];
  const inicio = startTime - horasAntes * 3600_000;
  const fim = startTime + horasDepois * 3600_000;
  for (let t = inicio; t <= fim; t += 3600_000) {
    const d = new Date(t);
    out.push({ dia: Math.floor(t / 86400_000), hora: d.getUTCHours() });
  }
  return out;
}

/** Executa `fn` sobre `itens` com no máximo `limite` requisições em voo. */
async function pool<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let i = 0;
  const trabalhador = async (): Promise<void> => {
    while (true) {
      const meu = i++;
      if (meu >= itens.length) return;
      out[meu] = await fn(itens[meu]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return out;
}

export type SweepStats = {
  requisicoes: number;
  ok: number;
  linhas: number;
  daFixture: number;
  porStatus: Record<string, number>;
};

async function varreUpdates(
  feed: "scores" | "odds",
  fixtureId: number,
  startTime: number
): Promise<{ achados: any[]; stats: SweepStats }> {
  const alvos: { dia: number; hora: number; iv: number }[] = [];
  for (const { dia, hora } of baldes(startTime)) {
    for (let iv = 0; iv < INTERVALOS_POR_HORA; iv++) alvos.push({ dia, hora, iv });
  }

  const stats: SweepStats = { requisicoes: alvos.length, ok: 0, linhas: 0, daFixture: 0, porStatus: {} };
  const achados: any[] = [];

  await pool(alvos, config.sweepConcurrency, async ({ dia, hora, iv }) => {
    try {
      const data = await txlineGet(`/${feed}/updates/${dia}/${hora}/${iv}`);
      stats.ok += 1;
      const linhas = rows(data);
      stats.linhas += linhas.length;
      for (const r of linhas) {
        if (num(r?.FixtureId) === fixtureId) {
          achados.push(r);
          stats.daFixture += 1;
        }
      }
    } catch (e: any) {
      // Balde vazio/404 é NORMAL (a partida não cobre a hora toda). Mas o v0
      // engolia TUDO aqui com `catch {}` — inclusive 401. Contamos por status
      // para que "0 eventos por falta de dado" e "0 eventos porque a credencial
      // morreu" deixem de ser a mesma tela.
      const chave = e?.status ? `HTTP ${e.status}` : "rede";
      stats.porStatus[chave] = (stats.porStatus[chave] ?? 0) + 1;
      if (e?.status === 404) stats.ok += 1; // 404 = balde sem dados: sucesso semântico
    }
  });

  const naoFoi404 = { ...stats.porStatus };
  delete naoFoi404["HTTP 404"];
  const errosReais = Object.values(naoFoi404).reduce((a, b) => a + b, 0);

  // Nenhuma requisição bem-sucedida E houve erro real => isto não é "partida sem
  // dados", é falha. Falhar alto em vez de devolver [].
  if (stats.ok === 0 && errosReais > 0) {
    throw new TxlineSweepError(feed, fixtureId, stats.requisicoes, stats.porStatus);
  }
  if (errosReais > 0) {
    warn(
      `[updates] ${feed} da fixture ${fixtureId}: ${errosReais} de ${stats.requisicoes} baldes falharam ` +
        `(${Object.entries(naoFoi404).map(([s, n]) => `${s}×${n}`).join(", ")}) — o resultado pode estar INCOMPLETO`
    );
  }
  return { achados, stats };
}

/** Buracos na sequência de seq. Buraco = evento que existiu e não chegou. */
export function buracosDeSeq(linhas: any[]): { de: number; ate: number }[] {
  const seqs = linhas
    .map((r) => num(r?.Seq ?? r?.seq))
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b);
  const out: { de: number; ate: number }[] = [];
  for (let i = 1; i < seqs.length; i++) {
    const anterior = seqs[i - 1]!;
    const atual = seqs[i]!;
    if (atual > anterior + 1) out.push({ de: anterior, ate: atual });
  }
  return out;
}

/**
 * Todos os eventos de placar da partida, via /scores/updates. Diferente do
 * snapshot (37 linhas amostradas), aqui vêm ~962 com seq CONTÍNUO e o apito
 * inicial no clock 0 — é a linha do tempo de verdade. Custo: ~72 requisições.
 */
export async function fetchScoresUpdates(fixtureId: number, startTime: number): Promise<any[]> {
  const { achados } = await varreUpdates("scores", fixtureId, startTime);

  const semSeq = achados.filter((r) => num(r?.Seq) === undefined).length;
  if (semSeq) warn(`[updates] ${semSeq} linhas de score sem Seq — descartadas da deduplicação`);

  const porSeq = new Map<number, any>();
  for (const r of achados) {
    const seq = num(r.Seq);
    if (seq !== undefined) porSeq.set(seq, r);
  }
  const lista = [...porSeq.values()].sort((a, b) => (num(a.Seq) ?? 0) - (num(b.Seq) ?? 0));

  const buracos = buracosDeSeq(lista);
  if (buracos.length) {
    // seq é contínuo no feed: buraco aqui é evento perdido, não "jogo parado".
    warn(
      `[updates] fixture ${fixtureId}: ${buracos.length} BURACO(S) de seq — ` +
        `${buracos.slice(0, 5).map((b) => `${b.de}→${b.ate}`).join(", ")}${buracos.length > 5 ? "…" : ""}. ` +
        `Cada buraco é um evento que existiu e não chegou (gol? cartão?).`
    );
  }
  info(
    `[updates] scores da fixture ${fixtureId}: ${lista.length} eventos únicos` +
      (lista.length ? ` (seq ${num(lista[0].Seq)} → ${num(lista[lista.length - 1].Seq)})` : "")
  );
  return lista;
}

/**
 * Odds da partida via /odds/updates, filtradas ao mercado que o Palpitei consome
 * (1X2 de jogo inteiro). Sem filtro vêm ~35 mil eventos / 12 MB: o grosso é
 * over/under e handicap asiático, que o produto não usa (G2).
 */
export async function fetchOddsUpdates(fixtureId: number, startTime: number): Promise<any[]> {
  const { achados } = await varreUpdates("odds", fixtureId, startTime);
  const usados = achados.filter(
    (r) => String(r?.SuperOddsType ?? "") === "1X2_PARTICIPANT_RESULT" && r?.MarketPeriod == null
  );

  // MessageId é STRING ("1837922149:00003:000572-10021-stab"), não número.
  // Passar por num() devolvia -1 para TODAS e o Map colapsava a série inteira
  // num registro só — sem erro nenhum.
  const porId = new Map<string, any>();
  for (const r of usados) {
    porId.set(String(r.MessageId ?? `${r.Ts}:${JSON.stringify(r.Prices)}`), r);
  }
  const lista = [...porId.values()].sort((a, b) => (num(a.Ts) ?? 0) - (num(b.Ts) ?? 0));
  info(`[updates] odds 1X2 da fixture ${fixtureId}: ${lista.length} de ${achados.length} brutas`);
  return lista;
}

/**
 * Prova de Merkle de uma estatística (recibo verificável; base da liquidação na
 * v2). Exige (fixtureId, seq) REAIS de um game_finalised observado — seq
 * inventado devolve prova vazia.
 */
export async function fetchStatValidation(
  fixtureId: number,
  seq: number,
  statKey: number | string
): Promise<unknown> {
  return txlineGet(`/scores/stat-validation`, { fixtureId, seq, statKey });
}
