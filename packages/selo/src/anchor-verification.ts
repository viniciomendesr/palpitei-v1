/**
 * Verifying an `eventStatRoot` against the root TxODDS anchors on Solana.
 *
 * The point of this module is that the badge must not CLAIM anchoring it has
 * not checked. Embedding a value fetched from an API and labelling it "TxLINE
 * anchor" would be a provenance claim we did not earn, on a permanent artifact.
 *
 * THE WIRE FORMAT IS UNDOCUMENTED. What follows was established empirically
 * against devnet and the production TxLINE API, and nothing here is a guess:
 *
 *   1. `eventStatRoot` is NOT a string. It is 32 bytes serialized as an object
 *      with numeric keys "0".."31". A guard expecting a string discards it every
 *      single time.
 *   2. The hash scheme is sha256, folded as
 *      `isRightSibling ? H(acc || sibling) : H(sibling || acc)`. Folding
 *      `eventStatRoot` with `subTreeProof` this way reproduces
 *      `summary.eventStatsSubTreeRoot` byte for byte; keccak256 and the
 *      opposite ordering do not.
 *   3. The anchor account derived from the PROOF's `ts` really is the day's
 *      account: it exists, its owner is the TxLINE validation program, and its
 *      own `u64` at offset 8 equals the epoch day derived from that `ts`.
 *   4. Its layout is an 8-byte discriminator, that `u64` day, then 288 slots of
 *      32 bytes (the 5-minute buckets of a day), of which 36 were non-zero.
 *
 * WHAT COULD NOT BE CLOSED: folding `subTreeProof` then `mainTreeProof` yields a
 * root that appears in NO slot of the day account, nor of `daily_batch_roots`.
 * `mainTreeProof` carries a single sibling, so it reaches the root of a two-leaf
 * subtree, not the aggregate the account stores. Closing that last hop is what
 * the program's own `validateStat` instruction does, and replicating it off
 * chain would mean guessing at an undocumented layout. So this module verifies
 * the two layers it can prove and FAILS CLOSED on the third.
 */

import { createHash } from 'node:crypto';

/** One sibling on the path from a leaf to its root. */
export type ProofNode = { hash: Uint8Array; isRightSibling: boolean };

export const ROOT_BYTES = 32;

/**
 * Decodes the 32-byte hash TxLINE serializes as `{ "0": n, … "31": n }`.
 *
 * Strict on purpose: a short array, a missing index or a value outside 0-255
 * means we did not understand the payload, and a misunderstood payload must not
 * reach permanent metadata. Returns null rather than throwing, because "could
 * not read it" is an expected outcome the caller handles by omitting a trait.
 */
export function decodeHash32(value: unknown): Uint8Array | null {
  if (value == null || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const bytes = new Uint8Array(ROOT_BYTES);
  for (let i = 0; i < ROOT_BYTES; i++) {
    const raw = Array.isArray(value) ? (value as unknown[])[i] : source[String(i)];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 255) return null;
    bytes[i] = raw;
  }
  // A longer array means a different shape than the one measured; do not guess.
  if (Array.isArray(value) && value.length !== ROOT_BYTES) return null;
  return bytes;
}

/** Decodes a `[{ hash, isRightSibling }]` proof path. Null if any node is unreadable. */
export function decodeProofPath(value: unknown): ProofNode[] | null {
  if (!Array.isArray(value)) return null;
  const path: ProofNode[] = [];
  for (const node of value) {
    if (node == null || typeof node !== 'object') return null;
    const hash = decodeHash32((node as { hash?: unknown }).hash);
    if (!hash) return null;
    path.push({ hash, isRightSibling: Boolean((node as { isRightSibling?: unknown }).isRightSibling) });
  }
  return path;
}

const sha256 = (input: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha256').update(input).digest());

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

/**
 * Folds a leaf up its proof path to the root it implies.
 *
 * `isRightSibling` describes the SIBLING, so a right sibling is appended and a
 * left sibling is prepended. Getting this backwards still produces a valid
 * looking 32-byte hash that matches nothing, which is why it is pinned by a test
 * against a real TxLINE response instead of by reasoning.
 */
export function foldProof(leaf: Uint8Array, path: ProofNode[]): Uint8Array {
  return path.reduce(
    (acc, node) => sha256(node.isRightSibling ? concat(acc, node.hash) : concat(node.hash, acc)),
    leaf,
  );
}

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/** Offset 0-7 discriminator, 8-15 the epoch day, then the 32-byte root slots. */
export const ANCHOR_HEADER_BYTES = 16;

/** Reads the epoch day the anchor account reports for itself. */
export function anchorAccountEpochDay(data: Uint8Array): number | null {
  if (data.length < ANCHOR_HEADER_BYTES) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const day = view.getBigUint64(8, true);
  return day > 0xffffn ? null : Number(day);
}

/** Every non-zero 32-byte slot the day account holds. */
export function anchorAccountRoots(data: Uint8Array): Uint8Array[] {
  const roots: Uint8Array[] = [];
  for (let offset = ANCHOR_HEADER_BYTES; offset + ROOT_BYTES <= data.length; offset += ROOT_BYTES) {
    const slot = data.subarray(offset, offset + ROOT_BYTES);
    if (slot.some((byte) => byte !== 0)) roots.push(slot);
  }
  return roots;
}

export type AnchorVerification =
  | { verified: true; root: Uint8Array; subTreeRoot: Uint8Array }
  | { verified: false; reason: string };

/**
 * Checks an `eventStatRoot` as far as the published data allows.
 *
 * Layer 1 (PROVEN here): the root folds through `subTreeProof` into the
 * `eventStatsSubTreeRoot` TxLINE itself reports. That is a real cryptographic
 * check: it confirms the root we decoded is the one their own summary commits
 * to, and it confirms the hash scheme.
 *
 * Layer 2 (PROVEN here): the anchor account exists, is owned by the validation
 * program, and reports the same epoch day we derived from the proof timestamp.
 *
 * Layer 3 (NOT PROVEN, and the reason this can return `verified: false`):
 * reaching an anchored slot from the subtree root. See the module doc.
 */
export function verifyEventStatRoot(input: {
  eventStatRoot: unknown;
  subTreeProof: unknown;
  mainTreeProof: unknown;
  /** `summary.eventStatsSubTreeRoot`, used ONLY as a local check target. */
  eventStatsSubTreeRoot: unknown;
  /** Raw bytes of the anchor account, or null when it could not be read. */
  anchorAccountData: Uint8Array | null;
  /** Epoch day derived from the proof `ts`, never from the wall clock. */
  expectedEpochDay: number;
}): AnchorVerification {
  const root = decodeHash32(input.eventStatRoot);
  if (!root) return { verified: false, reason: 'eventStatRoot ilegível (esperado 32 bytes em chaves "0".."31")' };

  const subTreeProof = decodeProofPath(input.subTreeProof);
  if (!subTreeProof) return { verified: false, reason: 'subTreeProof ilegível' };

  const expectedSubTreeRoot = decodeHash32(input.eventStatsSubTreeRoot);
  if (!expectedSubTreeRoot) return { verified: false, reason: 'summary.eventStatsSubTreeRoot ilegível' };

  const subTreeRoot = foldProof(root, subTreeProof);
  if (!bytesEqual(subTreeRoot, expectedSubTreeRoot)) {
    return { verified: false, reason: 'o eventStatRoot NÃO fecha com o eventStatsSubTreeRoot da própria TxLINE' };
  }

  if (!input.anchorAccountData) {
    return { verified: false, reason: 'a conta da âncora não pôde ser lida na devnet' };
  }
  const accountDay = anchorAccountEpochDay(input.anchorAccountData);
  if (accountDay !== input.expectedEpochDay) {
    return {
      verified: false,
      reason: `a conta da âncora diz epoch day ${accountDay}, e a prova diz ${input.expectedEpochDay}`,
    };
  }

  const mainTreeProof = decodeProofPath(input.mainTreeProof);
  if (!mainTreeProof) return { verified: false, reason: 'mainTreeProof ilegível' };

  const mainRoot = foldProof(subTreeRoot, mainTreeProof);
  const anchored = anchorAccountRoots(input.anchorAccountData);
  if (!anchored.some((slot) => bytesEqual(slot, mainRoot))) {
    return {
      verified: false,
      reason:
        `o mainTreeProof não alcança nenhum dos ${anchored.length} roots ancorados na conta do dia. ` +
        `Ele traz 1 irmão, então para na raiz de uma subárvore de 2 folhas, e o último salto até o ` +
        `agregado é o que a instrução validateStat do programa faz on-chain. Fechar isso off-chain ` +
        `exigiria adivinhar layout não documentado`,
    };
  }
  return { verified: true, root, subTreeRoot };
}
