-- =============================================================================
-- Palpitei v1 — ligas privadas
--
-- O que existia antes desta migration: um contador na sessão do BROWSER
-- (`session.leaguesCount`), que sumia no F5. "Minha Liga · 1 membro" era texto
-- fixo. Esta migration é o lugar onde a liga passa a existir.
--
-- Só relógio de parede aqui (timestamptz): liga não é partida. Nenhum motor lê
-- estas tabelas, e nenhuma coluna daqui entra na linha do tempo do feed — por
-- isso não há um único BIGINT de epoch ms neste arquivo, ao contrário da 0001.
--
-- Aplicar com: node scripts/migrate.mjs
-- =============================================================================


-- -----------------------------------------------------------------------------
-- leagues — o grupo privado. O dono é quem criou; o convite é o código.
-- -----------------------------------------------------------------------------
create table if not exists leagues (
  id            uuid primary key default gen_random_uuid(),

  name          text not null,

  -- Quem criou. `on delete cascade`: conta apagada leva a liga junto — deixar
  -- liga órfã com owner_id apontando para o vazio seria uma FK mentindo.
  owner_id      uuid not null references users (id) on delete cascade,

  -- O CONVITE. "Chame a galera" (mockup) precisa de um jeito de entrar, e este
  -- é o mínimo honesto: um código curto que o fã manda no grupo do zap.
  --
  -- O alfabeto NÃO tem I, L, O, 0 nem 1: o código é lido em voz alta e digitado
  -- por gente com pressa, e 'O'/'0' é a confusão clássica. Sem isso, metade dos
  -- "código inválido" seria erro de leitura, não código errado — e a gente
  -- passaria o dia caçando um bug que não existe.
  invite_code   text not null unique
                  constraint leagues_invite_code_ck check (invite_code ~ '^[A-HJKMNP-Z2-9]{6}$'),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- O nome é PÚBLICO para a galera da liga. O limite vive no banco (e não só na
  -- validação da rota) porque a rota é uma das portas, não a única: um script de
  -- seed ou um psql aberto entram por baixo dela.
  constraint leagues_name_ck check (char_length(btrim(name)) between 3 and 24)
);

create index if not exists leagues_owner_idx on leagues (owner_id);


-- -----------------------------------------------------------------------------
-- league_members — quem está na liga (N:N com users)
--
-- O dono TAMBÉM tem linha aqui, com role='owner'. É tentador deixar o dono
-- implícito em `leagues.owner_id` e guardar só os convidados — mas aí "quantos
-- membros tem a liga?" vira `count(*) + 1`, e esse `+ 1` é a mentira que a UI
-- de hoje já conta ("1 membro" fixo). Com o dono na tabela, o count É o número.
-- -----------------------------------------------------------------------------
create table if not exists league_members (
  league_id   uuid not null references leagues (id) on delete cascade,
  user_id     uuid not null references users (id) on delete cascade,

  role        text not null default 'member' check (role in ('owner', 'member')),

  joined_at   timestamptz not null default now(),

  -- Entrar duas vezes com o mesmo código não duplica ninguém: é a PK que
  -- garante, não um SELECT-antes-de-INSERT (que perde a corrida em silêncio e
  -- infla o ranking da liga com o mesmo fã duas vezes).
  primary key (league_id, user_id)
);

create index if not exists league_members_user_idx on league_members (user_id);

-- Uma liga tem EXATAMENTE um dono. Sem isto, um bug de escrita poderia gravar
-- dois 'owner' na mesma liga e a tela mostraria "você lidera" para duas pessoas
-- — sem erro nenhum, que é o pior jeito de descobrir.
create unique index if not exists league_members_one_owner_uk
  on league_members (league_id) where role = 'owner';


-- -----------------------------------------------------------------------------
-- Fechar a porta que o Supabase abre sozinho (mesma razão da 0001)
--
-- Tabela nova NÃO herda o `enable row level security` da 0001: sem este bloco,
-- `leagues` e `league_members` nasceriam legíveis por qualquer um com a anon
-- key — e o convite (que é a credencial de entrada da liga) seria um select.
--
-- Isto NÃO é RLS de auth.uid(): é RLS LIGADA SEM POLICY, que zera o PostgREST
-- público sem afetar o backend, que fala como a role dona (postgres) e ignora
-- RLS.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['leagues', 'league_members']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;

  -- As roles do Supabase não existem num Postgres local: revoga só se houver.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
  end if;
end
$$;
