import type { Db, Row } from '../pool.js';

export type LiveFixture = {
  fixtureId: number;
  active: boolean;
  priority: number;
  activatedAt: number;
};

function mapLiveFixture(row: Row): LiveFixture {
  return {
    fixtureId: Number(row.fixture_id),
    active: Boolean(row.active),
    priority: Number(row.priority),
    activatedAt: Math.round(Number(row.activated_ms)),
  };
}

export function createLiveFixtureRepo(db: Db) {
  const repo = {
    async listActive(): Promise<LiveFixture[]> {
      const rows = await db.query(
        `select fixture_id, active, priority, extract(epoch from activated_at) * 1000 as activated_ms
           from live_fixtures where active order by priority desc, activated_at`,
      );
      return rows.map(mapLiveFixture);
    },

    async activate(fixtureId: number, priority = 0): Promise<void> {
      await db.query(
        `insert into live_fixtures (fixture_id, active, priority, activated_at, deactivated_at, updated_at)
         values ($1, true, $2, now(), null, now())
         on conflict (fixture_id) do update set
           active = true,
           priority = excluded.priority,
           deactivated_at = null,
           updated_at = now()`,
        [fixtureId, priority],
      );
    },

    /** Fixtures already retired from the live registry; used to stop local channels. */
    async listInactive(): Promise<LiveFixture[]> {
      const rows = await db.query(
        `select fixture_id, active, priority, extract(epoch from activated_at) * 1000 as activated_ms
           from live_fixtures where not active order by deactivated_at desc nulls last, fixture_id`,
      );
      return rows.map(mapLiveFixture);
    },

    /**
     * Retires a fixture at full time. The `and active` guard is what makes this
     * idempotent: a redelivered `game_finalised` must not move `deactivated_at`.
     */
    async deactivate(fixtureId: number): Promise<void> {
      await db.query(
        `update live_fixtures set active = false, deactivated_at = now(), updated_at = now()
          where fixture_id = $1 and active`,
        [fixtureId],
      );
    },

    /**
     * Retires every fixture whose match already ended. Returns what it retired.
     *
     * `deactivate` only fires on the terminal event, so a match that ended while
     * no process was watching — or before this code existed — keeps its row
     * active forever, and the 15s `sincronizarFixturesDoBanco` poll rebuilds its
     * channel on every boot. This sweep is the only leg that reaches those.
     *
     * The join to `matches.state = 'finished'` is the safety rail: it can never
     * retire a fixture that is still being played. `and lf.active` is the CAS —
     * a rerun returns zero rows and leaves `deactivated_at` untouched.
     */
    async deactivateFinishedMatches(): Promise<number[]> {
      const rows = await db.query(
        `update live_fixtures lf
            set active = false, deactivated_at = now(), updated_at = now()
           from matches m
          where m.fixture_id = lf.fixture_id and m.state = 'finished' and lf.active
        returning lf.fixture_id`,
      );
      return rows.map((row) => Number(row.fixture_id));
    },
  };
  return repo;
}

export type LiveFixtureRepo = ReturnType<typeof createLiveFixtureRepo>;
