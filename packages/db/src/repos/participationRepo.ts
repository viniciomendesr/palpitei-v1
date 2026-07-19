/**
 * The fan's participation in a fixture, read back from persisted data.
 *
 * A participation is one execution ("run") that the fan placed predictions in.
 * Two facts decide how a run is identified:
 *
 *  - live play creates a `game_sessions` row, so `questions.session_id is not
 *    null` is the live marker; a replay run, even on the same fixture, carries
 *    no session;
 *  - `predictions.placed_at` is MATCH time (a replay simulates it) while
 *    `predictions.created_at` is the real wall clock. Anything about real
 *    chronology reads `created_at`. Reading `placed_at` makes a replay
 *    prediction look like it happened during the match.
 *
 * This repo only groups and reports. Which run counts as the FIRST participation
 * is a rule, not a query, and lives as a pure predicate in the web app so it can
 * be tested without a database.
 */

import type { Db, Row } from '../pool.js';

/** One execution the fan took part in, as the database knows it. */
export type ParticipationRun = {
  /** `predictions.run_id`; legacy rows fall back to a per-fixture bucket. */
  runId: string;
  /** True when any question of the run belonged to a live `game_sessions` run. */
  live: boolean;
  /** Real wall clock of the fan's first prediction in the run, in epoch ms. */
  firstAt: number;
};

/** One settled or pending prediction of a participation, shaped for the summary screen. */
export type ParticipationPick = {
  questionId: string;
  prompt: string;
  qtype: string;
  options: { id: string; label: string }[];
  choice: string;
  correctOptionId?: string;
  voidReason?: string;
  /** XP the engine awarded; zero while the question is unsettled. */
  gained: number;
};

/** Legacy rows predate `run_id`; they are one bucket per fixture, never invented runs. */
const RUN_ID = `coalesce(p.run_id, 'legacy:' || q.fixture_id::text)`;

export function createParticipationRepo(db: Db) {
  const repo = {
    /** Every run the fan placed a prediction in, oldest first by real clock. */
    async listRuns(userId: string, fixtureId: number): Promise<ParticipationRun[]> {
      const rows = await db.query(
        `select ${RUN_ID} as run_id,
                bool_or(q.session_id is not null) as live,
                extract(epoch from min(p.created_at)) * 1000 as first_ms
           from predictions p
           join questions q on q.id = p.question_id
          where p.user_id = $1 and q.fixture_id = $2
          group by 1
          order by min(p.created_at)`,
        [userId, fixtureId],
      );
      return rows.map((r: Row) => ({
        runId: String(r.run_id),
        live: Boolean(r.live),
        firstAt: Math.round(Number(r.first_ms)),
      }));
    },

    /** Fixture ids the fan has ever placed an in-play prediction on. */
    async listPlayedFixtures(userId: string): Promise<number[]> {
      const rows = await db.query(
        `select distinct q.fixture_id
           from predictions p
           join questions q on q.id = p.question_id
          where p.user_id = $1`,
        [userId],
      );
      return rows.map((r: Row) => Number(r.fixture_id));
    },

    /** The fan's own predictions in one run, in the order they were placed. */
    async listPicks(userId: string, fixtureId: number, runId: string): Promise<ParticipationPick[]> {
      const rows = await db.query(
        `select q.id, q.prompt, q.type, q.options, q.correct, q.void_reason,
                p.choice, coalesce(p.awarded_xp, 0)::int as gained
           from predictions p
           join questions q on q.id = p.question_id
          where p.user_id = $1 and q.fixture_id = $2 and ${RUN_ID} = $3
          order by p.created_at`,
        [userId, fixtureId, runId],
      );
      return rows.map((r: Row) => {
        const pick: ParticipationPick = {
          questionId: String(r.id),
          prompt: String(r.prompt),
          qtype: String(r.type),
          options: (r.options as { id: string; label: string }[]) ?? [],
          choice: String(r.choice),
          gained: Number(r.gained),
        };
        if (r.correct != null) pick.correctOptionId = String(r.correct);
        if (r.void_reason != null) pick.voidReason = String(r.void_reason);
        return pick;
      });
    },

    /** How many fans played that same run, the room's roster as it was. */
    async countPlayers(fixtureId: number, runId: string): Promise<number> {
      const rows = await db.query(
        `select count(distinct p.user_id)::int as n
           from predictions p
           join questions q on q.id = p.question_id
          where q.fixture_id = $1 and ${RUN_ID} = $2`,
        [fixtureId, runId],
      );
      return Number(rows[0]?.n ?? 0);
    },
  };

  return repo;
}

export type ParticipationRepo = ReturnType<typeof createParticipationRepo>;
