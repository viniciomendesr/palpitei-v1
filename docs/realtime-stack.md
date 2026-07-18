# Sincronização de salas, lobby e escala

## Estado atual

Palpitei usa Next.js, SSE para servidor → cliente e POST autenticado para
comandos. O servidor é autoritativo para o relógio, perguntas, placar,
liquidação e XP. Postgres persiste identidade, lobbies, membros, timeline
TxLINE, palpites, sessões e templates.

A chave da experiência social é `fixture + treino + partyId`: grupos que jogam
a mesma partida não compartilham presença, perguntas, respostas ou ranking. O
convite autoriza a entrada no grupo; a associação persistida é verificada antes
de abrir o stream SSE ou aceitar um comando.

## Realtime por fixture e por sessão

O ingest TxLINE é organizado por fixture ativa. Cada canal de fixture recebe
scores e odds normalizados, persiste-os de forma idempotente e só então os
publica para as salas inscritas. Vários grupos podem assinar o mesmo canal sem
abrir uma conexão TxLINE por grupo.

Cada grupo cria ou retoma uma `game_session` persistente. A sessão contém
cursor, snapshot, versão do motor e conjunto de templates fixado. Em caso de
restart, a sala reidrata a sessão e recupera a timeline posterior ao cursor;
o primeiro pacote SSE continua sendo um `room_state` completo e personalizado
para o usuário.

Com `REDIS_URL`, uma lease Redis de 15 segundos elege a única réplica que abre
o SSE TxLINE. Após o commit no Postgres, ela publica um evento normalizado por
fixture; as demais réplicas o recebem em `palpitei:txline:fixture:<id>` e o
encaminham somente para suas salas locais. O payload `raw` e detalhes do
provedor não entram no broker. Como Pub/Sub é efêmero, cada reconexão reconcilia
a projeção do Postgres, e cursores de sala descartam eventos repetidos.

Presença e o sinal de pronto são transitórios. A fonte de verdade de lobby,
membros, host e fase está no Postgres; a lista de conexões vive no processo.

## Limite operacional da entrega

O broker permite distribuir **o jogo ao vivo** entre réplicas, mas a produção
continua com **uma réplica Node persistente** até que presença e pronto sejam
compartilhados. O requisito ainda é explícito no deploy:

- conexões SSE continuam locais (o broker encaminha eventos, não conexões);
- presença e pronto do lobby ficam em memória;
- presença não faz broadcast entre réplicas;
- um grupo poderia ver presença divergente se seus membros caíssem em processos
  diferentes.

O lock elimina ingestão duplicada e o Pub/Sub entrega o mesmo jogo às salas em
processos diferentes. Sessões e timeline persistidas permitem recuperar estado
após restart, mas não equivalem a alta disponibilidade completa do lobby.

## Caminho para múltiplas réplicas

Antes de alterar `numReplicas`, falta implementar:

1. presença e pronto em store compartilhado com heartbeat e broadcast;
2. worker de recuperação para retomar `game_sessions` ativas e reconciliar
   cursors/gaps após reinício;
3. métricas e alertas por fixture/sessão: atraso do feed, eventos duplicados,
   gaps, falhas de checkpoint, assinantes e reconexões.

O motor e a liquidação permanecem no backend Palpitei mesmo se o transporte for
migrado. O navegador nunca é autoridade de estado.

## Alternativas avaliadas

### Liveblocks

Boa opção para presença, broadcast e storage com hooks React. Pode substituir
a presença process-local, mas não substitui a persistência de eventos, o motor
autoritativo ou a liquidação no backend.

- https://liveblocks.io/docs/get-started/nextjs
- https://liveblocks.io/docs/concepts

### Ably

Opção de pub/sub e presença gerenciada para distribuir SSE/WebSocket entre
réplicas. Exige manter a fronteira clara entre mensagens de transporte e
comandos autoritativos do backend.

- https://ably.com/docs/presence-occupancy/presence
- https://ably.com/docs/channels

### PartyKit

Útil para uma sala autoritativa na borda, mas adiciona uma plataforma e uma
fronteira operacional. Não é necessário enquanto Railway opera com uma réplica.

- https://docs.partykit.io/

### Socket.IO e Yjs

Socket.IO é apropriado para comunicação bidirecional self-hosted, porém requer
adapter compartilhado ao escalar. Yjs resolve edição concorrente/CRDT; uma
partida é sequência autoritativa de eventos, logo não resolve clock, ingestão
ou liquidação.

- https://socket.io/
- https://docs.yjs.dev/api/about-awareness

## Operação

Mantenha SSE nesta entrega e configure `REDIS_URL=${{Redis.REDIS_URL}}` no
serviço web. Antes de um jogo, confirme fixture ativa, sessão recuperável,
estado `leader` do broker em uma réplica e streams TxLINE. Durante o jogo,
acompanhe persistência antes de publicação, lease e reconexões. Após o término,
confirme finalização da sessão, das perguntas e de pré-palpites.

A arquitetura completa de dados, templates e recuperação está em
[live-architecture.md](live-architecture.md).
