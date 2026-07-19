/**
 * Metadata for the Selo TxLINE, and the guard that keeps licensed data out of it.
 *
 * WHAT THE BADGE CLAIMS: this fan placed their FIRST palpite in a live match,
 * on this match, at this moment. It attests PRESENCE, not performance. Two of
 * the three debut palpites on 18257865 were wrong, so any wording that frames
 * the Selo as a correct call is a lie on most of the badges minted.
 *
 * THE LINE: the badge describes THE FAN'S PALPITE, never THE MATCH. If an
 * attribute only makes sense once you know what happened on the pitch, it does
 * not go in. A new field in doubt does not go in.
 *
 * This is the one place in the codebase where a mistake is permanent and public:
 * there is no `git revert` for a minted asset. Hence `assertNoLicensedData`,
 * which runs on the finished object rather than trusting the builder.
 */

import { ANCHOR_PROGRAM_IDS, type AnchorCluster } from './anchor.ts';

export type SeloAttribute = { trait_type: string; value: string };

export type SeloMetadata = {
  name: string;
  description: string;
  image: string;
  category: 'image';
  external_url: string;
  attributes: SeloAttribute[];
  properties: { files: { uri: string; type: string }[] };
};

export type SeloMetadataInput = {
  /** Public handle. Optional: onboarding may not have finished. */
  handle?: string;
  /** Home team name. A public World Cup fact. */
  p1: string;
  /** Away team name. A public World Cup fact. */
  p2: string;
  /** Kickoff, epoch ms. Used for the date, the slug and the anchor day. */
  startTime: number;
  /** The Palpitei engine's own prompt, never a TxLINE market name. */
  prompt: string;
  /** The label the fan actually saw for the option they chose. */
  choiceLabel: string;
  /** Wall clock of the debut palpite, epoch ms. The "at this moment" part. */
  placedAt: number;
  cluster: AnchorCluster;
  /** The derived `daily_scores_roots` PDA for the match day. */
  anchorPda: string;
  /**
   * The `eventStatRoot` TxODDS committed to, base58, ALREADY VERIFIED.
   *
   * A root is a commitment, not a disclosure: it is hash output over the tree,
   * it cannot be inverted, and without the leaf and the path it reveals no fact.
   * More decisively, TxODDS publishes these roots to Solana themselves, so this
   * republishes a pointer to something already public by their own action.
   *
   * Base58 because that is how every other address and hash on this badge and
   * in a Solana explorer renders, so a verifier compares like with like. The
   * `bs58:` prefix on the value states it, since a bare 44-character string is
   * indistinguishable from hex or base64 at a glance.
   *
   * Pass it ONLY after `verifyEventStatRoot` returns `verified: true`. Omitted
   * rather than embedded unchecked, because a root the badge cannot vouch for is
   * a provenance claim we did not earn.
   */
  eventStatRoot?: string;
  /** Base URL that serves the image and this JSON. */
  baseUrl: string;
};

/** Product name, on-chain included. Decided by the owner. */
export const SELO_NAME = 'Selo TxLINE';
export const SELO_COLLECTION_NAME = 'Selo TxLINE · Palpitei';

/**
 * Field names that must NEVER reach a public, permanent artifact.
 *
 * `statToProve` and `summary` carry VALUES: they are the licensed data itself.
 * The proof paths leak tree structure (size, position, sibling count, and so how
 * many stats and events exist) and buy nothing, because anyone with credentials
 * refetches them from the API. Risk with no return.
 */
const FORBIDDEN_FIELDS = [
  'statToProve',
  'summary',
  'statProof',
  'subTreeProof',
  'mainTreeProof',
  'resolvedBySeq',
  'resolved_by_seq',
  'messageId',
  'message_id',
  'fixtureId',
  'fixture_id',
  'seq',
  'priceName',
  'PriceName',
  'prices',
  'Prices',
  'pct',
  'Pct',
  'odds',
  'goalsLine',
  'cornersLine',
];

/** Accent-free, lowercase, hyphenated. Stable across runs, so the URI is stable. */
export function matchSlug(p1: string, p2: string, startTime: number): string {
  const normalize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return `${normalize(p1)}-${normalize(p2)}-${isoDate(startTime)}`;
}

/**
 * File name for one asset's metadata document, keyed by FAN.
 *
 * Not by question id, which is what it used to be: with one Selo per fan, two
 * fans who debut on the SAME question produce the same file name, and the second
 * write silently overwrites the first. Caught in the dry run, where Rafy and
 * Kauã both debuted on "Sai outro escanteio em até 10 minutos?" and would have
 * shipped two assets pointing at one document naming only one of them. On chain
 * that is permanent.
 *
 * The fan key is the handle when there is one. It is already published in the
 * `Fan` trait, so this discloses nothing new, and one Selo per fan makes it
 * unique. Without a handle it falls back to the caller's opaque key.
 */
export function metadataFileName(slug: string, fanKey: string): string {
  const safe = fanKey
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${slug}-${safe}.json`;
}

/** UTC instant to the minute. Seconds would be false precision on a badge. */
export function isoMinute(timestampMs: number): string {
  return `${new Date(timestampMs).toISOString().slice(0, 16)}Z`;
}

/** UTC calendar date, which is also the day the anchor is derived from. */
export function isoDate(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

/**
 * Builds the metadata document.
 *
 * On the description: it ties the seal to the ANCHORED DATA, not to an
 * endorsement of this item. TxODDS did not attest this NFT and does not know it
 * exists, so "Verificado pela TxLINE" would be false. "sobre dados de partida
 * ancorados pela TxLINE" is true, and a true claim is the best defence there is.
 *
 * It also does NOT say the fan minted it: for the backfill an operator mints on
 * their behalf, and a permanent artifact must not narrate a gesture that did not
 * happen. And it does not say the palpite was right, because usually it was not.
 */
export function buildSeloMetadata(input: SeloMetadataInput): SeloMetadata {
  const slug = matchSlug(input.p1, input.p2, input.startTime);
  const image = `${input.baseUrl.replace(/\/+$/, '')}/selo/${slug}.png`;

  const attributes: SeloAttribute[] = [
    { trait_type: 'Match', value: `${input.p1} x ${input.p2}` },
    { trait_type: 'Match date', value: isoDate(input.startTime) },
    { trait_type: 'Match slug', value: slug },
  ];
  // Absent handle omits the trait: a placeholder would be invented data.
  if (input.handle) attributes.push({ trait_type: 'Fan', value: input.handle });
  attributes.push(
    // Says what the badge is FOR, in the badge itself. Without it, a reader
    // seeing only Question and Prediction could supply their own assumption
    // about why this was worth minting.
    { trait_type: 'Milestone', value: 'First live palpite' },
    { trait_type: 'Question', value: input.prompt },
    { trait_type: 'Palpite', value: input.choiceLabel },
    { trait_type: 'Placed at', value: isoMinute(input.placedAt) },
    // NO OUTCOME TRAIT, and this is a decision, not an omission by accident.
    // See `assertNoCorrectnessClaim` for the reasoning and the enforcement.
    //
    // No standard attribution field exists in either the Metaplex or the OpenSea
    // schema, so a free trait is the available practice, not an invention.
    { trait_type: 'Data source', value: 'TxLINE (TxODDS)' },
    { trait_type: 'TxLINE anchor', value: input.anchorPda },
    { trait_type: 'Anchor program', value: ANCHOR_PROGRAM_IDS[input.cluster] },
  );
  if (input.eventStatRoot) {
    attributes.push({ trait_type: 'TxLINE event stat root', value: `bs58:${input.eventStatRoot}` });
  }
  attributes.push({ trait_type: 'Transferable', value: 'No' });

  const metadata: SeloMetadata = {
    name: `${SELO_NAME} · ${input.handle ?? slug}`,
    description:
      'Recibo da estreia deste fã no Palpitei: o primeiro palpite dele numa partida ao vivo, ' +
      'sobre dados de partida ancorados pela TxLINE (TxODDS) na Solana. Marca presença na ' +
      'estreia, não acerto: o palpite pode ter dado certo ou não. Intransferível e sem valor ' +
      'monetário.',
    image,
    category: 'image',
    external_url: input.baseUrl.replace(/\/+$/, ''),
    attributes,
    properties: { files: [{ uri: image, type: 'image/png' }] },
  };

  assertNoLicensedData(metadata);
  assertNoCorrectnessClaim(metadata);
  return metadata;
}

/**
 * Throws if anything on the red list appears anywhere in the document.
 *
 * Deliberately checks the FINISHED object, key and value, at any depth. A guard
 * that trusts the builder only catches the bugs the builder's author imagined;
 * this one catches a field somebody adds later without reading this file.
 */
export function assertNoLicensedData(metadata: unknown): void {
  const found: string[] = [];

  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (FORBIDDEN_FIELDS.includes(key)) found.push(`${path}.${key}`);
        visit(v, `${path}.${key}`);
      }
      return;
    }
    // A `trait_type` naming a forbidden field is the same leak wearing a hat.
    if (typeof value === 'string' && FORBIDDEN_FIELDS.includes(value)) {
      found.push(`${path} = ${JSON.stringify(value)}`);
    }
  };

  visit(metadata, '$');

  if (found.length > 0) {
    throw new Error(
      `[selo] METADADO BLOQUEADO: campo licenciado da TxLINE encontrado em ${found.join(', ')}. ` +
        `Mint é permanente e público (T&C §7) — nada foi transmitido.`,
    );
  }
}

/**
 * Words that would turn a debut badge into a claim about being right.
 *
 * WHY THE RESULT IS OMITTED ENTIRELY, rather than published honestly as
 * "Outcome: Incorrect":
 *
 *   1. It is not what the badge claims. The Selo attests that the fan showed up
 *      for a live match and placed their first palpite. The result of that
 *      palpite is a different fact about a different subject.
 *   2. It would be permanent and punitive. Two of the three recipients got it
 *      wrong. Stamping that on a public, non-transferable, non-burnable object
 *      in someone's wallet, for a person who never asked for the object, is a
 *      cost with no matching purpose. XP already records performance, and XP is
 *      erasable.
 *   3. Omission only misleads if something else implies correctness. Nothing
 *      does: there is no outcome trait, `Milestone` states the badge is about a
 *      first live palpite, and the description says in as many words that the
 *      palpite may or may not have come off. This function is what keeps that
 *      true as the copy changes.
 *
 * If a future version DOES want to publish the result, publish it for everyone
 * with its real value. What must never happen is a badge that is silent when
 * the fan was wrong and loud when they were right.
 */
const CORRECTNESS_CLAIM_WORDS = [
  'outcome',
  'correct',
  'incorrect',
  'acerto',
  'acertou',
  'certeiro',
  'winner',
  'won',
  'win',
  'result',
  'resultado',
];

export function assertNoCorrectnessClaim(metadata: unknown): void {
  const found: string[] = [];

  const visit = (value: unknown, path: string): void => {
    // The description is EXEMPT, and must be: it earns its place by saying
    // "marca presença na estreia, não acerto", which cannot be written without
    // naming the thing it denies. Its wording is pinned by its own tests; this
    // guard exists for attributes, where a bare word reads as an assertion.
    if (path === '$.description') return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (CORRECTNESS_CLAIM_WORDS.includes(key.toLowerCase())) found.push(`${path}.${key}`);
        visit(v, `${path}.${key}`);
      }
      return;
    }
    if (typeof value === 'string') {
      // Whole words only: "Prediction" must not trip on "correct" inside a word,
      // and the description legitimately says the palpite may NOT have worked.
      const words = value.toLowerCase().split(/[^a-zà-ú]+/);
      for (const term of CORRECTNESS_CLAIM_WORDS) {
        if (words.includes(term)) found.push(`${path} contém "${term}"`);
      }
    }
  };

  visit(metadata, '$');

  if (found.length > 0) {
    throw new Error(
      `[selo] METADADO BLOQUEADO: o Selo marca ESTREIA, não acerto, e ${found.join(', ')} ` +
        `afirma o contrário. Dois dos três selos vão para palpites errados: a alegação seria ` +
        `falsa e permanente (regra 4 / G6).`,
    );
  }
}
