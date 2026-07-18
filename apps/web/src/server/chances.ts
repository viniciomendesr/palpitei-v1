/** Pure room chance-reading helpers, kept separate from room orchestration. */

import type { NormEvent, OddsEvent, ScoreEvent } from '@palpitei/core';

/** Structured chance explanation sent in room state. */
export type ChanceReading = {
  /** Stable event-and-option identity for SSE reconnects. */
  id: string;
  ts: number;
  minute: number | null;
  priceName: string;
  fromPct: number;
  toPct: number;
  /** Context action such as `goal`, when available. */
  contextAction?: string;
  text: string;
};

/** Maximum number of readings included in room state. */
export const MAX_CHANCE_READINGS = 60;

/**
 * Merges score and odds timelines by timestamp, keeping score first on ties.
 * Score events retain feed order instead of being independently sorted.
 */
export function mergeTimeline(scoreEvents: ScoreEvent[], oddsEvents: OddsEvent[]): NormEvent[] {
  const linha: NormEvent[] = [];
  let i = 0;
  let j = 0;
  while (i < scoreEvents.length && j < oddsEvents.length) {
    if (scoreEvents[i]!.ts <= oddsEvents[j]!.ts) linha.push(scoreEvents[i++]!);
    else linha.push(oddsEvents[j++]!);
  }
  while (i < scoreEvents.length) linha.push(scoreEvents[i++]!);
  while (j < oddsEvents.length) linha.push(oddsEvents[j++]!);
  return linha;
}

/** Latest 1X2 percentage per option; absent keys have not been supplied by the feed. */
export type Pct1x2 = { p1?: number; draw?: number; p2?: number };

/** Maps a feed price name to the `final_result` option identifier. */
export function optionIdFor1x2(priceName: string): keyof Pct1x2 | null {
  const n = priceName.toLowerCase();
  if (n === 'part1' || n === '1' || n === 'home') return 'p1';
  if (n === 'draw' || n === 'x') return 'draw';
  if (n === 'part2' || n === '2' || n === 'away') return 'p2';
  return null;
}

/** Updates only 1X2 options included in the event. */
export function update1x2Percentages(percentages: Pct1x2, event: OddsEvent): void {
  for (const price of event.prices) {
    const optionId = optionIdFor1x2(price.name);
    if (optionId) percentages[optionId] = price.pct;
  }
}

/** Stores newest readings first and bounds room-state payload size. */
export function recordChanceReading(readings: ChanceReading[], reading: ChanceReading): void {
  readings.unshift(reading);
  if (readings.length > MAX_CHANCE_READINGS) readings.length = MAX_CHANCE_READINGS;
}
