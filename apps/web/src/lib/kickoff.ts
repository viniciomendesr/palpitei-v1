import type { Lang } from './preferred-lang';

/**
 * Kickoff labels.
 *
 * The devnet snapshot can carry two legs of the same pair days apart (measured
 * 2026-07-20: Australia x Brazil on 09-25 and 09-29, New Zealand x India on
 * 11-12 and 11-15). Without the date those cards are indistinguishable and read
 * as a duplicated row, so the date is what makes a real fixture legible — never
 * deduplication by team names, which would drop a real match.
 *
 * `startTs` is an epoch in milliseconds and is rendered in the viewer's own time
 * zone. There is no fallback instant: a caller without a kickoff must show its
 * own copy rather than let this module invent one.
 */

/** `sentence` reads inside prose ("Hoje, 16:00"); `label` is the card's uppercase day. */
export type KickoffStyle = 'sentence' | 'label';

const WORDS = {
  pt: { today: 'Hoje', tomorrow: 'Amanhã' },
  en: { today: 'Today', tomorrow: 'Tomorrow' },
} as const;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Calendar date without the weekday.
 *
 * English gets the month by name because `05/10` is read as 10 May by an
 * en-US reader and 5 October by a pt-BR one — the same six fixtures would
 * carry two different meanings off one string.
 */
function calendarDay(d: Date, lang: Lang, showYear: boolean): string {
  if (lang === 'en') {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      ...(showYear ? { year: 'numeric' } : {}),
    }).format(d);
  }
  const dm = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  return showYear ? `${dm}/${d.getFullYear()}` : dm;
}

/** Formats the kickoff instant for the current locale and time zone. */
export function formatKickoff(
  startTs: number,
  now: number,
  lang: Lang,
  style: KickoffStyle = 'sentence',
): string {
  const d = new Date(startTs);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const startOfDay = new Date(startTs).setHours(0, 0, 0, 0);
  const today = new Date(now).setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfDay - today) / 86_400_000);

  const words = WORDS[lang];
  let day: string;
  // Only the actual calendar day is "today". A kickoff already in the past keeps
  // its real date: calling yesterday "today" would be an invented fact on a
  // public screen, and the caller can no longer tell the two apart.
  if (dayDiff === 0) day = words.today;
  else if (dayDiff === 1) day = words.tomorrow;
  else day = calendarDay(d, lang, d.getFullYear() !== new Date(now).getFullYear());

  // The card label carries the day alone. What it has to answer is "which of these
  // two legs is this one", and the kickoff time does not help with that — it only
  // competes with the team names for a narrow row. The prose style keeps the time,
  // because the pre-match screen pairs it with how long the window stays open.
  return style === 'label' ? day.toUpperCase() : `${day}, ${time}`;
}
