// One-off backfill that mints the Selo TxLINE for correct in-play predictions.
//
// Usage:
//   npm run selo:mint -w @palpitei/selo -- <fixtureId>              (DRY RUN, the default)
//   npm run selo:mint -w @palpitei/selo -- <fixtureId> --confirm    (actually broadcasts)
//
// This is NOT an automatic mint and does not run on the server. A human runs it,
// from their own machine, with their own key, after reviewing the dry run.
//
// THE KEY NEVER COMES FROM THE ENVIRONMENT. `MINT_AUTHORITY_KEYPAIR` is the PATH
// of a key file outside the repo; a secret in env leaks through `ps`, crash
// dumps, process logs and `railway variables --kv`. Only the pubkey is printed.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSignerFromKeypair, generateSigner, publicKey, signerIdentity } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { create, createCollection, fetchCollection, mplCore } from '@metaplex-foundation/mpl-core';
import { createPalpitei, type SeloCandidate, type SeloMintCluster } from '@palpitei/db';
import { ensureJwt, fetchStatValidation } from '@palpitei/txline';

import { ANCHOR_PROGRAM_IDS, dailyScoresRootsSeeds, epochDayFrom } from '../src/anchor.ts';
import { verifyEventStatRoot } from '../src/anchor-verification.ts';
import {
  SELO_COLLECTION_NAME,
  buildSeloMetadata,
  matchSlug,
  metadataFileName,
  type SeloMetadata,
} from '../src/metadata.ts';

/** France x England: the only live match that has been ingested and recorded. */
const DEFAULT_FIXTURE_ID = 18257865;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_OUT_DIR = join(REPO_ROOT, 'apps', 'web', 'public', 'selo');

const DEFAULT_RPC: Record<SeloMintCluster, string> = {
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

type Options = {
  fixtureId: number;
  confirm: boolean;
  cluster: SeloMintCluster;
  rpc: string;
  baseUrl: string;
  outDir: string;
  keypairPath: string | null;
  pinnedCollection: string | null;
  allowMissingImage: boolean;
  skipRoot: boolean;
  statKey: number;
  /** Backfill the debut trophies for this fixture as well. */
  grantDebut: boolean;
  /** Stop after the trophies. Postgres only: no key, no chain, no risk. */
  trophiesOnly: boolean;
};

function parseOptions(argv: string[]): Options {
  const idArg = argv.find((a) => !a.startsWith('--'));
  const fixtureId = Number(idArg ?? DEFAULT_FIXTURE_ID);
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    throw new Error(`fixtureId inválido: ${idArg}`);
  }

  const cluster = (process.env.SELO_CLUSTER ?? 'devnet') as SeloMintCluster;
  if (cluster !== 'devnet' && cluster !== 'mainnet-beta') {
    throw new Error(`SELO_CLUSTER inválido: ${cluster} (use devnet ou mainnet-beta)`);
  }

  return {
    fixtureId,
    // --dry-run is the DEFAULT. Only an explicit --confirm broadcasts.
    confirm: argv.includes('--confirm'),
    cluster,
    rpc: process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC[cluster],
    baseUrl: process.env.SELO_BASE_URL?.trim() || 'https://palpitei-v1-production.up.railway.app',
    outDir: process.env.SELO_OUT_DIR?.trim() || DEFAULT_OUT_DIR,
    keypairPath: process.env.MINT_AUTHORITY_KEYPAIR?.trim() || null,
    pinnedCollection: process.env.SELO_COLLECTION_ADDRESS?.trim() || null,
    allowMissingImage: argv.includes('--allow-missing-image'),
    skipRoot: argv.includes('--no-stat-root'),
    // NUMERIC: statKey='Goals' returns HTTP 500. 1 and 4 work.
    statKey: Number(process.env.SELO_STAT_KEY ?? 1),
    grantDebut: argv.includes('--grant-debut') || argv.includes('--trophies-only'),
    trophiesOnly: argv.includes('--trophies-only'),
  };
}

/**
 * Loads the signing keypair from a PATH, never from a secret in the environment.
 *
 * Accepts the format the Solana CLI writes (`solana-keygen new -o <file>`):
 * a JSON array of 64 bytes. Nothing derived from the secret is ever returned to
 * a caller that logs, and the bytes never touch a string.
 */
function loadMintAuthoritySecret(path: string) {
  if (!existsSync(path)) {
    throw new Error(
      `chave de signature não encontrada em ${path}. ` +
        `Gere com: solana-keygen new -o ${path} (fora do repo, chmod 600).`,
    );
  }
  let bytes: Uint8Array;
  try {
    const cru: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(cru)) throw new TypeError('o arquivo não é um array JSON de bytes');
    bytes = Uint8Array.from(cru as number[]);
  } catch (e) {
    // Never include the file contents in the message.
    throw new Error(`não deu para ler a chave em ${path}: ${e instanceof Error ? e.message : 'formato inválido'}`);
  }
  if (bytes.length !== 64) {
    throw new Error(`a chave em ${path} tem ${bytes.length} bytes; o esperado são 64`);
  }
  return bytes;
}

/** Truncated address for logs. Full addresses only in the final mint report. */
const shorten = (address: string): string => `${address.slice(0, 4)}…${address.slice(-4)}`;

/**
 * Checks that an image URL actually serves a PNG.
 *
 * The art is not a file on disk: the seals are rendered on demand by
 * `apps/web/src/app/selo/`, so only the deployed URL the metadata publishes can
 * be checked, never local bytes.
 *
 * It FAILS CLOSED. Any non-200, any content type that is not an image, an empty
 * body, a refused connection, DNS failure or timeout all return false, and false
 * blocks the mint. A permanently image-less asset is worse than a mint deferred
 * to the next run.
 */
async function imageUrlResolves(url: string): Promise<{ ok: boolean; motivo: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    // GET, not HEAD: the route renders on demand, and a HEAD that some layer
    // answers from a route table would prove nothing about the render.
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) return { ok: false, motivo: `HTTP ${response.status}` };
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return { ok: false, motivo: `content-type ${type || '(missing)'}` };
    const bytes = new Uint8Array(await response.arrayBuffer());
    // PNG magic. A 200 with an HTML error page is exactly the failure this catches.
    const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!isPng) return { ok: false, motivo: `${bytes.length} bytes that do not start with the PNG signature` };
    return { ok: true, motivo: `${bytes.length} bytes of PNG` };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : 'network failure' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads the `eventStatRoot` for this fixture and VERIFIES it against the anchor.
 *
 * The response also carries `statToProve`, `summary` and the proof paths. Those
 * are used locally as check inputs and never stored, never logged and never
 * returned: they are the licensed data itself, and a mint is permanent.
 *
 * Returns the base58 root only when verification passes. On any failure it
 * returns null and PRINTS WHY: the root arrives as 32 bytes under numeric keys,
 * never as a string, so "no root in the response" and "could not read the root"
 * are easy to confuse and a wrong reason costs more than a missing attribute.
 */
async function readVerifiedEventStatRoot(
  palpitei: ReturnType<typeof createPalpitei>,
  options: Options,
  umi: ReturnType<typeof createUmi>,
): Promise<{ base58Root: string | null; anchorPda: string; epochDay: number } | null> {
  try {
    // The proof needs a REAL observed game_finalised sequence number.
    const rows = await palpitei.db.query(
      `select seq from match_events
        where fixture_id = $1 and action = 'game_finalised'
        order by seq desc limit 1`,
      [options.fixtureId],
    );
    const seq = rows[0]?.seq;
    if (seq == null) {
      console.warn(`anchor: no game_finalised stored for ${options.fixtureId}; root omitted.`);
      return null;
    }
    await ensureJwt();
    const response = (await fetchStatValidation(options.fixtureId, Number(seq), options.statKey)) as {
      ts?: unknown;
      eventStatRoot?: unknown;
      subTreeProof?: unknown;
      mainTreeProof?: unknown;
      summary?: { eventStatsSubTreeRoot?: unknown };
    } | null;

    // The epoch day comes from the PROOF timestamp, never the wall clock: a run
    // after midnight UTC would otherwise derive the wrong day's account.
    const proofTs = Number(response?.ts);
    if (!Number.isFinite(proofTs)) {
      console.warn('anchor: the proof carried no usable ts; root omitted.');
      return null;
    }
    const epochDay = epochDayFrom(proofTs);
    const anchorPda = String(
      umi.eddsa.findPda(publicKey(ANCHOR_PROGRAM_IDS[options.cluster]), dailyScoresRootsSeeds(epochDay))[0],
    );

    const account = await umi.rpc.getAccount(publicKey(anchorPda));
    const accountData = account.exists ? account.data : null;
    if (account.exists && String(account.owner) !== ANCHOR_PROGRAM_IDS[options.cluster]) {
      console.warn(`anchor: account ${anchorPda} is not owned by the validation program; root omitted.`);
      return null;
    }

    const verification = verifyEventStatRoot({
      eventStatRoot: response?.eventStatRoot,
      subTreeProof: response?.subTreeProof,
      mainTreeProof: response?.mainTreeProof,
      eventStatsSubTreeRoot: response?.summary?.eventStatsSubTreeRoot,
      anchorAccountData: accountData,
      expectedEpochDay: epochDay,
    });

    if (!verification.verified) {
      // The ROOT is dropped, but the anchor address stays: it was derived from
      // the proof timestamp and the account was confirmed to exist, be owned by
      // the validation program and report this same day. Falling back to the
      // kickoff day here would throw away a better derivation over a failure
      // that has nothing to do with it.
      console.warn(`anchor: root NOT verified, attribute omitted. Reason: ${verification.reason}`);
      return { base58Root: null, anchorPda, epochDay };
    }
    return { base58Root: base58.deserialize(verification.root)[0], anchorPda, epochDay };
  } catch (e) {
    console.warn(`anchor: verification failed (${e instanceof Error ? e.message : 'error'}); root omitted.`);
    return null;
  }
}

/**
 * Grants the debut trophy for a fixture the OPERATOR states was live.
 *
 * Writes to Postgres only: no key is read and nothing is broadcast, so this
 * half of the backfill runs safely with `--confirm` and no wallet at all.
 * Idempotent through the partial unique index, so re-running is a no-op.
 */
async function backfillDebutTrophies(
  palpitei: ReturnType<typeof createPalpitei>,
  options: Options,
): Promise<void> {
  const fans = await palpitei.trophies.listDebutBackfill(options.fixtureId);
  const pending = fans.filter((f) => !f.alreadyHasDebut);
  console.log(`\n=== debut trophy (fixture ${options.fixtureId}) ===`);
  console.log(`  fans who made a palpite: ${fans.length}`);
  console.log(`  already had the debut: ${fans.length - pending.length}`);
  console.log(`  to grant: ${pending.length}`);
  for (const f of pending) console.log(`    ${f.handle ?? f.userId}`);

  if (!options.confirm) {
    console.log(`  DRY RUN: no trophy was written.`);
    return;
  }
  let granted = 0;
  for (const f of pending) {
    if (await palpitei.trophies.awardDebut(f.userId, String(options.fixtureId))) granted++;
  }
  console.log(`  granted: ${granted} (no XP was written)`);
}

/**
 * Blocks until a freshly created collection is actually readable.
 *
 * `sendAndConfirm` resolving means the transaction confirmed, not that the next
 * transaction will find the account. Referencing it too early makes mpl-core
 * panic while loading it, which surfaces as "Program failed to complete" at a
 * couple of thousand compute units and looks nothing like a race.
 */
async function waitForCollection(
  umi: ReturnType<typeof createUmi>,
  address: string,
  tentativas = 20,
): Promise<void> {
  for (let i = 0; i < tentativas; i++) {
    try {
      await fetchCollection(umi, publicKey(address));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw new Error(`collection ${address} did not become readable in time — nothing was minted`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  console.log(`=== Selo TxLINE — ${options.confirm ? 'REAL MINT' : 'DRY RUN (nothing is broadcast)'} ===`);
  console.log(`fixture:  ${options.fixtureId}`);
  console.log(`cluster:  ${options.cluster}`);
  console.log(`rpc:      ${options.rpc}`);
  console.log(`base url: ${options.baseUrl}`);
  console.log(`metadata in: ${options.outDir}`);

  const palpitei = createPalpitei();
  try {
    if (options.grantDebut) await backfillDebutTrophies(palpitei, options);
    if (options.trophiesOnly) {
      console.log(`\n--trophies-only: stopping here. No key was read, nothing was broadcast.`);
      return;
    }

    // One row per fan already: the query returns each fan's FIRST live palpite.
    const candidates = await palpitei.trophies.listSeloCandidates(options.fixtureId);
    console.log(`\nlive debuts in Postgres: ${candidates.length} (one Selo per fan)`);
    if (candidates.length === 0) {
      console.log(
        'nobody debuted live on this fixture with a real wallet. Nothing to mint.',
      );
      return;
    }

    const umi = createUmi(options.rpc).use(mplCore());

    // THE EPOCH DAY COMES FROM THE PROOF TIMESTAMP, never the wall clock and
    // never kickoff: the TxLINE docs are explicit, and a run after midnight UTC
    // would otherwise derive and publish the wrong day's account.
    const anchor = options.skipRoot ? null : await readVerifiedEventStatRoot(palpitei, options, umi);

    // Fallback only when no proof could be fetched at all. Kickoff day is a
    // weaker derivation, so it is labelled as such instead of passing silently.
    const epochDay = anchor?.epochDay ?? epochDayFrom(candidates[0]!.startTime ?? Date.now());
    const anchorPda =
      anchor?.anchorPda ??
      String(umi.eddsa.findPda(publicKey(ANCHOR_PROGRAM_IDS[options.cluster]), dailyScoresRootsSeeds(epochDay))[0]);

    console.log(
      `TxLINE anchor (epoch day ${epochDay}${anchor ? ', from the proof ts' : ', from kickoff: proof unavailable'}): ${anchorPda}`,
    );
    console.log(`validation program: ${ANCHOR_PROGRAM_IDS[options.cluster]}`);
    const eventStatRoot = anchor?.base58Root ?? null;
    if (eventStatRoot) console.log(`eventStatRoot VERIFIED (bs58): ${eventStatRoot}`);

    mkdirSync(options.outDir, { recursive: true });

    // The collection needs a JSON served too; writing it here avoids minting
    // against a uri that would answer 404 forever.
    const collectionMetadata = {
      name: SELO_COLLECTION_NAME,
      description:
        'Recibos de estreia no Palpitei: o primeiro palpite de cada fã numa partida ao vivo, ' +
        'sobre dados de partida ancorados pela TxLINE (TxODDS) na Solana. Marcam presença, ' +
        'não acerto. Intransferíveis e sem valor monetário.',
      image: `${options.baseUrl.replace(/\/+$/, '')}/selo/collection.png`,
      external_url: options.baseUrl.replace(/\/+$/, ''),
    };
    writeFileSync(join(options.outDir, 'collection.json'), `${JSON.stringify(collectionMetadata, null, 2)}\n`, 'utf8');

    // ---- what would be minted, item by item ---------------------------------
    type MintItem = {
      candidate: SeloCandidate;
      metadata: SeloMetadata;
      uri: string;
      file: string;
      existingMint: string | null;
    };

    const items: MintItem[] = candidates.map((c) => {
      const startTime = c.startTime;
      if (startTime == null) {
        throw new Error(`fixture ${options.fixtureId} has no start_ts in the database; without a date there is no slug and no anchor`);
      }
      const slug = matchSlug(c.p1, c.p2, startTime);
      // Keyed by fan, never by question: two fans can debut on the SAME question.
      // The user id is the fallback only when onboarding never set a handle.
      const fileName = metadataFileName(slug, c.handle ?? c.userId);
      const metadata = buildSeloMetadata({
        ...(c.handle ? { handle: c.handle } : {}),
        p1: c.p1,
        p2: c.p2,
        startTime,
        prompt: c.prompt,
        choiceLabel: c.choiceLabel,
        placedAt: c.placedAt,
        cluster: options.cluster,
        anchorPda: anchorPda,
        ...(eventStatRoot ? { eventStatRoot } : {}),
        baseUrl: options.baseUrl,
      });
      return {
        candidate: c,
        metadata,
        uri: `${options.baseUrl.replace(/\/+$/, '')}/selo/${fileName}`,
        file: join(options.outDir, fileName),
        existingMint: c.mintStatus ?? null,
      };
    });

    for (const item of items) {
      const { candidate: c } = item;
      console.log(`\n--- ${c.handle ?? '(no handle)'} ---`);
      console.log(`  wallet:     ${shorten(c.walletPubkey)}  (${c.walletSource})`);
      console.log(`  debut at:   ${new Date(c.placedAt).toISOString()}`);
      console.log(`  question:   ${c.prompt}`);
      console.log(`  palpite:    ${c.choiceLabel}`);
      console.log(`  name:       ${item.metadata.name}`);
      console.log(`  uri:        ${item.uri}`);
      console.log(`  image:      ${item.metadata.image}`);
      if (item.existingMint) {
        console.log(`  STATE:      a mint record already exists (${item.existingMint}) — will be SKIPPED`);
      }
      // The whole document, for field-by-field review before anything permanent.
      console.log(`  metadata:\n${JSON.stringify(item.metadata, null, 2).replace(/^/gm, '    ')}`);
      writeFileSync(item.file, `${JSON.stringify(item.metadata, null, 2)}\n`, 'utf8');
    }

    const pendingItems = items.filter((i) => !i.existingMint);

    console.log(`\n=== summary ===`);
    console.log(`  to mint:   ${pendingItems.length}`);
    console.log(`  skipped:   ${items.length - pendingItems.length} (already recorded)`);
    console.log(`  JSON written to ${options.outDir} (${items.length} file(s))`);

    // The art is rendered per route, not stored on disk, and it is keyed by
    // MATCH: every fan in a fixture points at the same image. Check the distinct
    // URLs plus the collection's, which is minted alongside them.
    const imageUrls = [...new Set([...pendingItems.map((i) => i.metadata.image), collectionMetadata.image])];
    console.log(`\n=== images (rendered per route, checked over HTTP) ===`);
    const missingImages: string[] = [];
    for (const url of imageUrls) {
      const check = await imageUrlResolves(url);
      console.log(`  ${check.ok ? 'OK  ' : 'FAIL'} ${url}  (${check.motivo})`);
      if (!check.ok) missingImages.push(url);
    }
    if (missingImages.length > 0) {
      console.log(
        `\n  WARNING: ${missingImages.length} image(s) do not answer with PNG.\n` +
          `  Check that the apps/web deploy shipped with the /selo routes.\n` +
          `  Without the image live, the asset stays permanently image-less.`,
      );
    }

    if (!options.confirm) {
      console.log(`\nDRY RUN: nothing was broadcast, no key was read.`);
      console.log(`Review the fields above one by one. If they are right:`);
      console.log(`  1. publish the JSON (deploy apps/web) and confirm the uri answers 200;`);
      console.log(`     the images are rendered per route — the check above already verified them over HTTP;`);
      console.log(`  2. export MINT_AUTHORITY_KEYPAIR with the PATH to the funded key;`);
      console.log(`  3. run again with --confirm.`);
      return;
    }

    // ---- from here down, only with --confirm --------------------------------
    if (missingImages.length > 0 && !options.allowMissingImage) {
      throw new Error(
        `refusing to mint: ${missingImages.length} image(s) do not answer with PNG (${missingImages.join(', ')}). ` +
          `Deploy apps/web and check the /selo routes, or run with --allow-missing-image ` +
          `if you really want an asset with no image forever.`,
      );
    }
    if (!options.keypairPath) {
      throw new Error(
        `MINT_AUTHORITY_KEYPAIR is not set. It is the PATH to a key file outside the repo, ` +
          `never the key itself.`,
      );
    }

    const authority = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(loadMintAuthoritySecret(options.keypairPath)));
    umi.use(signerIdentity(authority));
    // The pubkey only. Never the secretKey, never the bytes, never the signer.
    console.log(`\nmint authority: ${authority.publicKey}`);

    const balance = await umi.rpc.getBalance(authority.publicKey);
    console.log(`balance: ${Number(balance.basisPoints) / 1e9} SOL`);
    if (balance.basisPoints === 0n) {
      throw new Error(
        `the authority has no balance. On devnet: solana airdrop 2 ${authority.publicKey} --url devnet`,
      );
    }

    // The collection is created ONCE. Reuse the one pinned by env, else the last
    // one already minted in the database, else create it.
    let collection = options.pinnedCollection;
    if (!collection) {
      const previousMints = await palpitei.trophies.listMints({ cluster: options.cluster });
      collection = previousMints.find((m) => m.status === 'minted' && m.collectionPubkey)?.collectionPubkey ?? null;
    }

    let collectionSigner = null as ReturnType<typeof generateSigner> | null;
    if (!collection) {
      collectionSigner = generateSigner(umi);
      console.log(`\ncreating collection "${SELO_COLLECTION_NAME}": ${collectionSigner.publicKey}`);
      await createCollection(umi, {
        collection: collectionSigner,
        name: SELO_COLLECTION_NAME,
        uri: `${options.baseUrl.replace(/\/+$/, '')}/selo/collection.json`,
        // Soulbound at the collection level: `authority: { type: 'None' }` is the
        // load-bearing part, because nobody, not even the issuer, can unfreeze.
        plugins: [{ type: 'PermanentFreezeDelegate', frozen: true, authority: { type: 'None' } }],
      }).sendAndConfirm(umi);
      collection = String(collectionSigner.publicKey);
      console.log(`collection created: ${collection}`);
      // A collection created in this same run is not yet readable by the next
      // transaction; referencing it early makes mpl-core panic. Wait for it.
      await waitForCollection(umi, collection);
    } else {
      console.log(`\nreusing the existing collection: ${collection}`);
    }

    const minted: { handle: string; asset: string; signature: string }[] = [];

    for (const item of pendingItems) {
      const { candidate: c } = item;
      // THE CLAIM COMES BEFORE THE BROADCAST. If the process dies mid-flight the
      // row stays 'pending' and BLOCKS a retry: the dangerous failure is minting
      // twice, not failing to mint.
      const claim = await palpitei.trophies.claimMint({
        userId: c.userId,
        questionId: c.questionId,
        cluster: options.cluster,
        ownerPubkey: c.walletPubkey,
      });
      if (!claim) {
        console.log(`\n${c.handle ?? c.userId}: claim refused by the database — SKIPPED`);
        continue;
      }

      const assetSigner = generateSigner(umi);
      try {
        const r = await create(umi, {
          asset: assetSigner,
          collection: { publicKey: publicKey(collection), oracles: [], lifecycleHooks: [] },
          owner: publicKey(c.walletPubkey),
          name: item.metadata.name,
          uri: item.uri,
          // Repeated on the asset on purpose: someone opening a SINGLE asset in
          // an explorer sees "not transferable" right there, without inspecting
          // the collection. Non-transferable and non-burnable, by design.
          plugins: [{ type: 'PermanentFreezeDelegate', frozen: true, authority: { type: 'None' } }],
        }).sendAndConfirm(umi);

        const signature = base58.deserialize(r.signature)[0];
        await palpitei.trophies.confirmMint(claim.id, {
          assetPubkey: String(assetSigner.publicKey),
          collectionPubkey: collection,
          signature: signature,
          metadataUri: item.uri,
        });
        minted.push({ handle: c.handle ?? c.userId, asset: String(assetSigner.publicKey), signature });
        console.log(`\n${c.handle ?? c.userId}: minted`);
        console.log(`  asset:      ${assetSigner.publicKey}`);
        console.log(`  signature: ${signature}`);
      } catch (e) {
        // `err.message` and nothing else: the error context carries the signer.
        console.error(`\n${c.handle ?? c.userId}: FAILED — ${e instanceof Error ? e.message : 'unknown error'}`);
        console.error(
          `  claim ${claim.id} stays 'pending' on purpose and BLOCKS a retry. ` +
            `Check ${assetSigner.publicKey} on the explorer before releasing the row by hand.`,
        );
      }
    }

    console.log(`\n=== minted ===`);
    console.log(`collection: ${collection}`);
    for (const c of minted) console.log(`  ${c.handle}: ${c.asset}  (tx ${c.signature})`);
    console.log(`\nKeep this output. Publish the collection in the README and in the Brief.`);
    console.log(
      `After CHECKING the metadata on the explorer, consider revoking the update authority: ` +
        `with the asset frozen and non-burnable, it is the only lever left over it.`,
    );
  } finally {
    await palpitei.close();
  }
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
