// @palpitei/db — schema Postgres (Supabase) e camada de repositório.
//
// O Supabase é usado SÓ como Postgres: a identidade é o `privy_did` verificado,
// não há Supabase Auth, não há RLS de auth.uid(), e não há client Supabase no
// browser. Só o backend fala com o banco, por connection string.

export { createDb, assertDbReady } from './pool.js';
export type { Db, Executor, CreateDbOptions, Row } from './pool.js';

export { uid } from './ids.js';
export * from './types.js';
export * from './errors.js';

export { createUserRepo, validarHandle } from './repos/userRepo.js';
export type { UserRepo, FindOrCreateOpts } from './repos/userRepo.js';

export {
  createLeagueRepo,
  validarNomeDeLiga,
  normalizarCodigo,
  LIGAS_FREE,
} from './repos/leagueRepo.js';
export type { LeagueRepo } from './repos/leagueRepo.js';

export { createLobbyRepo, normalizarCodigoLobby } from './repos/lobbyRepo.js';
export type { LobbyRepo } from './repos/lobbyRepo.js';

export { createMatchRepo } from './repos/matchRepo.js';
export type { MatchRepo } from './repos/matchRepo.js';

export { createEventRepo, rawParaEvento } from './repos/eventRepo.js';
export type { EventRepo, UpsertStats } from './repos/eventRepo.js';

export { createOddsRepo, eh1x2JogoInteiro, chaveDaCotacao, MERCADO_1X2 } from './repos/oddsRepo.js';
export type { OddsRepo, OddsUpsertStats } from './repos/oddsRepo.js';

export { createQuestionRepo } from './repos/questionRepo.js';
export type { QuestionRepo } from './repos/questionRepo.js';

export { createPredictionRepo } from './repos/predictionRepo.js';
export type { PredictionRepo, SettleResult, ResultadoPalpite } from './repos/predictionRepo.js';

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
import { createUserRepo, type UserRepo } from './repos/userRepo.js';

export type Palpitei = {
  db: Db;
  users: UserRepo;
  matches: MatchRepo;
  events: EventRepo;
  odds: OddsRepo;
  questions: QuestionRepo;
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
 * Monta a camada inteira sobre uma conexão.
 *
 *   const palpitei = createPalpitei();          // usa DATABASE_URL
 *   const fa = await palpitei.users.findOrCreateByPrivyDid(did, { wallet, walletSource });
 *
 * Uma instância por processo: o Pool já cuida de concorrência.
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
