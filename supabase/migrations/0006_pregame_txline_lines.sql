-- =============================================================================
-- Palpitei v1 — linhas TxLINE no palpite pré-jogo
--
-- A linha de Acima/Abaixo não é mais uma constante do mockup: cada pick guarda
-- a linha inteira de meio gol que a TxLINE ofereceu quando o fã confirmou.
-- Sem isto, uma mudança de 2,5 para 3,5 faria a liquidação comparar contra um
-- mercado diferente do que ele viu. NULL continua válido: mercado não marcado
-- não tem linha; e picks antigos recebem a linha que a tela antiga mostrava.
-- =============================================================================

alter table pregame_picks
  add column if not exists goals_line double precision,
  add column if not exists corners_line double precision;

-- Preserva a regra prometida aos palpites gravados antes desta migration. Este
-- é o ÚNICO lugar em que 2,5/9,5 existem após a adoção de cotações por partida.
update pregame_picks
   set goals_line = 2.5
 where goals is not null and goals_line is null;

update pregame_picks
   set corners_line = 9.5
 where corners is not null and corners_line is null;

-- Só aceitamos linhas binárias (x,5). Linhas inteiras e asiáticas (x,25/x,75)
-- têm push/meio ganho e não podem ser tratadas como "Acima/Abaixo" simples.
alter table pregame_picks
  drop constraint if exists pregame_goals_line_ck,
  add constraint pregame_goals_line_ck check (
    goals_line is null or (
      goals_line >= 0 and goals_line <= 20 and goals_line * 2 = floor(goals_line * 2) and goals_line <> floor(goals_line)
    )
  ),
  drop constraint if exists pregame_corners_line_ck,
  add constraint pregame_corners_line_ck check (
    corners_line is null or (
      corners_line >= 0 and corners_line <= 20 and corners_line * 2 = floor(corners_line * 2) and corners_line <> floor(corners_line)
    )
  );
