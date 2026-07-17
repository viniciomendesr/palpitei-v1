# Sincronização de salas e lobby

## Stack atual

- Next.js 15 + React 19 + TypeScript 5.7.
- Railway com uma réplica Node persistente.
- SSE para servidor → clientes e POST autenticado para comandos.
- Estado autoritativo do jogo no servidor (`rooms.ts`); Postgres para identidade,
  perguntas, palpites e XP.

O lobby usa o mesmo transporte. Cada link recebe um `partyId`; a chave
`fixture + treino + partyId` isola o runner de cada grupo. Presença, pronto e
início ficam no processo e o host só inicia quando todos os presentes estão
prontos.

## Bibliotecas avaliadas

### Liveblocks

Melhor encaixe futuro para presença gerenciada no stack React/Next. Oferece
rooms, Presence, Broadcast e Storage, hooks React tipados e endpoint próprio de
autorização. Evita que presença dependa de uma única réplica Railway.

- https://liveblocks.io/docs/get-started/nextjs
- https://liveblocks.io/docs/concepts

### Ably

Boa opção quando o produto precisar de pub/sub, presença e histórico de canal
como infraestrutura geral. É mais baixo nível que Liveblocks para a UI React e
exige desenhar o estado compartilhado do lobby por cima dos canais.

- https://ably.com/docs/presence-occupancy/presence
- https://ably.com/docs/channels

### PartyKit

Modelo excelente para uma sala autoritativa na borda e lógica multiplayer
customizada. Porém moveria o runtime da sala para outra plataforma e criaria
uma fronteira operacional adicional ao Railway/Postgres atual.

- https://docs.partykit.io/

### Socket.IO e Yjs

Socket.IO é adequado para WebSocket bidirecional self-hosted, mas exige um
servidor customizado e um adapter externo ao escalar réplicas. Yjs resolve
edição concorrente/CRDT; o estado de uma partida é sequencial e autoritativo,
portanto CRDT adicionaria complexidade sem resolver o relógio do runner.

- https://socket.io/
- https://docs.yjs.dev/api/about-awareness

## Decisão

Manter SSE nesta entrega: é suficiente para lobby, placar, perguntas e presença
com a réplica única configurada em `railway.json`, sem novas credenciais nem uma
segunda fonte de verdade. Migrar presença/lobby para Liveblocks antes de subir
`numReplicas` acima de 1 ou quando a sala precisar sobreviver a restart/deploy.
O motor, XP e relógio TxLINE continuam autoritativos no backend Palpitei mesmo
após essa migração.
