/**
 * Cotações que podem alimentar o palpite pré-jogo.
 *
 * Esta leitura usa o snapshot da TxLINE — foto atual para uma tela pré-jogo,
 * não a série /updates usada pelo replay/explicador. Só devolvemos a projeção
 * que a UI consome (linha + chances), nunca o payload cru licenciado. Arrays
 * paralelos incompletos, `Pct: "NA"`, linhas inteiras e linhas asiáticas são
 * AUSÊNCIA de mercado, não zero nem uma estimativa nossa (G8).
 */

import { fetchOddsSnapshot } from '@palpitei/txline';

export type ChancesResultado = { home: number; draw: number; away: number };
export type ChancesAcimaAbaixo = { line: number; over: number; under: number };

/**
 * A lista é o contrato da tela: só entram mercados que a TxLINE cotou por
 * completo E que o Palpitei sabe liquidar. O front não reserva cartões para
 * uma categoria que a fonte não abriu.
 */
export type PregameMarket =
  | {
      id: 'result';
      kind: 'result';
      options: { id: 'home' | 'draw' | 'away'; pct: number }[];
    }
  | {
      id: 'goals' | 'corners';
      kind: 'over_under';
      line: number;
      options: { id: 'over' | 'under'; pct: number }[];
    };

export interface PregameOddsRead {
  markets: PregameMarket[];
  /** false = a TxLINE não respondeu; lista vazia não é uma lista de zeros. */
  txlineAvailable: boolean;
}

export const SEM_MERCADOS: PregameMarket[] = [];

const MERCADO_RESULTADO = '1X2_PARTICIPANT_RESULT';
const MERCADO_GOLS = 'OVERUNDER_PARTICIPANT_GOALS';
const MERCADO_ESCANTEIOS = 'OVERUNDER_PARTICIPANT_CORNERS';
const TTL_MS = Math.max(1_000, Number(process.env.TXLINE_PREGAME_ODDS_CACHE_MS ?? 15_000) || 15_000);

type Cache = Map<number, { value: PregameOddsRead; expiresAt: number; inFlight: Promise<PregameOddsRead> | null }>;
const CHAVE = '__palpitei_pregame_odds_cache__' as const;
type GlobalComCache = typeof globalThis & { [CHAVE]?: Cache };

function cache(): Cache {
  const g = globalThis as GlobalComCache;
  return (g[CHAVE] ??= new Map());
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function numero(v: unknown): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `MarketParameters` da TxLINE é hoje uma string (`line=2.5`), não objeto. */
export function linhaDoMercado(params: unknown): number | null {
  let bruto: unknown = null;
  if (typeof params === 'string') {
    const match = /(?:^|[,&;\s])line\s*=\s*(-?(?:\d+(?:\.\d+)?|\.\d+))(?=$|[,&;\s])/i.exec(params);
    bruto = match?.[1] ?? null;
  } else if (params && typeof params === 'object') {
    bruto = (params as { line?: unknown }).line ?? null;
  }
  const line = numero(bruto);
  // Linhas .5 não empatam; .0, .25 e .75 exigem regra de push/meio ganho.
  if (line === null || line < 0 || line > 20 || Number.isInteger(line)) return null;
  return Math.abs(line * 2 - Math.round(line * 2)) < 1e-9 ? line : null;
}

type Precos = Map<string, number>;

/**
 * Monta o mapa de chances só se TODAS as três listas paralelas forem válidas.
 * `Prices` ainda é checado embora a UI não o mostre: Pct sem preço é um estado
 * inconsistente do feed, não uma cotação verificável.
 */
function precosValidos(raw: Record<string, unknown>): Precos | null {
  const names = raw.PriceNames ?? raw.priceNames;
  const prices = raw.Prices ?? raw.prices;
  const pcts = raw.Pct ?? raw.pct;
  if (!Array.isArray(names) || !Array.isArray(prices) || !Array.isArray(pcts)) return null;
  if (names.length === 0 || names.length !== prices.length || names.length !== pcts.length) return null;

  const out = new Map<string, number>();
  for (let i = 0; i < names.length; i++) {
    const name = texto(names[i]);
    const price = numero(prices[i]);
    const pct = numero(pcts[i]);
    if (!name || price === null || price <= 0 || pct === null || pct <= 0 || pct > 100 || out.has(name)) return null;
    out.set(name, pct);
  }
  return out;
}

function chanceResultado(raw: Record<string, unknown>): ChancesResultado | null {
  if (String(raw.SuperOddsType ?? raw.superOddsType ?? '') !== MERCADO_RESULTADO) return null;
  if ((raw.MarketPeriod ?? raw.marketPeriod) != null) return null;
  const p = precosValidos(raw);
  if (!p) return null;
  const home = p.get('part1') ?? p.get('participant1') ?? p.get('home');
  const draw = p.get('draw');
  const away = p.get('part2') ?? p.get('participant2') ?? p.get('away');
  return home == null || draw == null || away == null ? null : { home, draw, away };
}

function chanceAcimaAbaixo(raw: Record<string, unknown>, tipo: string): ChancesAcimaAbaixo | null {
  if (String(raw.SuperOddsType ?? raw.superOddsType ?? '') !== tipo) return null;
  if ((raw.MarketPeriod ?? raw.marketPeriod) != null) return null;
  const line = linhaDoMercado(raw.MarketParameters ?? raw.marketParameters);
  const p = precosValidos(raw);
  if (line === null || !p) return null;
  const over = p.get('over');
  const under = p.get('under');
  return over == null || under == null ? null : { line, over, under };
}

/** A linha mais equilibrada é a pergunta mais justa entre as que a TxLINE abriu. */
function maisEquilibrada(candidatas: ChancesAcimaAbaixo[]): ChancesAcimaAbaixo | null {
  return candidatas.reduce<ChancesAcimaAbaixo | null>((melhor, atual) => {
    if (!melhor) return atual;
    const desequilibrioAtual = Math.abs(atual.over - atual.under);
    const desequilibrioMelhor = Math.abs(melhor.over - melhor.under);
    if (desequilibrioAtual < desequilibrioMelhor) return atual;
    // Empate raro: a menor linha resolve a escolha sem injetar uma preferência
    // de produto e mantém a resposta estável entre renders.
    return desequilibrioAtual === desequilibrioMelhor && atual.line < melhor.line ? atual : melhor;
  }, null);
}

/** Projeção pura — exportada para teste sem chamar a rede. */
export function extrairMercadosPregame(rows: unknown[]): PregameMarket[] {
  let result: ChancesResultado | null = null;
  const goals: ChancesAcimaAbaixo[] = [];
  const corners: ChancesAcimaAbaixo[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const raw = row as Record<string, unknown>;
    result ??= chanceResultado(raw);
    const goal = chanceAcimaAbaixo(raw, MERCADO_GOLS);
    if (goal) goals.push(goal);
    const corner = chanceAcimaAbaixo(raw, MERCADO_ESCANTEIOS);
    if (corner) corners.push(corner);
  }

  const markets: PregameMarket[] = [];
  if (result) {
    markets.push({
      id: 'result',
      kind: 'result',
      options: [
        { id: 'home', pct: result.home },
        { id: 'draw', pct: result.draw },
        { id: 'away', pct: result.away },
      ],
    });
  }
  const goalsMarket = maisEquilibrada(goals);
  if (goalsMarket) {
    markets.push({
      id: 'goals',
      kind: 'over_under',
      line: goalsMarket.line,
      options: [
        { id: 'over', pct: goalsMarket.over },
        { id: 'under', pct: goalsMarket.under },
      ],
    });
  }
  const cornersMarket = maisEquilibrada(corners);
  if (cornersMarket) {
    markets.push({
      id: 'corners',
      kind: 'over_under',
      line: cornersMarket.line,
      options: [
        { id: 'over', pct: cornersMarket.over },
        { id: 'under', pct: cornersMarket.under },
      ],
    });
  }
  return markets;
}

/**
 * Snapshot atual, com cache curto por fixture. Se a TxLINE falhar, não servimos
 * cache velho como se fosse atual: a tela recebe mercados indisponíveis e segue
 * permitindo somente o que não depende de cotação (placar exato).
 */
export async function oddsPregameTxline(fixtureId: number): Promise<PregameOddsRead> {
  const c = cache();
  const now = Date.now();
  const anterior = c.get(fixtureId);
  if (anterior && now < anterior.expiresAt) return anterior.value;
  if (anterior?.inFlight) return anterior.inFlight;

  const entry = anterior ?? { value: { markets: SEM_MERCADOS, txlineAvailable: false }, expiresAt: 0, inFlight: null };
  const emVoo = fetchOddsSnapshot(fixtureId)
    .then((rows) => ({ markets: extrairMercadosPregame(rows), txlineAvailable: true }))
    .catch(() => ({ markets: SEM_MERCADOS, txlineAvailable: false }))
    .then((value) => {
      entry.value = value;
      entry.expiresAt = Date.now() + TTL_MS;
      entry.inFlight = null;
      return value;
    });
  entry.inFlight = emVoo;
  c.set(fixtureId, entry);
  return emVoo;
}

/** Compara uma linha recebida do cliente com a linha que a TxLINE acabou de abrir. */
export function mercadoPorId<T extends PregameMarket['id']>(markets: PregameMarket[], id: T): Extract<PregameMarket, { id: T }> | null {
  return (markets.find((market) => market.id === id) as Extract<PregameMarket, { id: T }> | undefined) ?? null;
}

export function mesmaLinha(recebida: number | null, cotada: Extract<PregameMarket, { kind: 'over_under' }> | null): boolean {
  return recebida !== null && cotada !== null && Math.abs(recebida - cotada.line) < 1e-9;
}
