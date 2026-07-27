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

/**
 * `sentence` reads inside prose ("Hoje", "05/10/2026"); `label` is the same day
 * uppercased for a card. Neither carries the time: the fan asked upcoming matches
 * to show the date only, and the pre-game screen already pairs it with the
 * countdown to the pick's close.
 */
export type KickoffStyle = 'sentence' | 'label';

const WORDS = {
  pt: { today: 'Hoje', tomorrow: 'Amanhã' },
  en: { today: 'Today', tomorrow: 'Tomorrow' },
} as const;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Calendar date with the year, without the weekday.
 *
 * The year is shown by default: without it, a September fixture read on the same
 * calendar year still looked like an old match to the fan. `withYear` drops it
 * only where a leading date on the same card already carries it (a second leg of
 * the same pair), so the row does not repeat "/2026" twice and overflow.
 * "Hoje"/"Amanhã" never carry a year — they hold no date to disambiguate.
 *
 * English gets the month by name because `05/10` is read as 10 May by an
 * en-US reader and 5 October by a pt-BR one — the same six fixtures would
 * carry two different meanings off one string.
 */
function calendarDay(d: Date, lang: Lang, withYear: boolean): string {
  if (lang === 'en') {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(d);
  }
  const dm = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  return withYear ? `${dm}/${d.getFullYear()}` : dm;
}

/** Formats the kickoff instant for the current locale and time zone. */
export function formatKickoff(
  startTs: number,
  now: number,
  lang: Lang,
  style: KickoffStyle = 'sentence',
  withYear = true,
): string {
  const d = new Date(startTs);

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
  else day = calendarDay(d, lang, withYear);

  // Neither style carries the time. The card answers "which of these two legs is
  // this one", and the date alone does that; the pre-game screen shows the same
  // date and lets the countdown carry the urgency. `label` only upper-cases it.
  return style === 'label' ? day.toUpperCase() : day;
}
