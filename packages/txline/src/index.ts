// @palpitei/txline — cliente da TxLINE e camada de ingestão.
//
// A TxLINE é a fonte primária do jogo (regra da trilha). Este pacote fala com
// ela e devolve NormEvent do @palpitei/core; ele não conhece salas, usuários,
// XP nem banco. O cache de partida entra por injeção (MatchCacheStore), porque
// o payload da TxLINE não pode ser versionado (T&C §7) — quem tem SQL é o db.

export { config } from "./config.ts";
export { info, warn, error, recentLogs, type LogLevel, type LogLine } from "./log.ts";

export {
  TxlineAuthError,
  TxlineHttpError,
  TxlineSweepError,
  isHttpStatus,
  motivo,
} from "./errors.ts";

// Credenciamento do SERVIÇO (não é a identidade do fã — essa é o privy_did).
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
  baldes,
  buracosDeSeq,
  fetchFixtureNames,
  fetchFixtures,
  fetchHistorical,
  fetchOddsSnapshot,
  fetchOddsUpdates,
  fetchScoresSnapshot,
  fetchScoresUpdates,
  fetchStatValidation,
  type Balde,
  type SweepStats,
} from "./api.ts";

export {
  adaptDbCacheStore,
  cacheUtil,
  createFileMatchCacheStore,
  createInMemoryMatchCacheStore,
  type MatchCacheFonte,
  type MatchCacheRecord,
  type MatchCacheStore,
} from "./cache.ts";

export {
  liveAtivo,
  liveResumo,
  liveStatus,
  segundosEmSilencio,
  startLiveIngest,
  stopLiveIngest,
  type LiveState,
  type LiveStatus,
} from "./ingest/live.ts";

export {
  ReplayRunner,
  emJogo,
  gapTetoMs,
  hasRealMatchContent,
  loadReplayEvents,
  type LoadReplayOpts,
  type ReplayLoad,
  type ReplaySource,
} from "./ingest/replay.ts";

// DEV-ONLY, opt-in. Ver o cabeçalho de ingest/demo.ts antes de usar.
export { generateDemoEvents, sinteticoPermitido } from "./ingest/demo.ts";
