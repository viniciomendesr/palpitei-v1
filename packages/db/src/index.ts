// Postgres (Supabase) schema and repository layer. Supabase is used only as
// Postgres: verified privy_did is the identity and only the backend connects.

export { createDb, assertDbReady } from './pool.js';
export type { Db, Executor, CreateDbOptions, Row } from './pool.js';

export { uid } from './ids.js';
export * from './types.js';
export * from './errors.js';

export { createUserRepo, validateHandle } from './repos/userRepo.js';
export type { UserRepo, FindOrCreateOpts } from './repos/userRepo.js';

export {
  createLeagueRepo,
  validateLeagueName,
  normalizeLeagueCode,
  LIGAS_FREE,
} from './repos/leagueRepo.js';
export type { LeagueRepo } from './repos/leagueRepo.js';

export { createLobbyRepo, normalizeLobbyCode } from './repos/lobbyRepo.js';
export type { LobbyRepo } from './repos/lobbyRepo.js';

export { createMatchRepo } from './repos/matchRepo.js';
export type { MatchRepo } from './repos/matchRepo.js';

export { createEventRepo, mapRawScoreEvent } from './repos/eventRepo.js';
export type { EventRepo, UpsertStats } from './repos/eventRepo.js';

export { createOddsRepo, isFullGame1x2, oddsMessageKey, MERCADO_1X2 } from './repos/oddsRepo.js';
export type { OddsRepo, OddsUpsertStats } from './repos/oddsRepo.js';

export { createQuestionRepo } from './repos/questionRepo.js';
export type { QuestionRepo } from './repos/questionRepo.js';

export { createQuestionTemplateRepo } from './repos/questionTemplateRepo.js';
export type { QuestionTemplateRepo, QuestionTemplate } from './repos/questionTemplateRepo.js';

export { createGameSessionRepo } from './repos/gameSessionRepo.js';
export type { GameSessionRepo, GameSession } from './repos/gameSessionRepo.js';

export { createLiveFixtureRepo } from './repos/liveFixtureRepo.js';
export type { LiveFixtureRepo, LiveFixture } from './repos/liveFixtureRepo.js';

export { createPredictionRepo } from './repos/predictionRepo.js';
export type { PredictionRepo, SettleResult, PredictionResult } from './repos/predictionRepo.js';

export { createPregamePickRepo } from './repos/pregamePickRepo.js';
export type {
  PregamePickRepo,
  PregamePick,
  PregamePickFields,
  PregameFinalTotals,
  PregameGradeFn,
} from './repos/pregamePickRepo.js';

export { createMarketRepo } from './repos/marketRepo.js';
export type { MarketRepo } from './repos/marketRepo.js';

export { createGamificationRepo } from './repos/gamificationRepo.js';
export type { GamificationRepo } from './repos/gamificationRepo.js';

export { createMatchCacheStore } from './matchCacheStore.js';
export type { MatchCacheStore, SaveCacheStats } from './matchCacheStore.js';

export { createEnginePorts } from './enginePorts.js';
export type { EnginePorts } from './enginePorts.js';

import { createDb, type CreateDbOptions, type Db } from './pool.js';
import { createEnginePorts, type EnginePorts } from './enginePorts.js';
import { createMatchCacheStore, type MatchCacheStore } from './matchCacheStore.js';
import { createEventRepo, type EventRepo } from './repos/eventRepo.js';
import { createGamificationRepo, type GamificationRepo } from './repos/gamificationRepo.js';
import { createLeagueRepo, type LeagueRepo } from './repos/leagueRepo.js';
import { createLobbyRepo, type LobbyRepo } from './repos/lobbyRepo.js';
import { createMarketRepo, type MarketRepo } from './repos/marketRepo.js';
import { createMatchRepo, type MatchRepo } from './repos/matchRepo.js';
import { createOddsRepo, type OddsRepo } from './repos/oddsRepo.js';
import { createPredictionRepo, type PredictionRepo } from './repos/predictionRepo.js';
import { createPregamePickRepo, type PregamePickRepo } from './repos/pregamePickRepo.js';
import { createQuestionRepo, type QuestionRepo } from './repos/questionRepo.js';
import { createQuestionTemplateRepo, type QuestionTemplateRepo } from './repos/questionTemplateRepo.js';
import { createGameSessionRepo, type GameSessionRepo } from './repos/gameSessionRepo.js';
import { createLiveFixtureRepo, type LiveFixtureRepo } from './repos/liveFixtureRepo.js';
import { createUserRepo, type UserRepo } from './repos/userRepo.js';

export type Palpitei = {
  db: Db;
  users: UserRepo;
  matches: MatchRepo;
  events: EventRepo;
  odds: OddsRepo;
  questions: QuestionRepo;
  questionTemplates: QuestionTemplateRepo;
  sessions: GameSessionRepo;
  liveFixtures: LiveFixtureRepo;
  predictions: PredictionRepo;
  pregame: PregamePickRepo;
  markets: MarketRepo;
  gamification: GamificationRepo;
  leagues: LeagueRepo;
  lobbies: LobbyRepo;
  cache: MatchCacheStore;
  ports: EnginePorts;
  close(): Promise<void>;
};

/**
 * Builds the repository layer over one connection.
 *
 *   const palpitei = createPalpitei();          // usa DATABASE_URL
 *   const fa = await palpitei.users.findOrCreateByPrivyDid(did, { wallet, walletSource });
 *
 * Use one instance per process; Pool handles concurrency.
 */
export function createPalpitei(opts: CreateDbOptions = {}): Palpitei {
  const db = createDb(opts);
  return {
    db,
    users: createUserRepo(db),
    matches: createMatchRepo(db),
    events: createEventRepo(db),
    odds: createOddsRepo(db),
    questions: createQuestionRepo(db),
    questionTemplates: createQuestionTemplateRepo(db),
    sessions: createGameSessionRepo(db),
    liveFixtures: createLiveFixtureRepo(db),
    predictions: createPredictionRepo(db),
    pregame: createPregamePickRepo(db),
    markets: createMarketRepo(db),
    gamification: createGamificationRepo(db),
    leagues: createLeagueRepo(db),
    lobbies: createLobbyRepo(db),
    cache: createMatchCacheStore(db),
    ports: createEnginePorts(db),
    close: () => db.close(),
  };
}
