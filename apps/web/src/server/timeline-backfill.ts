/**
 * Fills whatever the live stream missed, at the final whistle.
 *
 * The live ingest already persists every event it receives, so this is NOT the
 * thing that records a match: measured on 18/07, France x England ended with a
 * complete, gapless timeline (1195 events, seq 2..1196) purely from the stream.
 * What the stream cannot promise is COMPLETENESS. A disconnect, a suppressed
 * redelivery or a leader change can leave a hole, and a hole is invisible: the
 * replay simply skips a moment nobody knows was there.
 *
 * So the whistle triggers a reconciliation against `/scores/updates` and
 * `/odds/updates`, which are authoritative for a finished match. Everything is
 * upserted, and the repos are idempotent by `(fixture_id, seq)` for scores and by
 * message id for odds, so re-running changes nothing.
 *
 * This replaces having to remember `npm run cache:match <fixtureId>` after every
 * match. That command still exists and still matters for a fixture that was never
 * ingested live at all.
 *
 * It NEVER throws into the caller. A failed backfill must not take down the
 * terminal event path, which is what settles picks and closes rooms.
 */

import { createEventRepo, createOddsRepo, type Db } from '@palpitei/db';
import { fetchOddsUpdates, fetchScoresUpdates, ensureJwt } from '@palpitei/txline';
import { info, warn } from '@palpitei/txline';

/** How far back the sweep looks. A match plus its pre-game window. */
const JANELA_MS = 8 * 60 * 60 * 1000;

export type BackfillResult = {
  scoresAdded: number;
  oddsAdded: number;
  gapsBefore: number;
};

/** Counts missing sequence numbers between the lowest and highest we hold. */
async function countGaps(db: Db, fixtureId: number): Promise<number> {
  const rows = await db.query(
    `select count(*)::int as n, min(seq) as mn, max(seq) as mx
       from match_events where fixture_id = $1`,
    [fixtureId],
  );
  const row = rows[0];
  if (!row || Number(row.n) === 0) return 0;
  const esperado = Number(row.mx) - Number(row.mn) + 1;
  return Math.max(0, esperado - Number(row.n));
}

/**
 * Reconciles a finished fixture's timeline against the authoritative REST feed.
 *
 * Returns what it added so the caller can log a number rather than "done".
 */
export async function backfillFinishedTimeline(
  db: Db,
  fixtureId: number,
  startTs: number | null,
): Promise<BackfillResult | null> {
  try {
    const gapsBefore = await countGaps(db, fixtureId);
    await ensureJwt();

    // The sweep is windowed, so it needs a starting instant. Kick-off is the
    // honest anchor; without it we would guess, and a wrong window silently
    // returns nothing while looking like success.
    const desde = (startTs ?? Date.now()) - JANELA_MS / 8;
    const [scores, odds] = await Promise.all([
      fetchScoresUpdates(fixtureId, desde),
      fetchOddsUpdates(fixtureId, desde),
    ]);

    const events = createEventRepo(db);
    const oddsRepo = createOddsRepo(db);
    // RAW on purpose: `/updates` returns the feed rows, and the repos own the
    // normalization. Passing them as already-normalized events would silently
    // store the wrong shape.
    const gravouScores = scores.length ? await events.upsertManyRaw(scores) : { gravados: 0 };
    const gravouOdds = odds.length ? await oddsRepo.upsertManyRaw(odds) : { gravados: 0 };

    const resultado: BackfillResult = {
      scoresAdded: Number((gravouScores as { gravados?: number }).gravados ?? 0),
      oddsAdded: Number((gravouOdds as { gravados?: number }).gravados ?? 0),
      gapsBefore,
    };

    if (resultado.scoresAdded || resultado.oddsAdded) {
      info(
        `[backfill] fixture ${fixtureId}: ${resultado.scoresAdded} score(s) e ` +
          `${resultado.oddsAdded} odd(s) que o stream não trouxe (buracos antes: ${gapsBefore})`,
      );
    } else {
      info(`[backfill] fixture ${fixtureId}: timeline já estava completa pelo stream`);
    }
    return resultado;
  } catch (e) {
    // Never let this break the whistle. The manual `cache:match` remains the
    // fallback, and the warning is what tells an operator to run it.
    warn(
      `[backfill] fixture ${fixtureId} falhou: ${e instanceof Error ? e.message : String(e)} — ` +
        `rode "npm run cache:match ${fixtureId}" à mão para garantir a timeline`,
    );
    return null;
  }
}
