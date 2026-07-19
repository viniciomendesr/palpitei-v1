/**
 * Trophies: Palpitei's scarce currency, and the mint receipts of the Selo TxLINE.
 *
 * A trophy is NOT XP and never becomes XP. Nothing in this file writes
 * `users.xp` — that stays the exclusive job of `predictionRepo.settle` and of
 * pregame settlement.
 */

import type { Db, Executor } from '../pool.js';
import type {
  TrophyEntry,
  SeloCandidate,
  SeloMint,
  SeloMintClaim,
  SeloMintCluster,
  DebutBackfillCandidate,
} from '../types.js';

export function createTrophyRepo(db: Db) {
  const repo = {
    /**
     * Awards the one debut trophy a fan can ever get.
     *
     * Idempotent by the partial unique index `trophy_ledger_debut_uk`, not by a
     * read-then-write compare-and-swap: `on conflict do nothing` is a single
     * atomic statement, so two replicas, ten retries and a restart mid-flight
     * still produce exactly one row.
     *
     * @param ref Free-form audit trail; the debut fixture id in practice.
     * @returns True only when THIS call created the entry.
     */
    async awardDebut(userId: string, ref: string, tx?: Executor): Promise<boolean> {
      const exec = async (q: Executor): Promise<boolean> => {
        const rows = await q.query(
          `insert into trophy_ledger (user_id, delta, reason, ref)
           values ($1, 1, 'live_debut', $2)
           on conflict do nothing
           returning id`,
          [userId, ref],
        );
        return rows.length > 0;
      };
      return tx ? exec(tx) : exec(db);
    },

    /** Derived balance. There is no counter column to drift out of sync. */
    async balance(userId: string): Promise<number> {
      const rows = await db.query(
        `select coalesce(sum(delta), 0)::int as saldo from trophy_ledger where user_id = $1`,
        [userId],
      );
      return Number(rows[0]?.saldo ?? 0);
    },

    /** Whether the fan already has their debut trophy. */
    async hasDebut(userId: string): Promise<boolean> {
      const rows = await db.query(
        `select 1 from trophy_ledger where user_id = $1 and reason = 'live_debut' limit 1`,
        [userId],
      );
      return rows.length > 0;
    },

    async listByUser(userId: string): Promise<TrophyEntry[]> {
      const rows = await db.query(
        `select id, user_id, delta, reason, ref,
                extract(epoch from created_at) * 1000 as created_ms
           from trophy_ledger where user_id = $1 order by created_at`,
        [userId],
      );
      return rows.map((r) => {
        const entry: TrophyEntry = {
          id: String(r.id),
          userId: String(r.user_id),
          delta: Number(r.delta),
          reason: r.reason as TrophyEntry['reason'],
          createdAt: Math.round(Number(r.created_ms)),
        };
        if (r.ref != null) entry.ref = String(r.ref);
        return entry;
      });
    },

    /**
     * Reserves the right to mint one Selo for one correct prediction.
     *
     * Call this BEFORE broadcasting. A crash between the claim and
     * `confirmMint` leaves the row `pending`, which blocks a retry on purpose:
     * the dangerous failure is minting twice, not failing to mint.
     *
     * @returns The claim when this call won the race, null when a row already
     *          existed (already minted, already pending, or previously failed).
     */
    async claimMint(input: {
      userId: string;
      questionId: string;
      cluster: SeloMintCluster;
      ownerPubkey: string;
    }): Promise<SeloMintClaim | null> {
      const rows = await db.query(
        `insert into selo_mints (user_id, question_id, cluster, owner_pubkey)
         values ($1, $2, $3, $4)
         on conflict do nothing
         returning id`,
        [input.userId, input.questionId, input.cluster, input.ownerPubkey],
      );
      const id = rows[0]?.id;
      return id ? { id: String(id), userId: input.userId, questionId: input.questionId } : null;
    },

    /** Records the on-chain result of a claim that was actually broadcast. */
    async confirmMint(
      claimId: string,
      chain: {
        assetPubkey: string;
        collectionPubkey: string;
        signature: string;
        metadataUri: string;
      },
    ): Promise<void> {
      await db.query(
        `update selo_mints
            set status = 'minted', asset_pubkey = $2, collection_pubkey = $3,
                signature = $4, metadata_uri = $5, updated_at = now()
          where id = $1 and status = 'pending'`,
        [claimId, chain.assetPubkey, chain.collectionPubkey, chain.signature, chain.metadataUri],
      );
    },

    /**
     * Releases a claim, and ONLY when the caller knows nothing was broadcast.
     *
     * Never call this from a generic catch: a timeout is not proof that the
     * transaction failed. Leave those rows `pending` and let a human read the
     * explorer.
     */
    async failMint(claimId: string): Promise<void> {
      await db.query(
        `update selo_mints set status = 'failed', updated_at = now()
          where id = $1 and status = 'pending'`,
        [claimId],
      );
    },

    /**
     * One row per fan: their EARLIEST live palpite on this fixture.
     *
     * The Selo marks a DEBUT, not a correct palpite, so there is deliberately no
     * filter on `result` here: the badge attests that the fan was there.
     *
     * Every filter that remains is load-bearing:
     *   · `q.session_id is not null` — only a live room persists a
     *     `game_sessions` row, so this is the same authority `roomMode === 'live'`
     *     uses. A finished fixture keeps producing palpites forever, because
     *     anyone can open it as a replay, and those replay palpites carry no
     *     session;
     *   · `order by pr.created_at` — WALL CLOCK, never `placed_at`. `placed_at`
     *     is match time from the feed clock, and a replay reproduces it exactly,
     *     so ordering by it lets a replay counterfeit a debut;
     *   · `wallet_pubkey is not null` — no wallet, nowhere to send it;
     *   · `wallet_source <> 'simulated'` and the `demo:` namespace — a demo
     *     account is excluded by construction, twice.
     *
     * Never takes a wallet or a user id from client input: the address comes
     * from `users.wallet_pubkey`, resolved from the verified privy_did.
     */
    async listSeloCandidates(fixtureId: number): Promise<SeloCandidate[]> {
      const rows = await db.query(
        `select distinct on (u.id)
                u.id            as user_id,
                u.handle        as handle,
                u.wallet_pubkey as wallet_pubkey,
                u.wallet_source as wallet_source,
                q.id            as question_id,
                q.prompt        as prompt,
                q.type          as question_type,
                q.options       as options,
                p.choice        as choice,
                extract(epoch from p.created_at) * 1000 as placed_ms,
                m.p1            as p1,
                m.p2            as p2,
                m.start_ts      as start_ts,
                sm.status       as mint_status
           from predictions p
           join users     u on u.id = p.user_id
           join questions q on q.id = p.question_id
           join matches   m on m.fixture_id = q.fixture_id
           -- The status filter matches the partial unique index, so this join
           -- can never duplicate a candidate row when an attempt was retried.
           left join selo_mints sm
             on sm.user_id = p.user_id and sm.question_id = p.question_id
            and sm.status <> 'failed'
          where q.fixture_id = $1
            and q.session_id is not null
            and u.wallet_pubkey is not null
            and u.wallet_source is distinct from 'simulated'
            and u.privy_did not like 'demo:%'
          order by u.id, p.created_at`,
        [fixtureId],
      );
      return rows
        .map((r) => {
          const options = (Array.isArray(r.options) ? r.options : []) as { id?: unknown; label?: unknown }[];
          const chosen = options.find((o) => String(o?.id) === String(r.choice));
          const candidate: SeloCandidate = {
            userId: String(r.user_id),
            walletPubkey: String(r.wallet_pubkey),
            walletSource: String(r.wallet_source),
            questionId: String(r.question_id),
            questionType: String(r.question_type),
            prompt: String(r.prompt),
            choice: String(r.choice),
            choiceLabel: chosen?.label != null ? String(chosen.label) : String(r.choice),
            placedAt: Math.round(Number(r.placed_ms)),
            p1: String(r.p1),
            p2: String(r.p2),
          };
          if (r.handle != null) candidate.handle = String(r.handle);
          if (r.start_ts != null) candidate.startTime = Number(r.start_ts);
          if (r.mint_status != null) candidate.mintStatus = r.mint_status as SeloMint['status'];
          return candidate;
        })
        // `distinct on` forces its own ordering; present them chronologically.
        .sort((a, b) => a.placedAt - b.placedAt);
    },

    /**
     * The fans whose live debut on one fixture is being backfilled by hand.
     *
     * The operator names the fixture. Do NOT try to reconstruct this from the
     * current state: a fixture that was live yesterday reads `state = 'finished'`
     * today, so any rule that asks the database "was this live?" after the fact
     * answers wrong. Whoever placed a palpite in a live session on a match the
     * operator KNOWS was live is the whole rule.
     *
     * This is the same population as `listSeloCandidates`, by construction: the
     * trophy and the Selo now commemorate the same event.
     */
    async listDebutBackfill(fixtureId: number): Promise<DebutBackfillCandidate[]> {
      const rows = await db.query(
        `select distinct on (u.id)
                u.id as user_id, u.handle as handle,
                exists (
                  select 1 from trophy_ledger t
                   where t.user_id = u.id and t.reason = 'live_debut'
                ) as ja_tem
           from predictions p
           join users     u on u.id = p.user_id
           join questions q on q.id = p.question_id
          where q.fixture_id = $1
            and q.session_id is not null
            and u.privy_did not like 'demo:%'
            and u.wallet_source is distinct from 'simulated'
          order by u.id`,
        [fixtureId],
      );
      return rows.map((r) => {
        const c: DebutBackfillCandidate = {
          userId: String(r.user_id),
          alreadyHasDebut: Boolean(r.ja_tem),
        };
        if (r.handle != null) c.handle = String(r.handle);
        return c;
      });
    },

    async listMints(filter: { userId?: string; cluster?: SeloMintCluster } = {}): Promise<SeloMint[]> {
      const rows = await db.query(
        `select id, user_id, question_id, cluster, status, owner_pubkey, asset_pubkey,
                collection_pubkey, signature, metadata_uri, revealed_at,
                extract(epoch from created_at) * 1000 as created_ms,
                extract(epoch from revealed_at) * 1000 as revealed_ms
           from selo_mints
          where ($1::uuid is null or user_id = $1::uuid)
            and ($2::text is null or cluster = $2::text)
          order by created_at`,
        [filter.userId ?? null, filter.cluster ?? null],
      );
      return rows.map((r) => {
        const mint: SeloMint = {
          id: String(r.id),
          userId: String(r.user_id),
          questionId: String(r.question_id),
          cluster: r.cluster as SeloMintCluster,
          status: r.status as SeloMint['status'],
          ownerPubkey: String(r.owner_pubkey),
          createdAt: Math.round(Number(r.created_ms)),
        };
        if (r.asset_pubkey != null) mint.assetPubkey = String(r.asset_pubkey);
        if (r.collection_pubkey != null) mint.collectionPubkey = String(r.collection_pubkey);
        if (r.signature != null) mint.signature = String(r.signature);
        if (r.metadata_uri != null) mint.metadataUri = String(r.metadata_uri);
        if (r.revealed_at != null) mint.revealedAt = Math.round(Number(r.revealed_ms));
        return mint;
      });
    },

    /**
     * The fan's one confirmed Selo, or null.
     *
     * One per fan by design: the Selo commemorates their live debut, so there is
     * exactly one palpite it can hang on. `status = 'minted'` is the whole
     * filter — a `pending` row means a human still has to read the explorer, and
     * showing it as claimable would promise an asset that may not exist.
     */
    async findMintedSelo(userId: string): Promise<SeloMint | null> {
      const rows = await db.query(
        `select id, user_id, question_id, cluster, status, owner_pubkey, asset_pubkey,
                collection_pubkey, signature, metadata_uri, revealed_at,
                extract(epoch from created_at) * 1000 as created_ms,
                extract(epoch from revealed_at) * 1000 as revealed_ms
           from selo_mints
          where user_id = $1 and status = 'minted'
          order by created_at
          limit 1`,
        [userId],
      );
      const r = rows[0];
      if (!r) return null;
      const mint: SeloMint = {
        id: String(r.id),
        userId: String(r.user_id),
        questionId: String(r.question_id),
        cluster: r.cluster as SeloMintCluster,
        status: r.status as SeloMint['status'],
        ownerPubkey: String(r.owner_pubkey),
        createdAt: Math.round(Number(r.created_ms)),
      };
      if (r.asset_pubkey != null) mint.assetPubkey = String(r.asset_pubkey);
      if (r.collection_pubkey != null) mint.collectionPubkey = String(r.collection_pubkey);
      if (r.signature != null) mint.signature = String(r.signature);
      if (r.metadata_uri != null) mint.metadataUri = String(r.metadata_uri);
      if (r.revealed_at != null) mint.revealedAt = Math.round(Number(r.revealed_ms));
      return mint;
    },

    /**
     * Marks the fan's Selo revealed, once. Nothing is broadcast here: the asset
     * already exists on chain and this only records that the fan opened it.
     *
     * `where revealed_at is null` keeps the first reveal time honest, so a second
     * tap cannot rewrite when the fan actually claimed it.
     */
    async revealSelo(userId: string, mintId: string): Promise<number> {
      const rows = await db.query(
        `update selo_mints
            set revealed_at = now(), updated_at = now()
          where id = $1 and user_id = $2 and status = 'minted' and revealed_at is null
          returning extract(epoch from revealed_at) * 1000 as revealed_ms`,
        [mintId, userId],
      );
      if (rows[0]) return Math.round(Number(rows[0].revealed_ms));
      const atual = await repo.findMintedSelo(userId);
      return atual?.revealedAt ?? 0;
    },
  };

  return repo;
}

export type TrophyRepo = ReturnType<typeof createTrophyRepo>;
