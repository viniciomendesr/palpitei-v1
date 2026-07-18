-- Execução recuperável do jogo ao vivo e catálogo versionado de perguntas.
--
-- `questions` continua sendo a instância auditável que o fã recebeu; templates
-- são definições imutáveis e versionadas. A regra executável continua no core:
-- o banco escolhe somente parâmetros validados, nunca SQL/JS arbitrário.

create table if not exists live_fixtures (
  fixture_id   bigint primary key references matches (fixture_id) on delete cascade,
  active       boolean not null default true,
  priority     integer not null default 0,
  activated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  updated_at   timestamptz not null default now(),
  constraint live_fixtures_deactivated_ck check ((active and deactivated_at is null) or not active)
);

create index if not exists live_fixtures_active_idx
  on live_fixtures (priority desc, activated_at) where active;

create table if not exists question_templates (
  id                 text not null,
  version            integer not null default 1 check (version > 0),
  question_type      text not null check (question_type in ('final_result', 'next_goal', 'hilo_corners')),
  active             boolean not null default true,
  eligibility        jsonb not null default '{}'::jsonb,
  trigger_spec       jsonb not null default '{}'::jsonb,
  resolution_spec    jsonb not null default '{}'::jsonb,
  presentation       jsonb not null default '{}'::jsonb,
  scoring_policy     jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  retired_at         timestamptz,
  primary key (id, version),
  constraint question_templates_retired_ck check ((active and retired_at is null) or not active)
);

create unique index if not exists question_templates_one_active_type_uk
  on question_templates (question_type) where active;

insert into question_templates
  (id, version, question_type, eligibility, trigger_spec, resolution_spec, presentation, scoring_policy)
values
  ('final-result', 1, 'final_result',
   '{"mode":"live"}', '{"on":"match_started","max_pending":1}',
   '{"on":"game_finalised"}', '{"message_key":"question.final_result","options":"participants_draw"}',
   '{"base_xp":150,"speed_bonus":1.5}'),
  ('next-goal', 1, 'next_goal',
   '{"mode":"live"}', '{"on":"after_final_window_or_goal","max_pending":1}',
   '{"on":"goal_or_game_finalised"}', '{"message_key":"question.next_goal","options":"participants_none"}',
   '{"base_xp":100,"speed_bonus":1.5}'),
  ('hilo-corners', 1, 'hilo_corners',
   '{"mode":"live"}', '{"on":"corner","max_pending":1}',
   '{"on":"next_corner_or_horizon"}', '{"message_key":"question.hilo_corners","options":"yes_no"}',
   '{"base_xp":50,"speed_bonus":1.5}')
on conflict (id, version) do nothing;

create table if not exists game_sessions (
  id                    uuid primary key default gen_random_uuid(),
  fixture_id            bigint not null references matches (fixture_id) on delete cascade,
  party_id              text not null,
  treino                boolean not null default false,
  status                text not null default 'active' check (status in ('active', 'finished', 'cancelled')),
  engine_version        text not null default 'v1',
  template_set          jsonb not null default '{}'::jsonb,
  snapshot              jsonb not null default '{}'::jsonb,
  last_score_seq        integer,
  last_odds_ts          bigint,
  last_odds_message_id  text,
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  updated_at            timestamptz not null default now(),
  constraint game_sessions_finished_ck check ((status = 'finished' and finished_at is not null) or status <> 'finished')
);

create unique index if not exists game_sessions_one_active_run_uk
  on game_sessions (fixture_id, party_id, treino) where status = 'active';
create index if not exists game_sessions_fixture_idx on game_sessions (fixture_id, updated_at desc);

alter table questions add column if not exists session_id uuid references game_sessions (id) on delete set null;
alter table questions add column if not exists template_id text;
alter table questions add column if not exists template_version integer;
alter table questions add column if not exists trigger_key text;

create index if not exists questions_session_idx on questions (session_id, opens_at);
create unique index if not exists questions_session_template_trigger_uk
  on questions (session_id, template_id, trigger_key)
  where session_id is not null and template_id is not null and trigger_key is not null;

do $$
declare
  t text;
begin
  foreach t in array array['live_fixtures', 'question_templates', 'game_sessions']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
