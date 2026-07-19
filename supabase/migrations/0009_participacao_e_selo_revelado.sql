-- =============================================================================
-- Palpitei v1 — a PARTICIPAÇÃO do fã numa fixture, e o Selo REVELADO
--
-- DUAS COISAS, e por isso duas mudanças independentes.
--
-- 1. `predictions.run_id` — qual EXECUÇÃO produziu o palpite
--
--    "Meus palpites" precisa mostrar a PRIMEIRA participação do fã numa partida,
--    e só ela. Ao vivo isso já era expressável: `questions.session_id` agrupa a
--    execução (sala ao vivo cria `game_sessions`; replay não). No replay não era:
--    cada rodada recria as perguntas com ids novos e NADA as agrupa, então dois
--    replays do mesmo fã eram indistinguíveis no schema.
--
--    A coluna resolve isso onde o dado nasce, sem inventar sessão para o replay.
--    Dar `game_sessions` ao replay quebraria `roomMode()`: com sessão, um replay
--    de partida `finished` volta como 'finished' (sala morta, sem runner) em vez
--    de 'replay' — que é exatamente o caminho pelo qual a 18241006 é jogada hoje.
--    Está escrito na doc do próprio `room-mode.ts`.
--
--    ATENÇÃO À CRONOLOGIA, medido em 18/07 na fixture 18257865:
--    `predictions.placed_at` é tempo de PARTIDA (o replay simula) e
--    `predictions.created_at` é relógio de parede. "Primeiro" é `created_at`.
--    Usar `placed_at` faz palpite de replay parecer ao vivo.
--
-- 2. `selo_mints.revealed_at` — quando o fã RECLAMOU o Selo dele
--
--    O asset já foi cunhado por backfill offline (`packages/selo`). A tela não
--    cunha nada e não pode dizer que cunha. `revealed_at` é estado de APLICAÇÃO:
--    a hora em que o fã abriu o que já era dele. Nada aqui toca a cadeia.
--
-- Aplicar com: node scripts/migrate.mjs
-- =============================================================================


-- -----------------------------------------------------------------------------
-- predictions.run_id
-- -----------------------------------------------------------------------------
alter table predictions add column if not exists run_id text;

create index if not exists predictions_user_run_idx on predictions (user_id, run_id);

comment on column predictions.run_id is
  'Execucao que produziu o palpite: id da game_session ao vivo, uuid da sala no replay. Agrupa a participacao. NULL = linha anterior a 0009.';

-- Linhas ao vivo anteriores a esta migration já tinham como se agrupar: a sessão
-- da pergunta. Adotamos ela, para que a participação ao vivo antiga fique exata.
update predictions p
   set run_id = q.session_id::text
  from questions q
 where q.id = p.question_id
   and q.session_id is not null
   and p.run_id is null;

-- As linhas de replay antigas não têm como ser separadas por execução: o dado
-- para isso nunca existiu. Elas viram UMA participação por (fã, fixture), que é
-- a leitura honesta — e, na única fixture medida (18257865, 18 palpites de um
-- replay só), é também a leitura exata. Nada aqui adivinha uma segunda rodada.
update predictions p
   set run_id = 'legacy:' || q.fixture_id::text
  from questions q
 where q.id = p.question_id
   and p.run_id is null;


-- -----------------------------------------------------------------------------
-- selo_mints.revealed_at
--
-- NULL = cunhado e ainda não revelado (é o estado que a Coleção mostra como
-- selo fechado). Preenchido = o fã já reclamou. Nunca volta a NULL: revelar é
-- de mão única, como abrir um envelope.
-- -----------------------------------------------------------------------------
alter table selo_mints add column if not exists revealed_at timestamptz;

comment on column selo_mints.revealed_at is
  'Quando o fa revelou o Selo na Colecao. Estado de APLICACAO: nada e transmitido na revelacao, o asset ja existe.';
