/**
 * Dado de exemplo — a mecânica que o protótipo tinha hardcoded.
 *
 * Isto é ANDAIME. Na v1 os desafios vêm do motor de perguntas (@palpitei/core)
 * sobre o dado real da TxLINE, e as porcentagens vêm do explicador. Cada função
 * aqui tem um equivalente no contrato REST/WS em ./api.ts — a troca é substituir
 * a origem, não a tela.
 *
 * §7 do T&C: nada aqui é payload da TxLINE. Os fatos de futebol do replay foram
 * conferidos em fontes públicas da FIFA; a interação (XP e janelas de resposta)
 * continua sendo uma simulação local e é sinalizada como demo na interface.
 */

import type { Dict } from './i18n';

/** Mecânica de um desafio. O texto correspondente está em `Dict.ch[i]`. */
export interface ChallengeSpec {
  xp: number;
  correct: string;
  optIds: string[];
  /**
   * Chance de cada opção, "atualizada ao vivo" (nunca chame de odds na tela).
   *
   * `number | null` de propósito, espelhando `QuestionOpenEvent.options[].pct`
   * do contrato: `null` = a TxLINE não mandou preço pra essa opção (o caso
   * `Prices: []` com `PriceNames` cheio, G8). AUSENTE ≠ 0% — quem renderizar
   * `?? 0` aqui inventa "a chance caiu pra zero" e repete o bug do v0.
   */
  pct: Record<string, number | null>;
  /**
   * Probabilidade antes e depois do lance. O replay demo não carrega preços
   * licenciados. No demo os números são uma simulação plausível, sempre
   * rotulada como tal, e nunca são apresentados como cotação da TxLINE.
   */
  before: number | null;
  after: number | null;
  resolve: { minute: number; scoreA?: number; scoreB?: number; final?: boolean };
  eventPt: string;
  eventEn: string;
}

export const CHALLENGES: ChallengeSpec[] = [
  {
    xp: 40,
    correct: 'arg',
    optIds: ['arg', 'cab', 'none'],
    pct: { arg: 51, cab: 23, none: 26 },
    before: 51,
    after: 68,
    resolve: { minute: 92, scoreA: 2, scoreB: 1 },
    eventPt: 'Gol da Argentina! Lisandro Martínez',
    eventEn: 'Argentina goal! Lisandro Martínez',
  },
  {
    xp: 30,
    correct: 'cab',
    optIds: ['arg', 'cab', 'none'],
    pct: { arg: 57, cab: 22, none: 21 },
    before: 22,
    after: 100,
    resolve: { minute: 103, scoreA: 2, scoreB: 2 },
    eventPt: 'Gol de Cabo Verde! Sidny Lopes Cabral',
    eventEn: 'Cape Verde goal! Sidny Lopes Cabral',
  },
  {
    xp: 25,
    correct: 'arg',
    optIds: ['arg', 'cab', 'none'],
    pct: { arg: 54, cab: 20, none: 26 },
    before: 54,
    after: 100,
    resolve: { minute: 111, scoreA: 3, scoreB: 2 },
    eventPt: 'Gol contra de Diney Borges após escanteio de Messi',
    eventEn: 'Diney Borges own goal after a Messi corner',
  },
  {
    xp: 50,
    correct: 'arg',
    optIds: ['arg', 'draw', 'cab'],
    pct: { arg: 64, draw: 19, cab: 17 },
    before: 64,
    after: 100,
    resolve: { minute: 120, scoreA: 3, scoreB: 2, final: true },
    eventPt: 'Fim de jogo: Argentina 3 x 2 Cabo Verde (após prorrogação)',
    eventEn: 'Full time: Argentina 3-2 Cape Verde (after extra time)',
  },
];

/** Duração da janela do palpite, em segundos.
 *
 * ATENÇÃO: isto é o contador da TELA, não a regra. Quando o WS entrar, o prazo
 * vem do `question_open` (ts do evento da TxLINE via Clock) e este número some.
 * Os motores nunca leem o relógio de parede — CONTEXT.md §3. */
export const COUNTDOWN_SECONDS = 12;

export interface FeedEvent {
  t: string;
  pt: string;
  en: string;
}

export const feedInit = (): FeedEvent[] => [
  { t: "59'", pt: 'Gol de Cabo Verde: Deroy Duarte', en: 'Cape Verde goal: Deroy Duarte' },
  { t: "29'", pt: 'Gol da Argentina: Lionel Messi', en: 'Argentina goal: Lionel Messi' },
];

/** Estado inicial da partida da sala de demonstração. */
export const MATCH_START = { minute: 64, scoreA: 1, scoreB: 1 } as const;

export interface FixtureView {
  id: string;
  live?: boolean;
  status: string;
  group: string;
  teamA: string;
  teamB: string;
  scoreA: string | number;
  scoreB: string | number;
  cta: string;
  /** Instante da partida, para travar o palpite local após o apito. */
  startTs?: number;
  /**
   * Selo de origem, exigido pela §2 ("badge de fonte em cada sala") e pelo G6
   * ("rótulo de proveniência não pode mentir"). Aparece na linha do grupo — o
   * MatchCard do ds não tem prop de origem e o contrato dele é o .d.ts.
   *
   * No demo o selo deixa claro que a interação é local, enquanto os fatos
   * esportivos vieram de relatórios públicos da FIFA — nunca da TxLINE.
   */
  source: string;
}

/** As três abas da home. GET /api/fixtures devolve isto no lugar. */
export function fixtures(t: Dict): Record<'live' | 'next' | 'replays', FixtureView[]> {
  return {
    live: [],
    next: [
      {
        id: 'fra-eng',
        status: t.statusThirdPlace,
        group: t.stageThirdPlace,
        teamA: t.tFranca,
        teamB: t.tInglaterra,
        scoreA: '–',
        scoreB: '–',
        cta: t.ctaRemind,
        startTs: Date.UTC(2026, 6, 18, 21, 0),
        source: t.srcDemoFifa,
      },
      {
        id: 'esp-arg',
        status: t.statusFinal,
        group: t.stageFinal,
        teamA: t.tEspanha,
        teamB: t.tArgentina,
        scoreA: '–',
        scoreB: '–',
        cta: t.ctaRemind,
        startTs: Date.UTC(2026, 6, 19, 19, 0),
        source: t.srcDemoFifa,
      },
    ],
    replays: [
      {
        id: 'arg-cab',
        status: t.statusArgCab,
        group: t.stageRound32,
        teamA: t.tArgentina,
        teamB: t.tCaboVerde,
        scoreA: 3,
        scoreB: 2,
        cta: t.ctaReplay,
        source: t.srcDemoFifa,
      },
    ],
  };
}

export interface StatRow {
  label: string;
  a: string | number;
  b: string | number;
  aFlex: number;
  bFlex: number;
}

/**
 * Estatísticas plausíveis para o ponto de partida do replay (64', 1-1).
 * Não são dados oficiais nem payload da TxLINE; a tela mostra esse aviso.
 */
export function liveStats(t: Dict): StatRow[] {
  return (
    [
      { label: t.statPossession, a: '59%', b: '41%', af: 59, bf: 41 },
      { label: t.statShots, a: 9, b: 4, af: 9, bf: 4 },
      { label: t.statOnTarget, a: 4, b: 2, af: 4, bf: 2 },
      { label: t.statCorners, a: 5, b: 2, af: 5, bf: 2 },
      { label: t.statFouls, a: 7, b: 10, af: 7, bf: 10 },
      { label: t.statCards, a: 1, b: 1, af: 1, bf: 1 },
    ] as const
  ).map((x) => ({
    label: x.label,
    a: x.a,
    b: x.b,
    aFlex: Math.max(x.af, 0.4),
    bFlex: Math.max(x.bf, 0.4),
  }));
}

export interface RoomRankRow {
  id: string;
  name: string;
  xp: number;
  pos: number;
}

/** Ranking da sala. `salaXp` é o que você fez nesta partida. */
export function roomRanking(t: Dict, salaXp: number): RoomRankRow[] {
  return [{ id: 'me', name: t.you, xp: salaXp, pos: 1 }];
}

export interface GlobalRankRow {
  name: string;
  initials: string;
  sub: string;
  xp: number;
  avBg: string;
  avColor: string;
  me?: boolean;
  pos: number;
}

export function globalRanking(
  t: Dict,
  me: { nickname: string; initials: string; xp: number },
): GlobalRankRow[] {
  return [
    {
      name: me.nickname,
      initials: me.initials,
      sub: t.meSubYou,
      xp: me.xp,
      avBg: 'var(--lime)',
      avColor: 'var(--on-lime)',
      me: true,
    },
  ].map((r, i) => ({ ...r, pos: i + 1 }));
}

/** No demo não inventamos participantes que não existem na sessão local. */
export const ROOM_SIZE = 1;
