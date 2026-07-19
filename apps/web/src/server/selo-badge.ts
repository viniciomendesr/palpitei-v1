/**
 * Slug parsing and data-to-view mapping for the Selo TxLINE seal image.
 *
 * THE SEAL IS PER MATCH, NOT PER FAN. Every fan who debuted on one match points
 * at the same image (`buildSeloMetadata` derives it from `matchSlug` alone), and
 * that is deliberate: a selo is a stamp, and stamps are identical by nature. The
 * fan, the question, the palpite and the timestamp live in the traits, where
 * they are legible; rendered into a wallet thumbnail they would not be.
 *
 * WHAT KEEPS THE ART HONEST. The route does not accept a fixture id and does not
 * carry its own table of matches. It receives a slug, and the ONLY way to turn a
 * slug into a match is `matchSlug()` from `@palpitei/selo` — the same function,
 * not a copy, that built the `image` URL inside the metadata document. So the
 * teams and the date drawn on the seal come from the very `matches` row that
 * produced the metadata, and a slug that row would not generate resolves to
 * nothing and 404s.
 *
 * The seal says nothing about how the palpite went. It cannot: no fan and no
 * palpite reach this module.
 */

import { matchSlug } from '@palpitei/selo/metadata';

/**
 * Canvas edge, in pixels. Square, because that is what wallets and marketplaces
 * assume and the only shape that survives every thumbnail crop unchanged.
 *
 * 1000px: above the 800px marketplace floor for a crisp full-size view, and an
 * exact enough multiple of a 64px wallet thumbnail that downscaling stays clean.
 */
export const SELO_IMAGE_SIZE = 1000;

/**
 * Scale from the design system's 420px phone screen to the canvas.
 *
 * Every spatial and type token is multiplied by this, so the seal inherits the
 * app's proportions instead of a second, invented scale.
 */
export const SELO_SCALE = SELO_IMAGE_SIZE / 420;

/** What the seal draws. Nothing here can imply an outcome. */
export type SeloMatchView = {
  /** Home team, upper case. Satori has no `text-transform`. */
  home: string;
  /** Away team, upper case. */
  away: string;
  /** Kickoff date, pt-BR. */
  dateLabel: string;
  /** The slug this view was resolved from, for the caller to assert against. */
  slug: string;
};

/** A match row, narrowed to the fields the seal is allowed to see. */
export type SeloMatchRow = { p1: string; p2: string; startTime?: number };

/**
 * Splits an image request into the slug and the UTC day it encodes.
 *
 * The trailing `YYYY-MM-DD` is what makes this parseable at all: both halves of
 * a slug contain hyphens, so team names and date can only be told apart by the
 * date's fixed shape. The day is used to narrow the database lookup; the full
 * slug is still compared with `matchSlug()` afterwards, so a request that
 * guesses a plausible date still has to name a real match.
 *
 * Returns null for anything that is not `<slug>.png`, which the route turns into
 * a 404 rather than a blank image.
 */
export function parseSeloImageName(name: string): { slug: string; isoDate: string } | null {
  if (!name.endsWith('.png')) return null;
  const slug = name.slice(0, -'.png'.length);
  const match = /^[a-z0-9]+(?:-[a-z0-9]+)*-(\d{4}-\d{2}-\d{2})$/.exec(slug);
  if (!match) return null;
  const isoDate = match[1]!;
  // Rejects 2026-13-40: a well-shaped date that names no day would otherwise
  // reach the database as a query that quietly returns nothing.
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== isoDate) return null;
  return { slug, isoDate };
}

/** Kickoff as the fan reads it. UTC, the same instant the slug and the anchor use. */
export function formatMatchDate(timestampMs: number): string {
  const iso = new Date(timestampMs).toISOString().slice(0, 10);
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Picks the match a slug names, out of the candidates for that day.
 *
 * Comparison is by regenerating the slug with `matchSlug()`, never by matching
 * team names loosely: the slug is an exact function of `(p1, p2, start_ts)` and
 * anything looser would let one match answer for another's URL.
 */
export function findMatchForSlug<T extends SeloMatchRow>(slug: string, candidates: readonly T[]): T | null {
  for (const row of candidates) {
    if (row.startTime == null) continue;
    if (matchSlug(row.p1, row.p2, row.startTime) === slug) return row;
  }
  return null;
}

/**
 * Maps a match row to the seal's view model.
 *
 * A row without `start_ts` yields null, the same rule the mint script enforces:
 * without a kickoff there is no date, no slug and no anchor day, so there is no
 * badge to draw.
 */
export function seloMatchView(row: SeloMatchRow): SeloMatchView | null {
  if (row.startTime == null) return null;
  return {
    home: row.p1.toUpperCase(),
    away: row.p2.toUpperCase(),
    dateLabel: formatMatchDate(row.startTime),
    slug: matchSlug(row.p1, row.p2, row.startTime),
  };
}

/**
 * Type size for the team names, in canvas pixels.
 *
 * The names are the seal's loudest element and the one thing whose length is not
 * under our control: `--display-lg` fits ENGLAND but would push a longer name
 * past the gutter and Satori would clip it without a word. Stepping the size
 * down by the longest name keeps the block inside the frame instead.
 *
 * Even the top step sits slightly under `--display-lg`. Two names at the full
 * token overflowed the card VERTICALLY, and the symptom was the milestone pill
 * drawn over the footer rule — Satori has no overflow to catch it. Measured by
 * rendering FRANCE x ENGLAND and looking at it, not by arithmetic.
 */
export function teamNameFontSize(view: Pick<SeloMatchView, 'home' | 'away'>, displayLgPx: number): number {
  const longest = Math.max(view.home.length, view.away.length);
  if (longest <= 8) return displayLgPx * 0.88;
  if (longest <= 11) return displayLgPx * 0.8;
  if (longest <= 15) return displayLgPx * 0.62;
  return displayLgPx * 0.5;
}
