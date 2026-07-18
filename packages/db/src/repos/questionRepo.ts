// Questions generated from real match data. Persist questions before predictions
// that reference them to satisfy the foreign key.

import type { Db, Row } from '../pool.js';
import type { Question, QuestionOption, QuestionType } from '../types.js';

function mapQuestion(r: Row): Question {
  const q: Question = {
    id: String(r.id),
    fixtureId: Number(r.fixture_id),
    type: r.type as QuestionType,
    prompt: String(r.prompt),
    options: (r.options as QuestionOption[]) ?? [],
    opensAt: Number(r.opens_at),
    closesAt: Number(r.closes_at),
    state: r.state as Question['state'],
  };
  if (r.session_id != null) q.sessionId = String(r.session_id);
  if (r.template_id != null && r.template_version != null) {
    q.template = { id: String(r.template_id), version: Number(r.template_version) };
  }
  if (r.trigger_key != null) q.triggerKey = String(r.trigger_key);
  if (r.correct != null) q.correct = String(r.correct);
  if (r.void_reason != null) q.voidReason = String(r.void_reason);
  if (r.resolved_at != null) q.resolvedAt = Number(r.resolved_at);
  if (r.resolved_by_seq != null) q.resolvedBySeq = Number(r.resolved_by_seq);
  return q;
}

const COLS = `id, fixture_id, session_id, template_id, template_version, trigger_key,
              type, prompt, options, opens_at, closes_at, state, correct, void_reason,
              resolved_at, resolved_by_seq`;

export function createQuestionRepo(db: Db) {
  const repo = {
    /**
     * Idempotently saves a question. State transitions are forward-only so a
     * replayed event cannot reopen a resolved or void question.
     */
    async save(q: Question): Promise<void> {
      await db.query(
        `
        insert into questions (id, fixture_id, session_id, template_id, template_version, trigger_key,
                               type, prompt, options, opens_at, closes_at, state, correct,
                               void_reason, resolved_at, resolved_by_seq)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16)
        on conflict (id) do update set
          state           = case
                              when questions.state in ('resolved', 'void') then questions.state
                              else excluded.state
                            end,
          correct         = coalesce(questions.correct, excluded.correct),
          void_reason     = coalesce(questions.void_reason, excluded.void_reason),
          resolved_at     = coalesce(questions.resolved_at, excluded.resolved_at),
          resolved_by_seq = coalesce(questions.resolved_by_seq, excluded.resolved_by_seq),
          closes_at       = excluded.closes_at,
          session_id      = coalesce(questions.session_id, excluded.session_id),
          template_id     = coalesce(questions.template_id, excluded.template_id),
          template_version = coalesce(questions.template_version, excluded.template_version),
          trigger_key     = coalesce(questions.trigger_key, excluded.trigger_key)
        `,
        [
          q.id,
          q.fixtureId,
          q.sessionId ?? null,
          q.template?.id ?? null,
          q.template?.version ?? null,
          q.triggerKey ?? null,
          q.type,
          q.prompt,
          JSON.stringify(q.options ?? []),
          q.opensAt,
          q.closesAt,
          q.state,
          q.correct ?? null,
          q.voidReason ?? null,
          q.resolvedAt ?? null,
          q.resolvedBySeq ?? null,
        ]
      );
    },

    async findById(id: string): Promise<Question | null> {
      const rows = await db.query(`select ${COLS} from questions where id = $1`, [id]);
      return rows[0] ? mapQuestion(rows[0]) : null;
    },

    async listByFixture(fixtureId: number): Promise<Question[]> {
      const rows = await db.query(
        `select ${COLS} from questions where fixture_id = $1 order by opens_at`,
        [fixtureId]
      );
      return rows.map(mapQuestion);
    },

    async listOpen(fixtureId: number): Promise<Question[]> {
      const rows = await db.query(
        `select ${COLS} from questions where fixture_id = $1 and state = 'open' order by opens_at`,
        [fixtureId]
      );
      return rows.map(mapQuestion);
    },

    /**
     * Counts question states per fixture for fairness-window observability.
     */
    async contagemPorEstado(fixtureId: number): Promise<Record<string, number>> {
      const rows = await db.query(
        `select state, count(*)::int as n from questions where fixture_id = $1 group by state`,
        [fixtureId]
      );
      const out: Record<string, number> = {};
      for (const r of rows) out[String(r.state)] = Number(r.n);
      return out;
    },
  };

  return repo;
}

export type QuestionRepo = ReturnType<typeof createQuestionRepo>;
