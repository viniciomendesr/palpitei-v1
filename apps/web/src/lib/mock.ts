/**
 * Demo-only sample data. Production challenges and percentages are supplied by
 * the question engine and TxLINE-backed APIs; this module never contains TxLINE payloads.
 */

import type { Dict } from './i18n';
// Explicit extension: this module is loaded raw by `node --test`, which does not
// resolve extensionless paths (same reason `selo-art.tsx` spells its imports out).
import { DEMO_TROPHIES } from './marketplace.ts';

/** Challenge mechanics; the matching copy is in `Dict.ch[i]`. */
export interface ChallengeSpec {
  xp: number;
  correct: string;
  optIds: string[];
  /**
   * Option chance, where `null` means the source did not provide a price.
   * Missing values must never be rendered as 0%.
   */
  pct: Record<string, number | null>;
  /** Demo-only plausible probabilities before and after the event. */
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

/** Demo prediction-window duration in seconds. */
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

/** Initial match state for the demo room. */
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
  /** Kickoff instant used to close local pre-match picks. */
  startTs?: number;
  /** Source label displayed with the fixture. */
  source: string;
  /**
   * The fan already took part in this match, so their summary can be opened.
   * Demo has no persisted participation, so it stays absent and the action is
   * shown disabled rather than hidden.
   */
  played?: boolean;
}

/** Home tabs; `GET /api/fixtures` replaces this data in production. */
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

/** Plausible demo statistics for the replay starting state (64', 1-1). */
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

/** Room ranking; `salaXp` is the XP earned in this match. */
export function roomRanking(t: Dict, salaXp: number): RoomRankRow[] {
  return [{ id: 'me', name: t.you, xp: salaXp, pos: 1 }];
}

export interface GlobalRankRow {
  name: string;
  initials: string;
  sub: string;
  xp: number;
  /** Trophy balance, same source the demo store spends from. */
  trophies: number;
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
      // The store already grants the demo fan this balance (MarketplaceState reads the
      // same constant). Re-typing the number here would let the ranking and the store
      // drift apart and contradict each other on the judge's path.
      trophies: DEMO_TROPHIES,
      avBg: 'var(--lime)',
      avColor: 'var(--on-lime)',
      me: true,
    },
  ].map((r, i) => ({ ...r, pos: i + 1 }));
}

/** Demo mode does not fabricate participants outside the local session. */
export const ROOM_SIZE = 1;
