import type { Db, Row } from '../pool.js';
import type { QuestionType } from '../types.js';

export type QuestionTemplate = {
  id: string;
  version: number;
  questionType: QuestionType;
  active: boolean;
  eligibility: Record<string, unknown>;
  triggerSpec: Record<string, unknown>;
  resolutionSpec: Record<string, unknown>;
  presentation: Record<string, unknown>;
  scoringPolicy: Record<string, unknown>;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mapTemplate(row: Row): QuestionTemplate {
  return {
    id: String(row.id),
    version: Number(row.version),
    questionType: row.question_type as QuestionType,
    active: Boolean(row.active),
    eligibility: object(row.eligibility),
    triggerSpec: object(row.trigger_spec),
    resolutionSpec: object(row.resolution_spec),
    presentation: object(row.presentation),
    scoringPolicy: object(row.scoring_policy),
  };
}

export function createQuestionTemplateRepo(db: Db) {
  const repo = {
    async listActive(): Promise<QuestionTemplate[]> {
      const rows = await db.query(
        `select id, version, question_type, active, eligibility, trigger_spec, resolution_spec, presentation, scoring_policy
           from question_templates where active order by question_type`,
      );
      return rows.map(mapTemplate);
    },
  };
  return repo;
}

export type QuestionTemplateRepo = ReturnType<typeof createQuestionTemplateRepo>;
