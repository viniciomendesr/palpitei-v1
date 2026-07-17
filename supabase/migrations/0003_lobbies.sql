-- Lobby social persistente. Presença e broadcast continuam efêmeros no SSE,
-- mas identidade, convite, anfitrião e associação sobrevivem a reload/deploy.

create table if not exists lobbies (
  id           uuid primary key default gen_random_uuid(),
  invite_code  text not null unique
                 constraint lobbies_invite_code_ck check (invite_code ~ '^[A-HJKMNP-Z2-9]{6}$'),
  fixture_id   bigint not null references matches (fixture_id) on delete cascade,
  treino       boolean not null default false,
  host_user_id uuid not null references users (id) on delete cascade,
  phase        text not null default 'waiting'
                 check (phase in ('waiting', 'started', 'finished', 'cancelled', 'expired')),
  max_players  integer not null default 8 check (max_players between 2 and 32),
  expires_at   timestamptz not null default (now() + interval '24 hours'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists lobbies_fixture_idx on lobbies (fixture_id, created_at desc);
create index if not exists lobbies_host_idx on lobbies (host_user_id, created_at desc);
create index if not exists lobbies_expiry_idx on lobbies (expires_at) where phase = 'waiting';

create table if not exists lobby_members (
  lobby_id     uuid not null references lobbies (id) on delete cascade,
  user_id      uuid not null references users (id) on delete cascade,
  role         text not null default 'player' check (role in ('host', 'player')),
  ready        boolean not null default false,
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (lobby_id, user_id)
);

create index if not exists lobby_members_user_idx on lobby_members (user_id, joined_at desc);
create unique index if not exists lobby_members_one_host_uk
  on lobby_members (lobby_id) where role = 'host';

do $$
declare
  t text;
begin
  foreach t in array array['lobbies', 'lobby_members']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
