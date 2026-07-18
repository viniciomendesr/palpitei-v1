// TxLINE client and ingestion layer. It returns core NormEvent values without
// depending on rooms, users, XP, or the database.

export { config } from "./config.ts";
export { info, warn, error, recentLogs, type LogLevel, type LogLine } from "./log.ts";

export {
  TxlineAuthError,
  TxlineHttpError,
  TxlineSweepError,
  isHttpStatus,
  errorMessage,
} from "./errors.ts";

// Service credentials; fan identity is the separately verified privy_did.
export {
  authStatus,
  ensureJwt,
  getCredentials,
  resetCredentials,
  setApiToken,
  setCredentials,
  startGuestSession,
  txlineFetch,
  txlineGet,
  type TxlineCredentials,
} from "./auth.ts";

export {
  createTimeBuckets,
  findSequenceGaps,
  fetchFixtureNames,
  fetchFixtures,
  fetchHistorical,
  fetchOddsSnapshot,
  fetchOddsUpdates,
  fetchScoresSnapshot,
  fetchScoresUpdates,
  fetchStatValidation,
  type TimeBucket,
  type SweepStats,
} from "./api.ts";

export {
  adaptDbCacheStore,
  hasUsableMatchCache,
  createFileMatchCacheStore,
  createInMemoryMatchCacheStore,
  type MatchCacheSource,
  type MatchCacheRecord,
  type MatchCacheStore,
} from "./cache.ts";

export {
  isLiveIngestActive,
  liveSummary,
  liveStatus,
  secondsSinceLastEvent,
  startLiveIngest,
  stopLiveIngest,
  type LiveState,
  type LiveStatus,
} from "./ingest/live.ts";

export {
  ReplayRunner,
  isMatchInProgress,
  maxReplayGapMs,
  hasRealMatchContent,
  loadReplayEvents,
  type LoadReplayOpts,
  type ReplayLoad,
  type ReplaySource,
} from "./ingest/replay.ts";

// Development-only and opt-in. See ingest/demo.ts before using it.
export { generateDemoEvents, isSyntheticAllowed } from "./ingest/demo.ts";
