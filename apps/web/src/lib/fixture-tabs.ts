import type { ApiFixture } from './api';

export type Tab = 'live' | 'next' | 'replays';

/** A fixture placed in a tab, flagged when it is a replay with no recording. */
export interface BucketedFixture extends ApiFixture {
  /**
   * A match that already kicked off but only ever appeared in the live snapshot:
   * nobody opened it live, so its timeline was never recorded and it cannot be
   * replayed. It still belongs in Replays — with a notice — because it happened.
   */
  naoGravada: boolean;
}

/**
 * Which tab a fixture belongs to, decided by kickoff time — not by source alone.
 *
 * The old rule sent every snapshot fixture to "Próximos" regardless of date, so a
 * match whose kickoff had passed stayed there looking upcoming. Time decides now:
 * a past kickoff is history, and history lives in Replays.
 */
export function classifyFixture(
  f: ApiFixture,
  now: number,
): { tab: Tab; naoGravada: boolean } {
  if (f.live) return { tab: 'live', naoGravada: false };
  // A recorded match carries a cache source (its events are in Postgres); it is a
  // real, playable replay.
  if (f.source !== 'txline') return { tab: 'replays', naoGravada: false };
  // A live-snapshot fixture whose kickoff already passed happened without anyone
  // watching it here, so it was never recorded.
  if (f.startTime != null && f.startTime <= now) return { tab: 'replays', naoGravada: true };
  // Future, or no kickoff in the feed to judge by: keep it upcoming.
  return { tab: 'next', naoGravada: false };
}

/**
 * Buckets fixtures into the three home tabs, dropping a snapshot copy of a match
 * that is already present as a recording — a finished fixture the feed still lists
 * must not appear twice, and the playable recording wins.
 */
export function bucketFixtures(
  fixtures: ApiFixture[],
  now: number,
): Record<Tab, BucketedFixture[]> {
  const recordedIds = new Set(
    fixtures.filter((f) => f.source !== 'txline').map((f) => f.id),
  );
  const abas: Record<Tab, BucketedFixture[]> = { live: [], next: [], replays: [] };
  for (const f of fixtures) {
    if (f.source === 'txline' && recordedIds.has(f.id)) continue;
    const { tab, naoGravada } = classifyFixture(f, now);
    abas[tab].push({ ...f, naoGravada });
  }
  return abas;
}
