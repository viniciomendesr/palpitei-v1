# @palpitei/db

Postgres (Supabase) schema + repository layer.

**Supabase is used only as Postgres.** No Supabase Auth, no `auth.uid()` RLS,
no Supabase client in the browser. Identity is the verified `privy_did`; only the
backend talks to the database, over a connection string.

```bash
cp .env.example .env      # fill in DATABASE_URL (.env.example explains where to find it)
npm run db:migrate        # applies supabase/migrations in order; idempotent
npm run db:status         # what has already been applied
npm test -w @palpitei/db  # 30 tests against real Postgres (PGlite/WASM, nothing to install)
```

## Usage

```ts
import { createPalpitei } from '@palpitei/db';

const p = createPalpitei();                       // uses DATABASE_URL
const fa = await p.users.findOrCreateByPrivyDid(did, { wallet, walletSource });
await p.users.setHandle(fa.id, 'craque.10');      // 409 if it already belongs to someone else
```

`p` gives you: `users`, `matches`, `events`, `odds`, `questions`, `predictions`,
`liveFixtures`, `questionTemplates`, `gameSessions`, `markets`, `gamification`,
`cache` (match timeline), `ports` (EnginePorts) and `db`
(raw `query`/`withTx`).

## If you are wiring this into core or web, read these 6 points

1. **`ports.flush()` after accepting a palpite.** Core calls the ports in
   fire-and-forget. `engine.place()` returns `{ok:true}` before the INSERT
   finishes; without the flush, a write failure leaves the fan hearing "palpite
   registered" for a palpite that does not exist.

   ```ts
   const r = room.placePrediction(userId, questionId, choice);
   if (!r.ok) return res.status(400).json(r);
   await ports.flush();   // blows up here if the database refused
   return res.json(r);
   ```

2. **Save the question on `question_open`.** `predictions` references `questions`
   by FK: a palpite on an unsaved question blows up the moment the fan palpita.
   Use `ports.saveQuestion(q)` (or `questions.save(q)`) in the emit handler.

3. **`saveUser` is NOT implemented, on purpose.** It would send an XP total
   computed in memory — a blind, absolute write that loses XP when the same
   fan is in two rooms. Palpite XP goes through `savePrediction(p)` with
   `result` filled in (idempotent CAS); the balance goes through `saveBet` +
   `markets.resolve`. Read the header of `src/enginePorts.ts` before touching it.

4. **`db.User.handle` is `string | null`; `core.User.handle` is `string`.** This is not
   an oversight: the fan is born without a handle because onboarding is what asks
   for it (E12 — deriving it from the e-mail would leak their address in the ranking).
   The compiler forces you to decide; the right call is to block whoever has not chosen:

   ```ts
   if (!fa.handle) return res.status(409).json({ error: 'escolhe seu apelido primeiro' });
   ```

   Same for `wallet` and `walletSource`: both are `null` when Privy did not create
   a wallet (E2 — `createOnLogin` defaults to `'off'`), and that is how the
   regression stays visible instead of turning into a made-up wallet.
   **`walletSource === null` is not `'simulated'`**: `simulated` is the demo mode
   (§5.1), and marking a real `did:privy:*` as demo is precisely saying it did NOT
   fulfil "sign up through Solana" — the database refuses that combination
   (`users_did_namespace_ck`). Whoever needs a wallet tests for `null`:

   ```ts
   if (!fa.wallet) return res.status(409).json({ error: 'sua conta ainda não tem carteira' });
   ```

   The regression detector (must return 0):

   ```sql
   select count(*) from users where privy_did like 'did:privy:%' and wallet_pubkey is null;
   ```

5. **Match state: `upsert` does not decide, `setState` decides.** `matches.upsert`
   with `state` absent PRESERVES the state that was already there (don't know ≠
   scheduled). To move the match on purpose, use `matches.setState(fixtureId, estado)`.

6. **Market: whoever resolves is whoever pays.** `markets.save()` never writes
   `state='resolved'` (it downgrades to `'closed'`). Resolution is `markets.resolve(market, bets)`,
   which flips the state and credits in the SAME transaction, under the CAS. If you
   write the market as "resolved" from the outside and only then call `resolve()`,
   without this lock nobody would be paid and nothing would blow up.

7. **Session and template do not replace the instance.** `question_templates`
   defines a versioned catalogue; content changes must create a new version.
   `questions` holds the prompt, options, windows and
   result actually delivered to the fan. When opening a session, pin the versions
   in the `template_set` and save `session_id`, `template_id`, `template_version`
   and `trigger_key` on the instance. The unique index per session/template/trigger
   makes reprocessing idempotent.

8. **A checkpoint is not a timeline.** `game_sessions.checkpoint()` stores a
   snapshot and cursors to resume a room after a restart. Events and odds in
   `match_events`/`match_odds` remain as auditable evidence and as the source for
   reconciliation. Do not discard the timeline after the checkpoint.

## What the schema guarantees on its own

These do not depend on anyone remembering anything — the database refuses:

| Invariant | How |
|---|---|
| XP is not paid twice on a replay | `settle` only bites `where result is null` (CAS) |
| Level never diverges from XP | `level` is a GENERATED column: `floor(sqrt(xp/100)) + 1` |
| A stream resend does not duplicate an event | `primary key (fixture_id, seq)` |
| An odds series does not collapse into one record | `message_id` is **TEXT** (it is a string in the feed) |
| An event without a `Score` block does not become 0–0 | `check (has_score or score_totals is null)` (A4) |
| A demo account cannot pass as a real one | `users_did_namespace_ck` (`demo:` vs `did:privy:`) |
| Two fans cannot take the same handle | unique index on `lower(handle)` |
| A wallet without a source (or a source without a wallet) does not get in | `users_wallet_par_ck` |
| The Supabase anon key reads nothing | RLS enabled **with no policy** on every table |
| The wrong role cannot serve an empty database | `assertDbReady` checks `row_security_active('users')` |
| An active session is not duplicated | partial index on `(fixture_id, party_id, treino)` |
| A redelivered question does not duplicate per trigger | partial index on `(session_id, template_id, trigger_key)` |

Gaps in the sequence (a lost event) are a query, not a discovery:
`events.findSeqGaps(fixtureId)`. Matches without `start_ts` (G4, the one that makes
the challenge be born closed): `matches.semStartTs()`. Privy fans without a Solana
wallet (E2): `select count(*) from users where privy_did like 'did:privy:%'
and wallet_pubkey is null` — it has to return 0.

**`assertDbReady(db)` at boot, always.** RLS enabled with no policy shuts
PostgREST out, but it is also a trap: any role that is not the schema owner starts
reading **zero rows of everything, with no error and no log**. The check cannot be
"did a row come back?" — `select count(*)` returns one row saying `n=0` even
when RLS zeroed everything out. That is why it asks `row_security_active('users')`.

## Match cache

`p.cache` replaces v0's `.cache/fixtures/*.json` — **T&C §7**: TxLINE data
cannot be redistributed, and this repository is public. The timeline lives in
`match_events`/`match_odds` (not in a separate blob: that would be a second truth).

```ts
await p.cache.save(matchCache);   // idempotent; refuses a cache without startTime (G4)
const c = await p.cache.load(18241006);   // null if there is no saved timeline
```

It also answers to `salvarCache` / `lerCache` / `listarCache`, the v0 names.
