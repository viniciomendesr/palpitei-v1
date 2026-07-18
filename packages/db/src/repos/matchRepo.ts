import type { Db, Row } from '../pool.js';
import type { CacheSource, Fixture, MatchState } from '../types.js';

function mapFixture(r: Row): Fixture {
  const out: Fixture = {
    fixtureId: Number(r.fixture_id),
    p1: String(r.p1),
    p2: String(r.p2),
    state: r.state as MatchState,
  };
  if (r.p1_id != null) out.p1Id = Number(r.p1_id);
  if (r.p2_id != null) out.p2Id = Number(r.p2_id);
  if (r.competition != null) out.competition = String(r.competition);
  if (r.competition_id != null) out.competitionId = Number(r.competition_id);
  if (r.start_ts != null) out.startTime = Number(r.start_ts);
  if (r.game_state_raw != null) out.gameState = Number(r.game_state_raw);
  // Return provenance with the match so consumers can render an accurate label.
  if (r.cache_source != null) out.cacheSource = r.cache_source as CacheSource;
  return out;
}

const COLS = `fixture_id, competition, competition_id, p1, p2, p1_id, p2_id,
              start_ts, state, game_state_raw, cache_source, cached_at`;

export function createMatchRepo(db: Db) {
  const repo = {
    async findById(fixtureId: number): Promise<Fixture | null> {
      const rows = await db.query(`select ${COLS} from matches where fixture_id = $1`, [fixtureId]);
      return rows[0] ? mapFixture(rows[0]) : null;
    },

    /**
     * Upsert never degrades known optional fields. State uses the explicit
     * parameter rather than the insert default, so unknown-state upserts cannot
     * regress live or finished matches to scheduled.
     */
    async upsert(fx: Fixture, opts: { source?: CacheSource; cachedAt?: number } = {}): Promise<Fixture> {
      const rows = await db.query(
        `
        insert into matches (fixture_id, competition, competition_id, p1, p2, p1_id, p2_id,
                             start_ts, game_state_raw, state, cache_source, cached_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::text, 'scheduled'),
                $11, case when $12::bigint is null then null else to_timestamp($12::bigint / 1000.0) end)
        on conflict (fixture_id) do update set
          competition    = coalesce(nullif(excluded.competition, ''), matches.competition),
          competition_id = coalesce(excluded.competition_id, matches.competition_id),
          p1             = coalesce(nullif(excluded.p1, ''), matches.p1),
          p2             = coalesce(nullif(excluded.p2, ''), matches.p2),
          p1_id          = coalesce(excluded.p1_id, matches.p1_id),
          p2_id          = coalesce(excluded.p2_id, matches.p2_id),
          start_ts       = coalesce(excluded.start_ts, matches.start_ts),
          game_state_raw = coalesce(excluded.game_state_raw, matches.game_state_raw),
          -- Use $10 instead of excluded.state. Null means unknown and must not
          -- downgrade a live or finished match to scheduled.
          state          = coalesce($10::text, matches.state),
          cache_source   = coalesce(excluded.cache_source, matches.cache_source),
          cached_at      = coalesce(excluded.cached_at, matches.cached_at),
          updated_at     = now()
        returning ${COLS}
        `,
        [
          fx.fixtureId,
          fx.competition ?? null,
          fx.competitionId ?? null,
          fx.p1,
          fx.p2,
          fx.p1Id ?? null,
          fx.p2Id ?? null,
          fx.startTime ?? null,
          fx.gameState ?? null,
          fx.state ?? null,
          opts.source ?? null,
          opts.cachedAt ?? null,
        ]
      );
      return mapFixture(rows[0] as Row);
    },

    async upsertMany(fixtures: Fixture[]): Promise<number> {
      let n = 0;
      for (const fx of fixtures) {
        await repo.upsert(fx);
        n++;
      }
      return n;
    },

    async list(opts: { state?: MatchState; limit?: number } = {}): Promise<Fixture[]> {
      const rows = await db.query(
        `select ${COLS} from matches
          where ($1::text is null or state = $1)
          order by start_ts nulls last, fixture_id
          limit $2`,
        [opts.state ?? null, opts.limit ?? 100]
      );
      return rows.map(mapFixture);
    },

    /** Matches with persisted timelines that can replay without the devnet. */
    /**
     * Replayable matches only: finished, with a recorded timeline.
     *
     * Having events is not enough. A live fixture starts persisting status events
     * before kick-off, and the fixtures route turns every row here into a "replay"
     * and a "training" card — so tonight's match showed up as "watch it again"
     * before it was played. A replay is a match that already ended.
     */
    async listCached(): Promise<Fixture[]> {
      const rows = await db.query(
        `select ${COLS} from matches m
          where m.state = 'finished'
            and exists (select 1 from match_events e where e.fixture_id = m.fixture_id)
          order by start_ts nulls last`
      );
      return rows.map(mapFixture);
    },

    async setState(fixtureId: number, state: MatchState): Promise<void> {
      await db.query(`update matches set state = $2, updated_at = now() where fixture_id = $1`, [
        fixtureId,
        state,
      ]);
    },

    /**
     * Matches without start_ts; these cannot safely open final-result questions.
     */
    async semStartTs(): Promise<number[]> {
      const rows = await db.query(`select fixture_id from matches where start_ts is null`);
      return rows.map((r) => Number(r.fixture_id));
    },
  };

  return repo;
}

export type MatchRepo = ReturnType<typeof createMatchRepo>;
