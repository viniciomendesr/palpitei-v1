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

    async deactivate(fixtureId: number): Promise<void> {
      await db.query(
        `update live_fixtures set active = false, deactivated_at = now(), updated_at = now() where fixture_id = $1`,
        [fixtureId],
      );
    },
  };
  return repo;
}

export type LiveFixtureRepo = ReturnType<typeof createLiveFixtureRepo>;
