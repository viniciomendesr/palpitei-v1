-- =============================================================================
-- Palpitei v1 — Troféus e o registro de cunhagem do Selo TxLINE
--
-- DUAS COISAS DIFERENTES, e por isso duas tabelas:
--
--   · `trophy_ledger` é a moeda rara do Palpitei. Ganha-se UM troféu, UMA vez por
--     conta, pelo PRIMEIRO palpite do fã numa partida AO VIVO. Não é por partida,
--     não é corrida: é estreia.
--   · `selo_mints` é o recibo de que um asset Metaplex Core já foi cunhado para
--     um palpite certo. Existe para que rodar o script duas vezes não cunhe duas
--     vezes — mint é irreversível e público, então a idempotência mora no BANCO.
--
-- NENHUMA das duas escreve XP. Troféu não é XP e não vira XP: `users.xp` continua
-- sendo pago só por `predictionRepo.settle` e pela liquidação do pré-jogo.
--
-- Aplicar com: node scripts/migrate.mjs
-- =============================================================================


-- -----------------------------------------------------------------------------
-- trophy_ledger — livro-razão, não contador
--
-- Um `users.trophies integer` não sabe POR QUE subiu. Aqui a concessão é um FATO
-- com identidade, data e motivo; o saldo é DERIVADO:
--
--   select coalesce(sum(delta), 0) from trophy_ledger where user_id = $1;
-- -----------------------------------------------------------------------------
create table if not exists trophy_ledger (
  id          uuid primary key default gen_random_uuid(),

  user_id     uuid not null references users (id) on delete cascade,

  -- Positivo concede, negativo gasta. Zero é linha sem significado.
  delta       integer not null check (delta <> 0),

  reason      text not null check (reason in ('live_debut', 'perk_redeem')),

  -- Na concessão, a fixture da estreia (texto para caber também em id de perk no
  -- dia em que houver gasto). É rastro de auditoria, nunca chave estrangeira.
  ref         text,

  created_at  timestamptz not null default now()
);

create index if not exists trophy_ledger_user_idx on trophy_ledger (user_id);

-- -----------------------------------------------------------------------------
-- A ESTREIA É UMA SÓ, PARA SEMPRE — invariante de banco, não convenção.
--
-- Por que índice único parcial e NÃO um compare-and-swap no estilo
-- `predictions.settle`: o CAS é ler-depois-escrever, e existe janela entre a
-- leitura e a escrita — real sob duas réplicas, sob retry e sob restart no meio.
-- Contra este índice, `insert ... on conflict do nothing` é UMA instrução
-- atômica: não há janela porque não há leitura.
-- -----------------------------------------------------------------------------
create unique index if not exists trophy_ledger_debut_uk
  on trophy_ledger (user_id) where reason = 'live_debut';


-- -----------------------------------------------------------------------------
-- selo_mints — a idempotência do que não dá para desfazer
--
-- O ciclo é de três passos, e a ordem importa:
--   1. `insert ... on conflict do nothing` reserva a linha em 'pending';
--   2. o script transmite a transação;
--   3. `update ... set status = 'minted'` grava o endereço e a assinatura.
--
-- Um crash entre 2 e 3 deixa a linha em 'pending'. Isso é DE PROPÓSITO: 'pending'
-- BLOQUEIA nova tentativa, porque a falha perigosa aqui é cunhar duas vezes, não
-- deixar de cunhar. O humano confere no explorer e resolve a linha na mão.
-- 'failed' é o estado que o script escreve quando SABE que nada foi transmitido.
-- -----------------------------------------------------------------------------
create table if not exists selo_mints (
  id                uuid primary key default gen_random_uuid(),

  user_id           uuid not null references users (id) on delete cascade,

  -- A pergunta acertada que o Selo comemora. Um Selo por palpite certo.
  question_id       text not null references questions (id) on delete cascade,

  -- Cluster explícito: um asset de devnet e um de mainnet são coisas diferentes,
  -- e uma linha sem cluster mentiria sobre onde procurar.
  cluster           text not null check (cluster in ('devnet', 'mainnet-beta')),

  status            text not null default 'pending'
                      check (status in ('pending', 'minted', 'failed')),

  -- A carteira do fã, resolvida no SERVIDOR a partir de `users.wallet_pubkey`.
  -- Jamais de entrada de cliente (regra 2 do CLAUDE.md).
  owner_pubkey      text not null,

  -- Preenchidos no passo 3. NULL enquanto 'pending'.
  asset_pubkey      text,
  collection_pubkey text,
  signature         text,
  metadata_uri      text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Estado sem o seu dado é bug: cunhado tem endereço e assinatura.
  constraint selo_mints_minted_ck check (
    status <> 'minted' or (asset_pubkey is not null and signature is not null)
  )
);

-- Um Selo por fã por pergunta — garantido pelo banco, que é o único lugar onde
-- garantia sobrevive a restart e a segundo processo.
--
-- PARCIAL, excluindo 'failed', e isso é a política escrita como invariante: uma
-- tentativa que o script SABE não ter sido transmitida não é um Selo e não pode
-- bloquear a próxima. 'pending' e 'minted' bloqueiam; 'failed' libera. A linha
-- fica no banco de qualquer jeito, como rastro da tentativa.
create unique index if not exists selo_mints_open_uk
  on selo_mints (user_id, question_id) where status <> 'failed';

create index if not exists selo_mints_status_idx on selo_mints (status);


-- -----------------------------------------------------------------------------
-- Fechar a porta que o Supabase abre sozinho (mesma razão da 0001/0002/0005)
--
-- Tabela nova NÃO herda o `enable row level security`: sem este bloco elas
-- nasceriam legíveis por qualquer um com a anon key. É RLS LIGADA SEM POLICY —
-- zera o PostgREST público sem afetar o backend, que fala como a role dona.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['trophy_ledger', 'selo_mints']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end
$$;
