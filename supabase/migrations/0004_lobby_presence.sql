-- Saída explícita é diferente de uma conexão SSE que caiu. O vínculo fica
-- auditável, mas deixa de autorizar a URL antiga até o fã aceitar o convite de
-- novo. O encerramento da partida já cabe no enum textual criado na 0003.

alter table lobby_members
  add column if not exists left_at timestamptz;

create index if not exists lobby_members_active_user_idx
  on lobby_members (user_id, joined_at desc)
  where left_at is null;
