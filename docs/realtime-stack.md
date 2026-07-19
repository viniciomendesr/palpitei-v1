# Room synchronization, lobby, and scale

## Current state

Palpitei uses Next.js, SSE for server → client, and authenticated POST for
commands. The server is authoritative for the clock, questions, score,
settlement, and XP. Postgres persists identity, lobbies, members, the TxLINE
timeline, picks, sessions, and templates.

The key to the social experience is `fixture + treino + partyId`: groups playing
the same match share no presence, questions, answers, or ranking. The invite
authorizes entry into the group; the persisted membership is verified before the
SSE stream opens or a command is accepted.

## Realtime per fixture and per session

TxLINE ingest is organized by active fixture. Each fixture channel receives
normalized scores and odds, persists them idempotently, and only then publishes
them to subscribed rooms. Several groups can subscribe to the same channel
without opening one TxLINE connection per group.

Each group creates or resumes a persistent `game_session`. The session holds the
cursor, snapshot, engine version, and pinned template set. On restart, the room
rehydrates the session and recovers the timeline after the cursor; the first SSE
packet is still a complete `room_state`, personalized for the user.

With `REDIS_URL`, a 15-second Redis lease elects the single replica that opens
the TxLINE SSE connection. After the Postgres commit, that replica publishes one
normalized event per fixture; the other replicas receive it on
`palpitei:txline:fixture:<id>` and forward it only to their local rooms. The
`raw` payload and provider details never reach the broker. Because Pub/Sub is
ephemeral, every reconnection reconciles against the Postgres projection, and
room cursors discard repeated events.

Presence and the ready signal are transient. The source of truth for lobby,
members, host, and phase is Postgres; the list of connections lives in the
process.

## Operational limit of this delivery

The broker makes it possible to distribute **the live game** across replicas, but
production still runs **a single persistent Node replica** until presence and
ready are shared. The requirement remains explicit at deploy time:

- SSE connections stay local (the broker forwards events, not connections);
- lobby presence and ready state are held in memory;
- presence does not broadcast across replicas;
- a group could see divergent presence if its members landed on different
  processes.

The lock eliminates duplicate ingestion, and Pub/Sub delivers the same game to
rooms in different processes. Persisted sessions and timeline allow state
recovery after a restart, but they do not amount to full lobby high
availability.

## Path to multiple replicas

Before changing `numReplicas`, the following still has to be built:

1. presence and ready in a shared store with heartbeat and broadcast;
2. a recovery worker to resume active `game_sessions` and reconcile
   cursors/gaps after a restart;
3. metrics and alerts per fixture/session: feed lag, duplicate events, gaps,
   checkpoint failures, subscribers, and reconnections.

The engine and settlement stay in the Palpitei backend even if the transport is
migrated. The browser is never the authority on state.

## Alternatives evaluated

### Liveblocks

A good option for presence, broadcast, and storage with React hooks. It could
replace process-local presence, but it does not replace event persistence, the
authoritative engine, or backend settlement.

- https://liveblocks.io/docs/get-started/nextjs
- https://liveblocks.io/docs/concepts

### Ably

A managed pub/sub and presence option for distributing SSE/WebSocket across
replicas. It requires keeping a clear boundary between transport messages and
authoritative backend commands.

- https://ably.com/docs/presence-occupancy/presence
- https://ably.com/docs/channels

### PartyKit

Useful for an authoritative room at the edge, but it adds a platform and an
operational boundary. Not necessary while Railway runs a single replica.

- https://docs.partykit.io/

### Socket.IO and Yjs

Socket.IO is appropriate for self-hosted bidirectional communication, but it
requires a shared adapter when scaling. Yjs solves concurrent editing/CRDT; a
match is an authoritative sequence of events, so it does not solve the clock,
ingestion, or settlement.

- https://socket.io/
- https://docs.yjs.dev/api/about-awareness

## Operations

Keep SSE for this delivery and set `REDIS_URL=${{Redis.REDIS_URL}}` on the web
service. Before a match, confirm the active fixture, a recoverable session, the
`leader` broker state on exactly one replica, and the TxLINE streams. During the
match, watch persistence-before-publication, the lease, and reconnections. After
the final whistle, confirm that the session, the questions, and the pre-match
picks were all settled.

The full architecture of data, templates, and recovery is in
[live-architecture.md](live-architecture.md).
