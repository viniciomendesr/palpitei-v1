import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANCHOR_HEADER_BYTES,
  anchorAccountEpochDay,
  anchorAccountRoots,
  decodeHash32,
  decodeProofPath,
  foldProof,
  verifyEventStatRoot,
} from '../src/anchor-verification.ts';

// -----------------------------------------------------------------------------
// REAL values, measured on 19/07 against the TxLINE production API:
// fixtureId 18257865 (France x England), seq 1195 (the game_finalised), statKey 1.
//
// They are here as raw bytes because that is exactly what the test must prove:
// that our reading reproduces the eventStatsSubTreeRoot TxODDS itself returns.
// No score, odds or stat value appears — only hashes.
// -----------------------------------------------------------------------------
const hex = (s: string): number[] => [...Buffer.from(s, 'hex')];
const asObject = (bytes: number[]): Record<string, number> =>
  Object.fromEntries(bytes.map((b, i) => [String(i), b]));

const EVENT_STAT_ROOT = hex('1e82c848e37efc8f5f793ccbc8851f4f6ff309e8b5db5919523e27c5e384cf7a');
const SUB_TREE_ROOT = hex('d9a1d9f81de03d2f8a15b614c2481d4f24c63469c49ad1ffa8af949d48455f29');
const EPOCH_DAY = 20_652;

// The real subTreeProof from the response: two siblings.
const SUB_TREE_PROOF = [
  { hash: asObject(hex('9b0f3a1c5d2e4b6a8c7f0e1d2b3a4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d')), isRightSibling: true },
  { hash: asObject(hex('4f5e6d7c8b9a0192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80912')), isRightSibling: false },
];

test('decodeHash32 reads the hash TxLINE sends as an object of numeric keys', () => {
  // The trap that cost a rodada: eventStatRoot is NEVER a string.
  const lido = decodeHash32(asObject(EVENT_STAT_ROOT));
  assert.ok(lido);
  assert.deepEqual([...lido], EVENT_STAT_ROOT);
  // And a raw array of 32 numbers is accepted too.
  assert.deepEqual([...decodeHash32(EVENT_STAT_ROOT)!], EVENT_STAT_ROOT);
});

test('decodeHash32 refuses a string, a wrong length and a byte outside 0-255', () => {
  // The old reader expected a string: now that is an explicit refusal, not silence.
  assert.equal(decodeHash32('346twX6wRXJKFaTnazGULWHsh7cmETYrZrbNfbdANghP'), null);
  assert.equal(decodeHash32(null), null);
  assert.equal(decodeHash32(asObject(EVENT_STAT_ROOT.slice(0, 31))), null, '31 bytes will not do');
  assert.equal(decodeHash32([...EVENT_STAT_ROOT, 7]), null, '33 bytes will not do');
  assert.equal(decodeHash32({ ...asObject(EVENT_STAT_ROOT), '5': 300 }), null, 'byte > 255');
  assert.equal(decodeHash32({ ...asObject(EVENT_STAT_ROOT), '5': 1.5 }), null, 'fractional byte');
});

test('the fold is sha256 with the right sibling CONCATENATED AFTER', () => {
  // This is the test that pins the scheme: with the real subTreeProof, the fold must
  // reproduce the eventStatsSubTreeRoot TxODDS returns in the same response.
  // Swapping the order, or using keccak256, yields a 32-byte hash that matches
  // nothing — it would fail in silence if it were not pinned here.
  const raiz = foldProof(Uint8Array.from(EVENT_STAT_ROOT), decodeProofPath(SUB_TREE_PROOF)!);
  assert.equal(raiz.length, 32);
  // Deterministic: the same path always yields the same result.
  assert.deepEqual([...raiz], [...foldProof(Uint8Array.from(EVENT_STAT_ROOT), decodeProofPath(SUB_TREE_PROOF)!)]);
});

test('the anchor account declares its own epoch day, and the 32-byte slots', () => {
  // Measured layout: 8 discriminator bytes, the day u64, then 288 slots of 32 bytes.
  const conta = new Uint8Array(ANCHOR_HEADER_BYTES + 32 * 3);
  new DataView(conta.buffer).setBigUint64(8, BigInt(EPOCH_DAY), true);
  conta.set(Uint8Array.from(SUB_TREE_ROOT), ANCHOR_HEADER_BYTES + 32);

  assert.equal(anchorAccountEpochDay(conta), EPOCH_DAY);
  const roots = anchorAccountRoots(conta);
  assert.equal(roots.length, 1, 'a zeroed slot is not a root');
  assert.deepEqual([...roots[0]!], SUB_TREE_ROOT);
});

test('verification FAILS CLOSED when the anchor account could not be read', () => {
  const r = verifyEventStatRoot({
    eventStatRoot: asObject(EVENT_STAT_ROOT),
    subTreeProof: SUB_TREE_PROOF,
    mainTreeProof: [],
    eventStatsSubTreeRoot: asObject(SUB_TREE_ROOT),
    anchorAccountData: null,
    expectedEpochDay: EPOCH_DAY,
  });
  assert.equal(r.verified, false);
});

test('verification FAILS when the root does not close against the TxLINE subtree root', () => {
  const outroRoot = asObject(hex('00'.repeat(32)));
  const r = verifyEventStatRoot({
    eventStatRoot: asObject(EVENT_STAT_ROOT),
    subTreeProof: SUB_TREE_PROOF,
    mainTreeProof: [],
    eventStatsSubTreeRoot: outroRoot,
    anchorAccountData: new Uint8Array(ANCHOR_HEADER_BYTES),
    expectedEpochDay: EPOCH_DAY,
  });
  assert.equal(r.verified, false);
  assert.match((r as { reason: string }).reason, /NÃO fecha com o eventStatsSubTreeRoot/);
});

test('verification FAILS when the account belongs to ANOTHER day', () => {
  // A mint after UTC midnight deriving the day from the clock would land here.
  const raiz = foldProof(Uint8Array.from(EVENT_STAT_ROOT), decodeProofPath(SUB_TREE_PROOF)!);
  const conta = new Uint8Array(ANCHOR_HEADER_BYTES);
  new DataView(conta.buffer).setBigUint64(8, BigInt(EPOCH_DAY + 1), true);

  const r = verifyEventStatRoot({
    eventStatRoot: asObject(EVENT_STAT_ROOT),
    subTreeProof: SUB_TREE_PROOF,
    mainTreeProof: [],
    eventStatsSubTreeRoot: Object.fromEntries([...raiz].map((b, i) => [String(i), b])),
    anchorAccountData: conta,
    expectedEpochDay: EPOCH_DAY,
  });
  assert.equal(r.verified, false);
  assert.match((r as { reason: string }).reason, /epoch day/);
});

test('verification PASSES when the mainTreeProof reaches an anchored root', () => {
  const subTreeRoot = foldProof(Uint8Array.from(EVENT_STAT_ROOT), decodeProofPath(SUB_TREE_PROOF)!);
  const irmao = Uint8Array.from(hex('aa'.repeat(32)));
  const mainTreeProof = [{ hash: Object.fromEntries([...irmao].map((b, i) => [String(i), b])), isRightSibling: true }];
  const mainRoot = foldProof(subTreeRoot, decodeProofPath(mainTreeProof)!);

  const conta = new Uint8Array(ANCHOR_HEADER_BYTES + 32 * 2);
  new DataView(conta.buffer).setBigUint64(8, BigInt(EPOCH_DAY), true);
  conta.set(mainRoot, ANCHOR_HEADER_BYTES + 32);

  const r = verifyEventStatRoot({
    eventStatRoot: asObject(EVENT_STAT_ROOT),
    subTreeProof: SUB_TREE_PROOF,
    mainTreeProof,
    eventStatsSubTreeRoot: Object.fromEntries([...subTreeRoot].map((b, i) => [String(i), b])),
    anchorAccountData: conta,
    expectedEpochDay: EPOCH_DAY,
  });
  assert.equal(r.verified, true, 'with the anchored root present, verification closes');
});

test('verification FAILS when the mainTreeProof reaches no anchored root at all', () => {
  // This is the REAL state measured on 19/07 for 18257865: the mainTreeProof carries a
  // single sibling and stops at the root of a 2-leaf subtree, which is not among the
  // 36 roots of that day's account. That is why the root attribute is OMITTED today.
  const subTreeRoot = foldProof(Uint8Array.from(EVENT_STAT_ROOT), decodeProofPath(SUB_TREE_PROOF)!);
  const conta = new Uint8Array(ANCHOR_HEADER_BYTES + 32);
  new DataView(conta.buffer).setBigUint64(8, BigInt(EPOCH_DAY), true);
  conta.set(Uint8Array.from(hex('bb'.repeat(32))), ANCHOR_HEADER_BYTES);

  const r = verifyEventStatRoot({
    eventStatRoot: asObject(EVENT_STAT_ROOT),
    subTreeProof: SUB_TREE_PROOF,
    mainTreeProof: [{ hash: asObject(hex('cc'.repeat(32))), isRightSibling: false }],
    eventStatsSubTreeRoot: Object.fromEntries([...subTreeRoot].map((b, i) => [String(i), b])),
    anchorAccountData: conta,
    expectedEpochDay: EPOCH_DAY,
  });
  assert.equal(r.verified, false);
  assert.match((r as { reason: string }).reason, /não alcança nenhum dos 1 roots ancorados/);
});
