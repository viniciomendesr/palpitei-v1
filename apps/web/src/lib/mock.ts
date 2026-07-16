/**
 * Dado de exemplo — a mecânica que o protótipo tinha hardcoded.
 *
 * Isto é ANDAIME. Na v1 os desafios vêm do motor de perguntas (@palpitei/core)
 * sobre o dado real da TxLINE, e as porcentagens vêm do explicador. Cada função
 * aqui tem um equivalente no contrato REST/WS em ./api.ts — a troca é substituir
 * a origem, não a tela.
 *
 * §7 do T&C: nada aqui é payload da TxLINE. São números inventados pro protótipo.
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
  /** Probabilidade antes e depois do lance que resolve — a leitura do jogo. */
  before: number;
  after: number;
  resolve: { minute: number; scoreA?: number; scoreB?: number; final?: boolean };
  eventPt: string;
  eventEn: string;
}

export const CHALLENGES: ChallengeSpec[] = [
  {
    xp: 40,
    correct: 'arg',
    optIds: ['arg', 'cab', 'none'],
    pct: { arg: 58, cab: 17, none: 25 },
    before: 58,
    after: 74,
    resolve: { minute: 71, scoreA: 3, scoreB: 1 },
    eventPt: 'Gol da Argentina! Julián Álvarez',
    eventEn: 'Argentina goal! Julián Álvarez',
  },
  {
    xp: 30,
    correct: 'over',
    optIds: ['over', 'under'],
    pct: { over: 46, under: 54 },
    before: 46,
    after: 100,
    resolve: { minute: 82 },
    eventPt: 'Escanteio da Argentina, total chega a 10',
    eventEn: 'Argentina corner, total reaches 10',
  },
  {
    xp: 25,
    correct: 'out',
    optIds: ['goal', 'out', 'post'],
    pct: { goal: 39, out: 44, post: 17 },
    before: 44,
    after: 100,
    resolve: { minute: 88 },
    eventPt: "Chute de Messi por cima, 88'",
    eventEn: "Messi shoots over the bar, 88'",
  },
  {
    xp: 50,
    correct: 'arg',
    optIds: ['arg', 'draw', 'cab'],
    pct: { arg: 71, draw: 12, cab: 17 },
    before: 71,
    after: 100,
    resolve: { minute: 90, final: true },
    eventPt: 'Fim de jogo: Argentina 3 x 1 Cabo Verde',
    eventEn: 'Full time: Argentina 3-1 Cape Verde',
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
  { t: "64'", pt: 'Cartão amarelo pra Cabo Verde', en: 'Yellow card for Cape Verde' },
  { t: "61'", pt: 'Escanteio da Argentina', en: 'Argentina corner' },
];

export const TEAMS = [
  'Argentina',
  'Brasil',
  'França',
  'Espanha',
  'Inglaterra',
  'Portugal',
  'Alemanha',
  'Croácia',
];

/** Estado inicial da partida da sala de demonstração. */
export const MATCH_START = { minute: 64, scoreA: 2, scoreB: 1 } as const;

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
}

/** As três abas da home. GET /api/fixtures devolve isto no lugar. */
export function fixtures(t: Dict): Record<'live' | 'next' | 'replays', FixtureView[]> {
  return {
    live: [
      {
        id: 'arg-cab',
        live: true,
        status: t.statusLive64,
        group: t.groupJ,
        teamA: t.tArgentina,
        teamB: t.tCaboVerde,
        scoreA: 2,
        scoreB: 1,
        cta: t.ctaEnter,
      },
      {
        id: 'esp-cor',
        live: true,
        status: t.statusLive31,
        group: t.groupF,
        teamA: t.tEspanha,
        teamB: t.tCoreia,
        scoreA: 0,
        scoreB: 0,
        cta: t.ctaEnter,
      },
    ],
    next: [
      {
        id: 'bra-mar',
        status: t.statusToday18,
        group: t.groupC,
        teamA: t.tBrasil,
        teamB: t.tMarrocos,
        scoreA: '–',
        scoreB: '–',
        cta: t.ctaRemind,
      },
      {
        id: 'fra-cro',
        status: t.statusToday21,
        group: t.groupH,
        teamA: t.tFranca,
        teamB: t.tCroacia,
        scoreA: '–',
        scoreB: '–',
        cta: t.ctaRemind,
      },
      {
        id: 'ing-eua',
        status: t.statusTomorrow16,
        group: t.groupB,
        teamA: t.tInglaterra,
        teamB: t.tEUA,
        scoreA: '–',
        scoreB: '–',
        cta: t.ctaRemind,
      },
    ],
    replays: [
      {
        id: 'ita-mex',
        status: t.statusEndYesterday,
        group: t.groupA,
        teamA: t.tItalia,
        teamB: t.tMexico,
        scoreA: 2,
        scoreB: 1,
        cta: t.ctaReplay,
      },
      {
        id: 'ale-por',
        status: t.statusEnd2days,
        group: t.groupE,
        teamA: t.tAlemanha,
        teamB: t.tPortugal,
        scoreA: 0,
        scoreB: 0,
        cta: t.ctaReplay,
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

export function liveStats(t: Dict): StatRow[] {
  return (
    [
      { label: t.statPossession, a: '61%', b: '39%', af: 61, bf: 39 },
      { label: t.statShots, a: 12, b: 5, af: 12, bf: 5 },
      { label: t.statOnTarget, a: 6, b: 2, af: 6, bf: 2 },
      { label: t.statCorners, a: 8, b: 3, af: 8, bf: 3 },
      { label: t.statFouls, a: 9, b: 11, af: 9, bf: 11 },
      { label: t.statCards, a: 1, b: 2, af: 1, bf: 2 },
    ] as const
  ).map((x) => ({
    label: x.label,
    a: x.a,
    b: x.b,
    // Piso de 0.4: com flex 0 a barra some e o zero fica invisível.
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
  return [
    { id: 'a', name: 'Dudu_10', xp: 640 },
    { id: 'me', name: t.you, xp: 180 + salaXp },
    { id: 'b', name: 'BiaZ', xp: 150 },
  ]
    .sort((a, b) => b.xp - a.xp)
    .map((r, i) => ({ ...r, pos: i + 1 }));
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
      name: 'Dudu_10',
      initials: 'DD',
      sub: `${t.leagueGold} · 12 ${t.correctToday}`,
      xp: 3120,
      avBg: 'var(--gold)',
      avColor: 'var(--accent-on)',
    },
    {
      name: 'MarianaGols',
      initials: 'MG',
      sub: `${t.leagueGold} · 9 ${t.correctToday}`,
      xp: 2870,
      avBg: 'var(--blue)',
      avColor: 'var(--accent-on)',
    },
    {
      name: 'zé.craque',
      initials: 'ZC',
      sub: `${t.leagueSilver} · 8 ${t.correctToday}`,
      xp: 2540,
      avBg: 'var(--orange)',
      avColor: 'var(--accent-on)',
    },
    {
      name: 'BiaZ',
      initials: 'BZ',
      sub: t.leagueSilver,
      xp: 1980,
      avBg: 'var(--surface-2)',
      avColor: 'var(--text-1)',
    },
    {
      name: me.nickname,
      initials: me.initials,
      sub: t.meSubYou,
      xp: me.xp,
      avBg: 'var(--lime)',
      avColor: 'var(--on-lime)',
      me: true,
    },
    {
      name: 'PedroH',
      initials: 'PH',
      sub: t.leagueBronze,
      xp: 1120,
      avBg: 'var(--surface-2)',
      avColor: 'var(--text-1)',
    },
    {
      name: 'Rafa_ARG',
      initials: 'RA',
      sub: t.leagueBronze,
      xp: 980,
      avBg: 'var(--surface-2)',
      avColor: 'var(--text-1)',
    },
  ]
    .sort((a, b) => b.xp - a.xp)
    .map((r, i) => ({ ...r, pos: i + 1 }));
}

/** Total de fãs na sala — placeholder até o WS `ranking` chegar. */
export const ROOM_SIZE = 2418;
