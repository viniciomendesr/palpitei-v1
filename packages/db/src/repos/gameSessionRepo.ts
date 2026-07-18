import type { Db, Row } from '../pool.js';

export type GameSession = {
  id: string;
  fixtureId: number;
  partyId: string;
  treino: boolean;
  status: 'active' | 'finished' | 'cancelled';
  engineVersion: string;
  templateSet: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  lastScoreSeq: number | null;
  lastOddsTs: number | null;
  lastOddsMessageId: string | null;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mapSession(row: Row): GameSession {
  return {
    id: String(row.id),
    fixtureId: Number(row.fixture_id),
    partyId: String(row.party_id),
    treino: Boolean(row.treino),
    status: row.status as GameSession['status'],
    engineVersion: String(row.engine_version),
    templateSet: object(row.template_set),
    snapshot: object(row.snapshot),
    lastScoreSeq: row.last_score_seq == null ? null : Number(row.last_score_seq),
    lastOddsTs: row.last_odds_ts == null ? null : Number(row.last_odds_ts),
    lastOddsMessageId: row.last_odds_message_id == null ? null : String(row.last_odds_message_id),
  };
}

export function createGameSessionRepo(db: Db) {
  const repo = {
    async findOrCreateActive(input: {
      fixtureId: number;
      partyId: string;
      treino: boolean;
      engineVersion: string;
      templateSet: Record<string, unknown>;
    }): Promise<GameSession> {
      await db.query(
        `insert into game_sessions (fixture_id, party_id, treino, engine_version, template_set)
         values ($1, $2, $3, $4, $5::jsonb)
         on conflict do nothing`,
        [input.fixtureId, input.partyId, input.treino, input.engineVersion, JSON.stringify(input.templateSet)],
      );
      const rows = await db.query(
        `select id, fixture_id, party_id, treino, status, engine_version, template_set, snapshot,
                last_score_seq, last_odds_ts, last_odds_message_id
           from game_sessions
          where fixture_id = $1 and party_id = $2 and treino = $3 and status = 'active'
          order by started_at desc limit 1`,
        [input.fixtureId, input.partyId, input.treino],
      );
      if (!rows[0]) throw new Error('[db] não consegui abrir uma sessão ativa de jogo');
      return mapSession(rows[0]);
    },

    async checkpoint(
      sessionId: string,
      snapshot: Record<string, unknown>,
      cursor: { lastScoreSeq: number | null; lastOddsTs: number | null; lastOddsMessageId: string | null },
    ): Promise<void> {
      await db.query(
        `update game_sessions
            set snapshot = $2::jsonb, last_score_seq = $3, last_odds_ts = $4, last_odds_message_id = $5, updated_at = now()
          where id = $1 and status = 'active'`,
        [sessionId, JSON.stringify(snapshot), cursor.lastScoreSeq, cursor.lastOddsTs, cursor.lastOddsMessageId],
      );
    },

    async finish(sessionId: string): Promise<void> {
      await db.query(
        `update game_sessions
            set status = 'finished', finished_at = now(), updated_at = now()
          where id = $1 and status = 'active'`,
        [sessionId],
      );
    },
  };
  return repo;
}

export type GameSessionRepo = ReturnType<typeof createGameSessionRepo>;
