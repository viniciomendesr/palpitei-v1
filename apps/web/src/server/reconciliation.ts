/**
 * Closes rooms that a restart orphaned.
 *
 * Rooms live in the process-local `salas` map (rooms.ts). A deploy during a match
 * wipes it, so the rooms created before the restart no longer exist when
 * `game_finalised` arrives and `finalizarSala` never runs for them: their
 * `game_sessions` stay `active` and their lobbies stay `started` for a match that
 * is over — "the room is still up after the match ended".
 *
 * Chosen strategy: BOTH legs, because neither covers the other.
 *  - at the terminal event (live.ts) — fixes the party orphaned by the restart
 *    that already happened, at the moment the whistle blows;
 *  - at boot (instrumentation.ts) — fixes rows already stranded by a match that
 *    ended while no process held the room, which the first leg can never revisit.
 *
 * Both are the same idempotent SQL: `game_sessions` moves only under
 * `status = 'active'` joined to `matches.state = 'finished'`, and lobbies move
 * only under `phase in ('started','finished')`. Nothing here credits XP —
 * settlement stays CAS-based in `predictionRepo.settle` and
 * `pregamePickRepo.settleFixture` — and nothing here re-runs a finished match:
 * `markStarted` still refuses a `finished` lobby, so restarting needs a new party.
 */

import { createGameSessionRepo, createLiveFixtureRepo, createLobbyRepo } from '@palpitei/db';
import { info, warn } from '@palpitei/txline';
import { createDb } from './db';

/**
 * Retires fixtures whose match already ended, and reports what it retired.
 *
 * `deactivate` only fires on the terminal event, so a match that ended while no
 * process was holding it keeps `live_fixtures.active = true` forever and the 15s
 * `sincronizarFixturesDoBanco` poll rebuilds its channel on every boot — a
 * finished match showing up as a live channel in `/api/live/status`. Closing the
 * local channel needs no extra work: once the row is inactive, that same poll
 * drops it through `channelsToClose`.
 */
export async function retireFinishedLiveFixtures(): Promise<number[]> {
  const db = createDb();
  try {
    const retired = await createLiveFixtureRepo(db).deactivateFinishedMatches();
    if (retired.length) info(`[reconciliação] fixture(s) encerrada(s) retirada(s) do ao vivo: ${retired.join(', ')}`);
    return retired;
  } catch (e) {
    // A failed sweep must never take the boot down with it.
    warn(`[reconciliação] retirada de fixtures encerradas falhou: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  } finally {
    await db.close?.();
  }
}

/** Returns how many stranded rooms were closed. `null` sweeps every fixture. */
export async function reconcileOrphanedRooms(fixtureId: number | null = null): Promise<number> {
  const db = createDb();
  try {
    const orphans = await createGameSessionRepo(db).finishOrphansOfFinishedMatches(fixtureId);
    if (!orphans.length) return 0;
    const lobbies = createLobbyRepo(db);
    for (const orphan of orphans) {
      // The party id is the invite code; system shutdown needs no host.
      await lobbies.markFinishedBySystem(orphan.partyId).catch((e: unknown) => {
        warn(
          `[reconciliação] lobby ${orphan.partyId} não fechou: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }
    info(
      `[reconciliação] ${orphans.length} sala(s) órfã(s) encerrada(s): ${orphans
        .map((o) => `${o.partyId}@${o.fixtureId}`)
        .join(', ')}`,
    );
    return orphans.length;
  } catch (e) {
    // A failed sweep must never take the boot or the live channel down with it.
    warn(`[reconciliação] varredura falhou: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  } finally {
    await db.close?.();
  }
}
