// One-off backfill that mints the Selo TxLINE for correct in-play predictions.
//
// Uso:
//   npm run selo:mint -w @palpitei/selo -- <fixtureId>              (DRY RUN, o padrão)
//   npm run selo:mint -w @palpitei/selo -- <fixtureId> --confirm    (transmite de verdade)
//
// NÃO é mint automático e não roda no servidor. É rodado por um humano, da
// máquina dele, com a chave dele, depois de conferir o dry run.
//
// A CHAVE NUNCA VEM POR ENV. `MINT_AUTHORITY_KEYPAIR` é o CAMINHO de um file
// fora do repo; segredo em env vaza por `ps`, dump de crash, log de processo e
// por `railway variables --kv` rodado com alguém olhando. Só o pubkey é impresso.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSignerFromKeypair, generateSigner, publicKey, signerIdentity } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { create, createCollection, mplCore } from '@metaplex-foundation/mpl-core';
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

/** France x England: a única partida ao vivo já ingerida e gravada. */
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
    // --dry-run é o PADRÃO. Só a presença explícita de --confirm transmite.
    confirm: argv.includes('--confirm'),
    cluster,
    rpc: process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC[cluster],
    baseUrl: process.env.SELO_BASE_URL?.trim() || 'https://palpitei-v1-production.up.railway.app',
    outDir: process.env.SELO_OUT_DIR?.trim() || DEFAULT_OUT_DIR,
    keypairPath: process.env.MINT_AUTHORITY_KEYPAIR?.trim() || null,
    pinnedCollection: process.env.SELO_COLLECTION_ADDRESS?.trim() || null,
    allowMissingImage: argv.includes('--allow-missing-image'),
    skipRoot: argv.includes('--no-stat-root'),
    // NUMÉRICO: statKey='Goals' devolve HTTP 500. 1 e 4 funcionam.
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
    // Nunca inclua o conteúdo do file na mensagem.
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
 * Reads the `eventStatRoot` for this fixture and VERIFIES it against the anchor.
 *
 * The response also carries `statToProve`, `summary` and the proof paths. Those
 * are used locally as check inputs and never stored, never logged and never
 * returned: they are the licensed data itself, and a mint is permanent.
 *
 * Returns the base58 root only when verification passes. On any failure it
 * returns null and PRINTS WHY, because the previous version printed "a resposta
 * não trouxe eventStatRoot" when the truth was "veio e eu não soube ler" (it is
 * 32 bytes in numeric keys, never a string). A wrong reason costs more than a
 * missing attribute.
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
      console.warn(`âncora: sem game_finalised gravado para ${options.fixtureId}; root omitido.`);
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
      console.warn('âncora: a prova não trouxe ts utilizável; root omitido.');
      return null;
    }
    const epochDay = epochDayFrom(proofTs);
    const anchorPda = String(
      umi.eddsa.findPda(publicKey(ANCHOR_PROGRAM_IDS[options.cluster]), dailyScoresRootsSeeds(epochDay))[0],
    );

    const account = await umi.rpc.getAccount(publicKey(anchorPda));
    const accountData = account.exists ? account.data : null;
    if (account.exists && String(account.owner) !== ANCHOR_PROGRAM_IDS[options.cluster]) {
      console.warn(`âncora: a conta ${anchorPda} não pertence ao programa de validação; root omitido.`);
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
      console.warn(`âncora: root NÃO verificado, atributo omitido. Motivo: ${verification.reason}`);
      return { base58Root: null, anchorPda, epochDay };
    }
    return { base58Root: base58.deserialize(verification.root)[0], anchorPda, epochDay };
  } catch (e) {
    console.warn(`âncora: verificação falhou (${e instanceof Error ? e.message : 'erro'}); root omitido.`);
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
  console.log(`\n=== troféu de estreia (fixture ${options.fixtureId}) ===`);
  console.log(`  fãs que palpitaram: ${fans.length}`);
  console.log(`  já tinham a estreia: ${fans.length - pending.length}`);
  console.log(`  a conceder: ${pending.length}`);
  for (const f of pending) console.log(`    ${f.handle ?? f.userId}`);

  if (!options.confirm) {
    console.log(`  DRY RUN: nenhum troféu foi gravado.`);
    return;
  }
  let granted = 0;
  for (const f of pending) {
    if (await palpitei.trophies.awardDebut(f.userId, String(options.fixtureId))) granted++;
  }
  console.log(`  granted: ${granted} (nenhum XP foi escrito)`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  console.log(`=== Selo TxLINE — ${options.confirm ? 'CUNHAGEM REAL' : 'DRY RUN (nada é transmitido)'} ===`);
  console.log(`fixture:  ${options.fixtureId}`);
  console.log(`cluster:  ${options.cluster}`);
  console.log(`rpc:      ${options.rpc}`);
  console.log(`base url: ${options.baseUrl}`);
  console.log(`metadados em: ${options.outDir}`);

  const palpitei = createPalpitei();
  try {
    if (options.grantDebut) await backfillDebutTrophies(palpitei, options);
    if (options.trophiesOnly) {
      console.log(`\n--trophies-only: parando aqui. Nenhuma chave foi lida, nada foi transmitido.`);
      return;
    }

    // One row per fan already: the query returns each fan's FIRST live palpite.
    const candidates = await palpitei.trophies.listSeloCandidates(options.fixtureId);
    console.log(`\nestreias ao vivo no Postgres: ${candidates.length} (um Selo por fã)`);
    if (candidates.length === 0) {
      console.log(
        'ninguém estreou ao vivo nessa fixture com carteira real. Nada a cunhar.',
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
      `âncora TxLINE (epoch day ${epochDay}${anchor ? ', do ts da prova' : ', do apito: prova indisponível'}): ${anchorPda}`,
    );
    console.log(`programa de validação: ${ANCHOR_PROGRAM_IDS[options.cluster]}`);
    const eventStatRoot = anchor?.base58Root ?? null;
    if (eventStatRoot) console.log(`eventStatRoot VERIFICADO (bs58): ${eventStatRoot}`);

    mkdirSync(options.outDir, { recursive: true });

    // A coleção também precisa de um JSON no ar; escrever aqui evita cunhar
    // apontando para uma uri que responde 404 para sempre.
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

    // ---- o que seria cunhado, item a item -----------------------------------
    type MintItem = {
      candidate: SeloCandidate;
      metadata: SeloMetadata;
      uri: string;
      file: string;
      localImage: string;
      existingMint: string | null;
    };

    const items: MintItem[] = candidates.map((c) => {
      const startTime = c.startTime;
      if (startTime == null) {
        throw new Error(`a fixture ${options.fixtureId} não tem start_ts no banco; sem data não há slug nem âncora`);
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
        localImage: join(options.outDir, `${slug}.png`),
        existingMint: c.mintStatus ?? null,
      };
    });

    for (const item of items) {
      const { candidate: c } = item;
      console.log(`\n--- ${c.handle ?? '(sem apelido)'} ---`);
      console.log(`  carteira:   ${shorten(c.walletPubkey)}  (${c.walletSource})`);
      console.log(`  estreia em: ${new Date(c.placedAt).toISOString()}`);
      console.log(`  pergunta:   ${c.prompt}`);
      console.log(`  palpite:    ${c.choiceLabel}`);
      console.log(`  nome:       ${item.metadata.name}`);
      console.log(`  uri:        ${item.uri}`);
      console.log(`  imagem:     ${item.metadata.image}`);
      if (item.existingMint) {
        console.log(`  ESTADO:     já existe registro de cunhagem (${item.existingMint}) — será PULADO`);
      }
      // O documento inteiro, para conferência campo a campo antes de algo permanente.
      console.log(`  metadado:\n${JSON.stringify(item.metadata, null, 2).replace(/^/gm, '    ')}`);
      writeFileSync(item.file, `${JSON.stringify(item.metadata, null, 2)}\n`, 'utf8');
    }

    const pendingItems = items.filter((i) => !i.existingMint);
    const missingImages = pendingItems.filter((i) => !existsSync(i.localImage));

    console.log(`\n=== resumo ===`);
    console.log(`  a cunhar:  ${pendingItems.length}`);
    console.log(`  pulados:   ${items.length - pendingItems.length} (já registrados)`);
    console.log(`  JSON escrito em ${options.outDir} (${items.length} arquivo(s))`);

    if (missingImages.length > 0) {
      console.log(
        `\n  ATENÇÃO: ${missingImages.length} imagem(ns) não existe(m) em ${options.outDir}:\n` +
          missingImages.map((i) => `    ${i.localImage}`).join('\n') +
          `\n  Sem o PNG no ar, o asset fica permanentemente sem imagem.`,
      );
    }

    if (!options.confirm) {
      console.log(`\nDRY RUN: nada foi transmitido, nenhuma chave foi lida.`);
      console.log(`Confira campo a campo acima. Se estiver certo:`);
      console.log(`  1. publique os JSON e os PNG (deploy do apps/web) e confirme que a uri responde 200;`);
      console.log(`  2. exporte MINT_AUTHORITY_KEYPAIR com o CAMINHO da chave financiada;`);
      console.log(`  3. rode de novo com --confirm.`);
      return;
    }

    // ---- daqui para baixo, só com --confirm ---------------------------------
    if (missingImages.length > 0 && !options.allowMissingImage) {
      throw new Error(
        `recusando cunhar com imagem ausente. Publique os PNG ou rode com --allow-missing-image ` +
          `se quiser mesmo um asset sem imagem para sempre.`,
      );
    }
    if (!options.keypairPath) {
      throw new Error(
        `MINT_AUTHORITY_KEYPAIR não definida. Ela é o CAMINHO de um file de chave fora do repo, ` +
          `nunca a chave em si.`,
      );
    }

    const authority = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(loadMintAuthoritySecret(options.keypairPath)));
    umi.use(signerIdentity(authority));
    // Só o pubkey. Nunca o secretKey, nunca os bytes, nunca o signer inteiro.
    console.log(`\nautoridade de cunhagem: ${authority.publicKey}`);

    const balance = await umi.rpc.getBalance(authority.publicKey);
    console.log(`balance: ${Number(balance.basisPoints) / 1e9} SOL`);
    if (balance.basisPoints === 0n) {
      throw new Error(
        `a authority está sem balance. Em devnet: solana airdrop 2 ${authority.publicKey} --url devnet`,
      );
    }

    // A coleção é criada UMA vez. Reaproveita a fixada por env, senão a última
    // já cunhada no banco, senão cria.
    let collection = options.pinnedCollection;
    if (!collection) {
      const previousMints = await palpitei.trophies.listMints({ cluster: options.cluster });
      collection = previousMints.find((m) => m.status === 'minted' && m.collectionPubkey)?.collectionPubkey ?? null;
    }

    let collectionSigner = null as ReturnType<typeof generateSigner> | null;
    if (!collection) {
      collectionSigner = generateSigner(umi);
      console.log(`\ncriando a coleção "${SELO_COLLECTION_NAME}": ${collectionSigner.publicKey}`);
      await createCollection(umi, {
        collection: collectionSigner,
        name: SELO_COLLECTION_NAME,
        uri: `${options.baseUrl.replace(/\/+$/, '')}/selo/collection.json`,
        // Soulbound no nível da coleção: `authority: { type: 'None' }` é a peça,
        // porque ninguém, nem o emissor, consegue descongelar depois.
        plugins: [{ type: 'PermanentFreezeDelegate', frozen: true, authority: { type: 'None' } }],
      }).sendAndConfirm(umi);
      collection = String(collectionSigner.publicKey);
      console.log(`coleção criada: ${collection}`);
    } else {
      console.log(`\nreusando a coleção existente: ${collection}`);
    }

    const minted: { handle: string; asset: string; signature: string }[] = [];

    for (const item of pendingItems) {
      const { candidate: c } = item;
      // A RESERVA VEM ANTES DA TRANSMISSÃO. Se o processo morrer no meio, a linha
      // fica 'pending' e BLOQUEIA nova tentativa: a falha perigosa é cunhar duas
      // vezes, não deixar de cunhar.
      const claim = await palpitei.trophies.claimMint({
        userId: c.userId,
        questionId: c.questionId,
        cluster: options.cluster,
        ownerPubkey: c.walletPubkey,
      });
      if (!claim) {
        console.log(`\n${c.handle ?? c.userId}: claim recusada pelo banco — PULADO`);
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
          // Repetido no asset, de propósito: o jurado que abre UM asset no
          // explorer vê "não transferível" ali, sem ter que inspecionar a
          // coleção. Intransferível e não queimável, por decisão do dono.
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
        console.log(`\n${c.handle ?? c.userId}: cunhado`);
        console.log(`  asset:      ${assetSigner.publicKey}`);
        console.log(`  signature: ${signature}`);
      } catch (e) {
        // `err.message` e nada mais: o contexto do erro carrega o signer dentro.
        console.error(`\n${c.handle ?? c.userId}: FALHOU — ${e instanceof Error ? e.message : 'erro desconhecido'}`);
        console.error(
          `  a claim ${claim.id} fica 'pending' de propósito e BLOQUEIA nova tentativa. ` +
            `Confira ${assetSigner.publicKey} no explorer antes de liberar a linha na mão.`,
        );
      }
    }

    console.log(`\n=== cunhado ===`);
    console.log(`coleção: ${collection}`);
    for (const c of minted) console.log(`  ${c.handle}: ${c.asset}  (tx ${c.signature})`);
    console.log(`\nGuarde esta saída. Publique a coleção no README e no Brief.`);
    console.log(
      `Depois de CONFERIR os metadados no explorer, considere revogar a update authority: ` +
        `com o asset congelado e não queimável, ela é a única alavanca que ainda existe sobre ele.`,
    );
  } finally {
    await palpitei.close();
  }
}

main().catch((e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e);
  process.exit(1);
});
