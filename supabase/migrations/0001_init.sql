-- =============================================================================
-- Palpitei v1 — schema inicial
--
-- Supabase é usado SÓ como Postgres (decisão #2 do docs/CONTEXT.md):
--   · a identidade é o `privy_did` verificado — nada de Supabase Auth;
--   · nada de RLS baseada em auth.uid();
--   · nada de client Supabase no browser: só o backend fala com o banco,
--     via connection string.
--
-- DUAS NOÇÕES DE TEMPO CONVIVEM AQUI — não misture:
--   · `*_ts`, `*_at` em BIGINT  = linha do tempo da PARTIDA (epoch ms do ts do
--     feed da TxLINE). É o tempo que os motores enxergam. Nunca Date.now().
--   · `*_at` em TIMESTAMPTZ     = relógio de parede, só para auditoria de
--     registro (quando a linha entrou no banco). Nenhum motor lê isto.
--
-- Aplicar com: node scripts/migrate.mjs
-- =============================================================================

-- Sem `create extension pgcrypto`: gen_random_uuid() é NATIVO do Postgres desde
-- a 13, e o Supabase roda 15+. Pedir a extensão só acrescentaria um jeito de a
-- migration falhar num banco que não a tenha disponível.


-- -----------------------------------------------------------------------------
-- users — a identidade é o DID da Privy, NUNCA a carteira
--
-- A carteira muda (a Opção B ganha uma embutida por cima depois) e o MESMO
-- endereço aparece 2x (embutida + Phantom após o export). Por isso o find-or-
-- create é por `privy_did`, e as carteiras vivem em `user_wallets` (1:N).
-- -----------------------------------------------------------------------------
create table if not exists users (
  id              uuid primary key default gen_random_uuid(),

  -- Identidade estável. NOT NULL de propósito: usuário sem identidade
  -- verificada não existe. O modo demo (regra §5.1 — o jurado testa sem criar
  -- carteira) recebe um DID sintético emitido pelo servidor, no namespace
  -- 'demo:', jamais um 'did:privy:' falso. O CHECK abaixo torna isso invariante
  -- de banco, não convenção.
  privy_did       text not null unique,

  -- Apelido público (ranking/ligas). Nasce NULL: o onboarding PEDE.
  -- NUNCA derive do e-mail (E12) — vazaria o endereço da pessoa no ranking.
  handle          text,

  -- NULLABLE de propósito, e isto NÃO é frouxidão: o `createOnLogin` da Privy
  -- defaulta a 'off' (achado E2), e nesse caso o fã entra pelo login social e
  -- fica SEM carteira Solana — o requisito da trilha cai calado. Guardar NULL
  -- diz a verdade e deixa a regressão visível:
  --   select count(*) from users where privy_did like 'did:privy:%'
  --                                and wallet_pubkey is null;   -- tem que dar 0
  -- Fosse NOT NULL, teríamos que inventar uma fonte e o bug voltaria a ser mudo.
  wallet_pubkey   text,
  wallet_source   text check (wallet_source in ('privy_embedded', 'external', 'simulated')),

  favorite_team   text,    -- onboarding passo 2 ("time do coração")
  is_premium      boolean  not null default false,

  xp              integer  not null default 0 check (xp >= 0),

  -- Nível é FUNÇÃO do xp, não um campo que alguém atualiza: coluna gerada com a
  -- fórmula do v0 (floor(sqrt(xp/100)) + 1). Assim é impossível xp e nível
  -- divergirem — o clássico "subiu XP e esqueceu o nível", que falha calado.
  level           integer  not null
                    generated always as ((floor(sqrt(xp::double precision / 100)) + 1)::int) stored,

  current_streak  integer  not null default 0 check (current_streak >= 0),
  best_streak     integer  not null default 0 check (best_streak >= 0),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- O namespace do DID e a fonte da carteira têm que contar a MESMA história:
  -- conta demo não pode se passar por conta real com carteira de verdade, e
  -- conta real não pode ser marcada como simulada para escapar de regra.
  constraint users_did_namespace_ck check (
    (privy_did like 'demo:%'
       and (wallet_source is null or wallet_source = 'simulated'))
    or (privy_did like 'did:privy:%'
       and (wallet_source is null or wallet_source in ('privy_embedded', 'external')))
  ),
  -- Fonte existe se, e somente se, existe carteira. Sem isto dá para gravar
  -- "source = privy_embedded, pubkey = NULL" — uma carteira que não existe.
  constraint users_wallet_par_ck check ((wallet_pubkey is null) = (wallet_source is null)),
  constraint users_handle_formato_ck check (
    handle is null or (char_length(handle) between 3 and 20)
  )
);

-- Unicidade do apelido é CASE-INSENSITIVE: "Você.Craque" e "você.craque" são o
-- mesmo apelido para um humano lendo o ranking. Um UNIQUE simples deixaria os
-- dois entrarem e o fã veria dois "craques" na tela.
create unique index if not exists users_handle_lower_uk on users (lower(handle));

comment on column users.privy_did is
  'Identidade estável e única. did:privy:* para conta real; demo:* para o modo demo (§5.1).';
comment on column users.level is
  'Coluna GERADA: floor(sqrt(xp/100)) + 1. Não atualize — atualize xp.';


-- -----------------------------------------------------------------------------
-- user_wallets (1:N) — a Privy permite várias carteiras por conta
--
-- O MESMO endereço pode aparecer 2x na mesma conta: a carteira embutida que o
-- fã exportou e reimportou no Phantom volta como 'external' com o MESMO pubkey
-- (achado E16). Por isso a chave natural é (user_id, pubkey, source) — um
-- UNIQUE (user_id, pubkey) colapsaria os dois casos e apagaria a proveniência.
-- -----------------------------------------------------------------------------
create table if not exists user_wallets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  pubkey      text not null,
  source      text not null
                check (source in ('privy_embedded', 'external', 'simulated')),
  is_primary  boolean not null default false,
  linked_at   timestamptz not null default now(),

  constraint user_wallets_uk unique (user_id, pubkey, source)
);

create index if not exists user_wallets_user_idx on user_wallets (user_id);


-- -----------------------------------------------------------------------------
-- matches
-- -----------------------------------------------------------------------------
create table if not exists matches (
  fixture_id      bigint primary key,
  competition     text,
  competition_id  bigint,
  p1              text not null,
  p2              text not null,
  p1_id           bigint,
  p2_id           bigint,

  -- ESSENCIAL, não enfeite (achado G4): a janela do desafio "como termina?" é
  -- ancorada no início da partida. Sem start_ts ela ancora no 1º evento do feed
  -- — que sai até 44 min ANTES do apito — e expira antes de a bola rolar: o
  -- desafio nasce fechado e ninguém palpita. Nada quebra, nada loga.
  -- Fica nullable porque o feed às vezes não entrega; o repositório NUNCA
  -- sobrescreve um start_ts conhecido com NULL (ver matchRepo.upsert).
  start_ts        bigint,

  state           text not null default 'scheduled'
                    check (state in ('scheduled', 'live', 'finished', 'cancelled')),
  game_state_raw  integer,  -- GameState cru do feed (1 = agendada, 6 = cancelada)

  -- Proveniência da timeline gravada (substitui o .cache/ em disco do v0).
  cache_source    text check (cache_source in
                    ('txline-updates', 'txline-cache', 'txline-historical',
                     'txline-snapshot', 'txline-live', 'synthetic')),
  cached_at       timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists matches_start_ts_idx on matches (start_ts);
create index if not exists matches_state_idx on matches (state);

comment on column matches.start_ts is
  'Epoch ms do apito inicial. Âncora da janela do desafio final (G4). NULL = risco de janela nascer fechada.';


-- -----------------------------------------------------------------------------
-- match_events — a linha do tempo (/scores/updates)
--
-- UNIQUE (fixture_id, seq) dá idempotência de graça: o stream reconecta com
-- Last-Event-ID e REENVIA eventos. Como o seq é contínuo, um buraco na série
-- significa evento PERDIDO — dá para detectar (ver eventRepo.findSeqGaps).
-- -----------------------------------------------------------------------------
create table if not exists match_events (
  fixture_id     bigint  not null references matches (fixture_id) on delete cascade,
  seq            integer not null,
  ts             bigint  not null,   -- epoch ms do feed = linha do tempo da partida
  action         text    not null,   -- goal, corner, kickoff, game_finalised, ...
  status_id      integer,
  period         integer,            -- 100 junto com status_id=100 => fim de jogo
  clock_running  boolean,
  clock_seconds  integer,

  -- A4 — "ausente ≠ zero": nem todo evento carrega o bloco Score (kickoff,
  -- lineups, comment…). has_score=false significa SEM PLACAR, não 0–0. Ler
  -- zero aqui faz o placar regredir e nascerem gols fantasma.
  has_score      boolean not null,
  -- {"p1": {"Goals": 1, "Corners": 3, ...}, "p2": {...}} — o bloco Total inteiro,
  -- só campos numéricos. O conjunto de chaves varia por partida.
  -- G7 — dentro do bloco, a chave ausente VALE zero (ausente = zero). São regras
  -- opostas no mesmo payload: o bloco inteiro ausente ≠ zero; a chave ausente = zero.
  score_totals   jsonb,

  raw            jsonb   not null,   -- payload cru da TxLINE (T&C §7: nunca versionar)
  ingested_at    timestamptz not null default now(),

  primary key (fixture_id, seq),

  -- Invariante do A4 no banco: evento sem bloco Score não pode carregar totais.
  constraint match_events_has_score_ck check (has_score or score_totals is null)
);

create index if not exists match_events_fixture_ts_idx on match_events (fixture_id, ts);
create index if not exists match_events_action_idx on match_events (fixture_id, action);

comment on column match_events.has_score is
  'false => evento SEM bloco Score. score_totals é NULL. Ausente nao e zero (A4).';


-- -----------------------------------------------------------------------------
-- match_odds — a série de cotações (/odds/updates)
--
-- Numa partida real vêm 34.971 eventos; só 3.758 são 1X2 de jogo inteiro —
-- o único mercado que a v1 consome. O filtro é da INGESTÃO (ver oddsRepo).
-- -----------------------------------------------------------------------------
create table if not exists match_odds (
  -- message_id é STRING ("1837922149:00003:000572-10021-stab"), NÃO número.
  -- Um parser numérico devolve -1 para todos e colapsa a série inteira num
  -- único registro — sem erro nenhum. Por isso TEXT, e por isso é a PK.
  message_id     text primary key,

  fixture_id     bigint not null references matches (fixture_id) on delete cascade,
  ts             bigint not null,
  market_type    text   not null,   -- SuperOddsType, ex.: 1X2_PARTICIPANT_RESULT
  market_period  text,              -- NULL = jogo inteiro (é o que a v1 usa)
  line           double precision,  -- MarketParameters.line, quando houver
  in_running     boolean,
  bookmaker      text,

  -- Arrays PARALELOS, guardados como vieram. G8 — "vazio ≠ zeros": Prices: []
  -- com PriceNames cheio é dado REAL (26 de 3.758 nesta fixture: mercado sem
  -- cotação no momento). Mapear names.map() sobre Prices vazio inventa preços
  -- zerados, e o explicador anuncia "a chance caiu para 0%": foram 115
  -- explicações fantasma no v0. Antes de casar os três, CONFIRA OS TAMANHOS.
  -- De propósito NÃO há CHECK de tamanho igual: rejeitaria dado real.
  price_names    jsonb  not null,
  prices         jsonb  not null,
  pct            jsonb,

  raw            jsonb  not null,
  ingested_at    timestamptz not null default now()
);

create index if not exists match_odds_fixture_ts_idx on match_odds (fixture_id, ts);
create index if not exists match_odds_market_idx on match_odds (fixture_id, market_type, ts);

comment on column match_odds.message_id is
  'STRING do feed. Parser numerico colapsa a serie inteira num registro (bug real do v0).';
comment on column match_odds.prices is
  'Array cru. Vazio com price_names cheio e dado real: vazio nao e zeros (G8).';


-- -----------------------------------------------------------------------------
-- questions — geradas pelo motor a partir do dado real
--
-- opens_at/closes_at são ts de PARTIDA (feed), não relógio de parede.
-- Regra de justiça: a janela fecha ANTES do evento que resolve. Se o evento
-- resolvedor chega com a janela aberta, a pergunta é ANULADA (state='void',
-- sem XP) — não resolvida.
-- -----------------------------------------------------------------------------
create table if not exists questions (
  id              text primary key,   -- id do motor (uid: "q_...")
  fixture_id      bigint not null references matches (fixture_id) on delete cascade,
  type            text not null
                    check (type in ('final_result', 'next_goal', 'hilo_corners')),
  prompt          text not null,
  options         jsonb not null,     -- [{"id": "p1", "label": "França"}, ...]
  opens_at        bigint not null,
  closes_at       bigint not null,
  state           text not null default 'open'
                    check (state in ('open', 'closed', 'resolved', 'void')),
  correct         text,               -- option id vencedora
  void_reason     text,
  resolved_at     bigint,
  resolved_by_seq integer,
  created_at      timestamptz not null default now(),

  -- Anulada tem motivo; resolvida tem gabarito. Estado sem o seu dado é bug.
  constraint questions_void_ck check (state <> 'void' or void_reason is not null),
  constraint questions_resolved_ck check (state <> 'resolved' or correct is not null)
);

create index if not exists questions_fixture_idx on questions (fixture_id, opens_at);
create index if not exists questions_state_idx on questions (state);


-- -----------------------------------------------------------------------------
-- predictions — o palpite do fã
--
-- awarded_xp é FUNÇÃO de (prediction_id, resolução), nunca incremento cego:
--   · NULL          => ainda não resolvido;
--   · 0             => errou ou foi anulada;
--   · > 0           => acertou (XP base do tipo, 1.5x se palpitou rápido).
-- O replay reemite eventos; se o pagamento fosse "user.xp += x" a cada
-- resolução, a mesma pergunta pagaria duas vezes. O repositório só paga na
-- TRANSIÇÃO de result NULL -> não-NULL (ver predictionRepo.settle).
-- -----------------------------------------------------------------------------
create table if not exists predictions (
  id           text primary key,   -- id do motor (uid: "pred_...")
  user_id      uuid not null references users (id) on delete cascade,
  question_id  text not null references questions (id) on delete cascade,
  choice       text not null,      -- option id
  placed_at    bigint not null,    -- ts de PARTIDA
  result       text check (result in ('won', 'lost', 'void')),
  awarded_xp   integer check (awarded_xp >= 0),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,

  -- Um palpite por fã por pergunta ("você já palpitou nesta pergunta"), agora
  -- garantido pelo banco e não só pela memória do motor.
  constraint predictions_user_question_uk unique (user_id, question_id),

  -- result e awarded_xp andam juntos: existe resolução <=> existe XP decidido.
  constraint predictions_xp_ck check (
    (result is null and awarded_xp is null)
    or (result is not null and awarded_xp is not null)
  ),
  -- Só acerto paga. Errado e anulado valem 0 — por definição, não por disciplina.
  constraint predictions_perdedor_zero_ck check (
    result is null or result = 'won' or awarded_xp = 0
  )
);

create index if not exists predictions_user_idx on predictions (user_id);
create index if not exists predictions_question_idx on predictions (question_id);

comment on column predictions.awarded_xp is
  'Funcao de (prediction_id, resolucao). NULL = nao resolvido. Nunca incremente as cegas: replay pagaria 2x.';


-- -----------------------------------------------------------------------------
-- markets / bets — prévia da v2 (Presságio) com USDC SIMULADO
--
-- NÃO há dinheiro real na v1. Isto existe porque os motores portados do v0
-- incluem o mercado paramutuel, e o EnginePorts.saveBet precisa de onde gravar.
-- Toda a matemática é em CENTAVOS INTEIROS — determinística e auditável.
-- -----------------------------------------------------------------------------
create table if not exists markets (
  id           text primary key,   -- id do motor (uid: "mkt_...")
  fixture_id   bigint not null references matches (fixture_id) on delete cascade,
  kind         text not null default 'resultado_final',
  labels       jsonb not null,     -- {"p1": "França", "draw": "Empate", "p2": "Inglaterra"}
  rake_bps     integer not null default 500 check (rake_bps between 0 and 10000),
  closes_at    bigint,             -- ts de PARTIDA; definido no kickoff
  state        text not null default 'open'
                 check (state in ('open', 'closed', 'resolved')),
  pools        jsonb not null default '{"p1": 0, "draw": 0, "p2": 0}'::jsonb,
  winner       text check (winner in ('p1', 'draw', 'p2')),
  refunded     boolean not null default false,
  proof        jsonb,              -- recibo: prova de Merkle real da TxLINE
  proof_error  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists markets_fixture_idx on markets (fixture_id);

create table if not exists bets (
  id            text primary key,  -- id do motor (uid: "bet_...")
  market_id     text not null references markets (id) on delete cascade,
  user_id       uuid not null references users (id) on delete cascade,
  outcome       text not null check (outcome in ('p1', 'draw', 'p2')),
  amount_cents  bigint not null check (amount_cents > 0),
  ts            bigint not null,   -- ts de PARTIDA
  payout_cents  bigint check (payout_cents >= 0),
  created_at    timestamptz not null default now()
);

create index if not exists bets_market_idx on bets (market_id);
create index if not exists bets_user_idx on bets (user_id);

-- Saldo simulado do fã (100 USDC de brinquedo = 10000 centavos).
alter table users add column if not exists balance_cents bigint not null default 10000
  check (balance_cents >= 0);


-- -----------------------------------------------------------------------------
-- achievements / user_achievements — conquistas
--
-- A PK composta é o que torna "desbloquear" idempotente: desbloquear duas vezes
-- é no-op, não XP em dobro.
-- -----------------------------------------------------------------------------
create table if not exists achievements (
  code         text primary key,
  title        text not null,
  description  text not null,
  xp_reward    integer not null default 0 check (xp_reward >= 0),
  sort_order   integer not null default 0,
  active       boolean not null default true
);

create table if not exists user_achievements (
  user_id           uuid not null references users (id) on delete cascade,
  achievement_code  text not null references achievements (code) on delete cascade,
  unlocked_at       timestamptz not null default now(),

  primary key (user_id, achievement_code)
);

create index if not exists user_achievements_user_idx on user_achievements (user_id);


-- -----------------------------------------------------------------------------
-- missions / user_missions — missões
--
-- period_date faz a missão diária resetar sem apagar histórico: a PK
-- (user_id, mission_code, period_date) é uma linha por fã por dia. Missão de
-- temporada usa uma data fixa de época (ver missionRepo).
-- -----------------------------------------------------------------------------
create table if not exists missions (
  code         text primary key,
  title        text not null,
  description  text not null,
  kind         text not null default 'daily' check (kind in ('daily', 'season')),
  target       integer not null default 1 check (target > 0),
  xp_reward    integer not null default 0 check (xp_reward >= 0),
  sort_order   integer not null default 0,
  active       boolean not null default true
);

create table if not exists user_missions (
  user_id       uuid not null references users (id) on delete cascade,
  mission_code  text not null references missions (code) on delete cascade,
  period_date   date not null,
  progress      integer not null default 0 check (progress >= 0),
  completed_at  timestamptz,
  updated_at    timestamptz not null default now(),

  primary key (user_id, mission_code, period_date)
);

create index if not exists user_missions_user_idx on user_missions (user_id, period_date);


-- -----------------------------------------------------------------------------
-- Conteúdo de referência (idempotente)
-- Textos em pt-BR, voz de torcida — os três primeiros vêm do mockup.
-- -----------------------------------------------------------------------------
insert into missions (code, title, description, kind, target, xp_reward, sort_order) values
  ('streak_3',  'Embalou',        'Acerte 3 palpites seguidos',      'daily', 3, 150, 1),
  ('rooms_5',   'Pé quente',      'Entre em 5 salas ao vivo',        'daily', 5, 100, 2),
  ('invite_1',  'Chama a galera', 'Convide um amigo pra liga',       'daily', 1, 200, 3)
on conflict (code) do nothing;

insert into achievements (code, title, description, xp_reward, sort_order) values
  ('primeiro_palpite', 'Entrou em campo', 'Deu o seu primeiro palpite',            50, 1),
  ('primeiro_acerto',  'Na mosca',        'Acertou o primeiro palpite',           100, 2),
  ('sequencia_5',      'Tá voando',       'Acertou 5 palpites seguidos',          300, 3),
  ('jogo_completo',    'Do apito ao fim', 'Acompanhou uma partida inteira ao vivo', 150, 4)
on conflict (code) do nothing;


-- -----------------------------------------------------------------------------
-- Fechar a porta que o Supabase abre sozinho
--
-- Isto NÃO é RLS de auth.uid() (decisão #2 diz que não usamos Supabase Auth).
-- É o contrário: o Supabase publica um PostgREST sobre o schema `public` e o
-- expõe às roles `anon`/`authenticated`. Como o nosso acesso é só pelo backend
-- via connection string (role dona, que ignora RLS), ligar RLS SEM NENHUMA
-- POLICY deixa essa API pública sem enxergar nada — sem afetar o backend.
--
-- Sem isto, as tabelas ficariam legíveis por qualquer um com a anon key —
-- exatamente o tipo de buraco silencioso atrás de link público que o v0 mandou
-- não repetir.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'user_wallets', 'matches', 'match_events', 'match_odds',
    'questions', 'predictions', 'markets', 'bets',
    'achievements', 'user_achievements', 'missions', 'user_missions'
  ]
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
