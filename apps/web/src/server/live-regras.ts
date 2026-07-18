/** Pure live-channel feature gates and room-routing rules. */

import type { NormEvent } from '@palpitei/core';
import { MERCADO_1X2 } from '@palpitei/db';

type EnvDoCanal = { TXLINE_LIVE_INGEST?: string; LIVE_FIXTURE_ID?: string; LIVE_FIXTURE_IDS?: string } & Record<
  string,
  string | undefined
>;

/** Requires an explicit opt-in even when fixture selection comes from the database. */
export function ingestAoVivoHabilitado(env: EnvDoCanal): boolean {
  return env.TXLINE_LIVE_INGEST === 'true';
}

/** Returns legacy environment-selected fixtures when live ingest is enabled. */
export function fixturesAoVivo(env: EnvDoCanal): number[] {
  if (!ingestAoVivoHabilitado(env)) return [];
  const bruto = env.LIVE_FIXTURE_IDS ?? env.LIVE_FIXTURE_ID ?? '';
  const ids = bruto
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

/** Compatibility helper for callers that need one fixture. */
export function fixtureAoVivo(env: EnvDoCanal): number | null {
  return fixturesAoVivo(env)[0] ?? null;
}

/** Returns whether an event makes a fixture eligible for settlement. */
export function eventoEncerraPartida(ev: NormEvent): boolean {
  return ev.kind === 'score' && (ev.action === 'game_finalised' || (ev.statusId === 100 && ev.period === 100));
}

export type ClasseDoEvento = 'rotear' | 'outra_fixture' | 'fora_do_mercado';

/** Classifies a stream event for room delivery. Persistence follows separate rules. */
export function classificarParaSala(ev: NormEvent, fixtureId: number): ClasseDoEvento {
  if (ev.fixtureId !== fixtureId) return 'outra_fixture';
  if (ev.kind === 'odds' && (ev.marketType !== MERCADO_1X2 || ev.marketPeriod != null)) {
    return 'fora_do_mercado';
  }
  return 'rotear';
}
