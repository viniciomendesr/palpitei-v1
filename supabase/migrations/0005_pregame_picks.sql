-- =============================================================================
-- Palpitei v1 — palpite pré-jogo
--
-- Antes do apito o fã crava até quatro palpites sobre uma partida futura, cada
-- um valendo XP (resultado 30, placar exato 60, total de gols 25, escanteios
-- 25). Editável até o apito; depois trava. Liquida no fim, creditando `users.xp`
-- pelos mercados acertados.
--
-- POR QUE UMA TABELA PRÓPRIA, e não `predictions`/`questions`:
-- o motor de perguntas (packages/core) só conhece três tipos — final_result,
-- next_goal, hilo_corners — e GERA perguntas a partir de eventos AO VIVO. Placar
-- exato, total de gols O/U 2,5 e escanteios O/U 9,5 não cabem lá, e o palpite
-- pré-jogo nasce da ESCOLHA do fã antes da bola rolar, não de um evento do feed.
-- Forçar isso dentro do engine seria encaixe errado. Aqui é uma linha por fã por
-- partida, com os quatro mercados lado a lado.
--
-- As LINHAS (2,5 gols / 9,5 escanteios) são constantes de produto — o mockup não
-- varia por partida — então NÃO viram coluna: guardá-las por linha seria dado
-- morto. Se um dia forem por-partida, entram como coluna e a regra migra junto.
--
-- Só epoch ms na FK de fixture (bigint, como a 0001). O resto é relógio de
-- parede (timestamptz): estas colunas não entram na linha do tempo do feed.
--
-- Aplicar com: node scripts/migrate.mjs
-- =============================================================================

create table if not exists pregame_picks (
  id            uuid primary key default gen_random_uuid(),

  -- A identidade é o fã (users.id, que sai do privy_did). `on delete cascade`:
  -- conta apagada leva os palpites junto — palpite órfão seria FK mentindo.
  user_id       uuid   not null references users (id) on delete cascade,

  -- A partida. Sem `on delete` explícito (restrict): não se apaga uma fixture
  -- que ainda tem palpite pendurado.
  fixture_id    bigint not null references matches (fixture_id),

  -- Os quatro mercados. NULL = não preenchido (o fã não é obrigado aos quatro);
  -- os checks recusam qualquer valor que a tela não produz.
  result   text     constraint pregame_result_ck  check (result  in ('home', 'draw', 'away')),
  score_a  smallint constraint pregame_score_a_ck check (score_a between 0 and 15),
  score_b  smallint constraint pregame_score_b_ck check (score_b between 0 and 15),

  -- O stepper começa em 0×0. `score_set=false` diz "o fã não mexeu" — um 0×0 de
  -- fábrica NÃO é um palpite de placar e não pode pontuar por acaso.
  score_set boolean not null default false,

  goals    text constraint pregame_goals_ck   check (goals   in ('over', 'under')),
  corners  text constraint pregame_corners_ck check (corners in ('over', 'under')),

  -- Quando o fã confirmou pela 1ª vez. Palpite sem submitted_at é rascunho e
  -- NÃO liquida (não paga XP por algo que ninguém confirmou).
  submitted_at timestamptz,

  -- O CAS da liquidação: settled_at NULL = ainda não pago. O UPDATE de pagamento
  -- só morde `where settled_at is null`, então reprocessar não paga duas vezes —
  -- a mesma disciplina do predictionRepo.
  settled_at   timestamptz,
  result_correct  boolean,
  score_correct   boolean,
  goals_correct   boolean,
  corners_correct boolean,
  awarded_xp      integer,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Um palpite por fã por partida — garantido pelo banco, não por um
  -- SELECT-antes-de-INSERT que perde a corrida em silêncio. É o alvo do upsert.
  constraint pregame_user_fixture_uk unique (user_id, fixture_id)
);

-- A liquidação varre por partida (todos os palpites de uma fixture quando ela
-- acaba): o índice serve esse acesso.
create index if not exists pregame_picks_fixture_idx on pregame_picks (fixture_id);


-- -----------------------------------------------------------------------------
-- Fechar a porta que o Supabase abre sozinho (mesma razão da 0001/0002)
--
-- Tabela nova NÃO herda o `enable row level security`: sem este bloco,
-- `pregame_picks` nasceria legível por qualquer um com a anon key. É RLS LIGADA
-- SEM POLICY — zera o PostgREST público sem afetar o backend, que fala como a
-- role dona (postgres) e ignora RLS.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['pregame_picks']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
  end if;
end
$$;
