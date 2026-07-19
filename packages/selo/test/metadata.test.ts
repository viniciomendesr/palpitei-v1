import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoCorrectnessClaim,
  assertNoLicensedData,
  buildSeloMetadata,
  isoDate,
  matchSlug,
  metadataFileName,
} from '../src/metadata.ts';
import type { SeloMetadataInput } from '../src/metadata.ts';

// France x England, 18/07/2026 21:00 UTC — fixture 18257865, ingested live.
const KICKOFF = Date.UTC(2026, 6, 18, 21, 0, 0);
// Rafy's real debut, measured in Postgres: 18/07 21:19:44 UTC, and he got it WRONG.
const ESTREIA = Date.UTC(2026, 6, 18, 21, 19, 44);

const BASE: SeloMetadataInput = {
  handle: 'Rafy',
  p1: 'France',
  p2: 'England',
  startTime: KICKOFF,
  prompt: 'Sai outro escanteio em até 10 minutos?',
  choiceLabel: 'Sai',
  placedAt: ESTREIA,
  cluster: 'devnet',
  anchorPda: 'Anchor11111111111111111111111111111111111111',
  baseUrl: 'https://palpitei-v1-production.up.railway.app',
};

const trait = (m: { attributes: { trait_type: string; value: string }[] }, nome: string) =>
  m.attributes.find((a) => a.trait_type === nome)?.value;

test('the slug is stable and unaccented', () => {
  assert.equal(matchSlug('France', 'England', KICKOFF), 'france-england-2026-07-18');
  assert.equal(matchSlug('Espanha', 'Argentina', KICKOFF), 'espanha-argentina-2026-07-18');
  assert.equal(isoDate(KICKOFF), '2026-07-18');
});

test('the design fields come from the metadata, and the MARKET is the engine prompt', () => {
  const m = buildSeloMetadata(BASE);
  assert.equal(trait(m, 'Match'), 'France x England');
  assert.equal(trait(m, 'Match date'), '2026-07-18');
  assert.equal(trait(m, 'Fan'), 'Rafy');
  // MARKET on screen = the Palpitei question, never a TxLINE market name.
  assert.equal(trait(m, 'Question'), 'Sai outro escanteio em até 10 minutos?');
  assert.equal(trait(m, 'Palpite'), 'Sai');
  assert.equal(trait(m, 'Data source'), 'TxLINE (TxODDS)');
  assert.equal(trait(m, 'Transferable'), 'No');
  assert.equal(trait(m, 'Anchor program'), '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J');
});

test('the Selo says it marks a DEBUT, and says the instant of it', () => {
  const m = buildSeloMetadata(BASE);
  assert.equal(trait(m, 'Milestone'), 'First live palpite');
  assert.equal(trait(m, 'Placed at'), '2026-07-18T21:19Z');
});

test('NO trait claims a correct answer — two of the three selos go to wrong palpites', () => {
  const m = buildSeloMetadata(BASE);
  assert.equal(trait(m, 'Outcome'), undefined, 'the Outcome trait no longer exists');
  assert.equal(trait(m, 'Result'), undefined);
  // The metadata is IDENTICAL for whoever got it wrong and whoever got it right: the
  // Selo does not know, does not ask and does not tell. Silence for the wrong one and
  // fanfare for the right one would be the lie the guard exists to prevent.
  for (const t of m.attributes) {
    assert.doesNotMatch(t.value, /\bcorrect\b|\bacerto\b|\bwon\b/i, `${t.trait_type} claims a correct answer`);
  }
});

test('the description states that the palpite may have gone wrong', () => {
  const m = buildSeloMetadata(BASE);
  assert.match(m.description, /primeiro palpite/);
  assert.match(m.description, /não acerto/);
  assert.match(m.description, /pode ter dado certo ou não/);
});

test('the guard refuses a correctness trait reintroduced later', () => {
  const m = buildSeloMetadata(BASE);
  assert.throws(
    () => assertNoCorrectnessClaim({ ...m, attributes: [...m.attributes, { trait_type: 'Outcome', value: 'Correct' }] }),
    /marca ESTREIA, não acerto/,
  );
  assert.throws(() => assertNoCorrectnessClaim({ ...m, result: 'won' }), /ESTREIA/);
  assert.throws(
    () => assertNoCorrectnessClaim({ ...m, attributes: [{ trait_type: 'Resultado', value: 'acertou' }] }),
    /ESTREIA/,
  );
});

test('the description is EXEMPT from the guard: it must NAME correctness to deny it', () => {
  const m = buildSeloMetadata(BASE);
  // The description itself contains "não acerto"; if the guard swept it, legitimate
  // metadata would be refused for telling the truth.
  assert.doesNotThrow(() => assertNoCorrectnessClaim(m));
});

test('the anchor program follows the cluster — selo and anchor in the same place', () => {
  const devnet = buildSeloMetadata(BASE);
  const mainnet = buildSeloMetadata({ ...BASE, cluster: 'mainnet-beta' });
  assert.notEqual(trait(devnet, 'Anchor program'), trait(mainnet, 'Anchor program'));
  assert.equal(trait(mainnet, 'Anchor program'), '9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA');
});

test('the eventStatRoot goes in when it exists and is OMITTED when it does not', () => {
  const sem = buildSeloMetadata(BASE);
  assert.equal(trait(sem, 'TxLINE event stat root'), undefined, 'no root, no invented trait');

  // The bs58: prefix is mandatory: 44 unlabelled chars are indistinguishable from
  // hex or base64 on screen, and the verifier needs to know what to compare.
  const com = buildSeloMetadata({ ...BASE, eventStatRoot: '346twX6wRXJKFaTnazGULWHsh7cmETYrZrbNfbdANghP' });
  assert.equal(
    trait(com, 'TxLINE event stat root'),
    'bs58:346twX6wRXJKFaTnazGULWHsh7cmETYrZrbNfbdANghP',
  );
});

test('with no nickname, the Fan trait disappears instead of becoming a placeholder', () => {
  const m = buildSeloMetadata({ ...BASE, handle: undefined });
  assert.equal(trait(m, 'Fan'), undefined);
  assert.ok(m.name.includes('france-england'), 'the name falls back to the match slug');
});

test('the description ties the selo to the ANCHORED data, not to a TxODDS endorsement', () => {
  const m = buildSeloMetadata(BASE);
  assert.match(m.description, /ancorados pela TxLINE/);
  assert.doesNotMatch(m.description, /Verificado pela TxLINE|Certificado TxLINE/);
  // TxODDS did not attest this NFT and does not know it exists.
  assert.doesNotMatch(m.description, /verificad[oa] pel[oa]/i);
  // And it claims no gesture that did not happen: in the backfill the operator mints.
  assert.doesNotMatch(m.description, /cunhado pelo próprio fã/);
});

test('the copy uses no betting jargon and no em dash', () => {
  const m = buildSeloMetadata(BASE);
  const textos = [m.name, m.description, ...m.attributes.map((a) => `${a.trait_type} ${a.value}`)];
  for (const t of textos) {
    assert.doesNotMatch(t, /—/, `em dash in ${JSON.stringify(t)}`);
    assert.doesNotMatch(t, /\bcall\b/i, `betting jargon in ${JSON.stringify(t)}`);
  }
});

test('the score, the fixture_id and the resolving seq are NOT in the metadata', () => {
  const m = buildSeloMetadata(BASE);
  const bruto = JSON.stringify(m);
  assert.doesNotMatch(bruto, /18257865/, 'fixture_id stays out: the anchor is per DAY');
  assert.doesNotMatch(bruto, /resolved_by_seq|resolvedBySeq/);
  assert.equal(trait(m, 'Score'), undefined, 'the badge describes the palpite, never the match');
});

test('the guard refuses statToProve and summary — the licensed data itself', () => {
  const m = buildSeloMetadata(BASE);
  assert.throws(
    () => assertNoLicensedData({ ...m, statToProve: 'Goals=2' }),
    /METADADO BLOQUEADO.*statToProve/s,
  );
  assert.throws(() => assertNoLicensedData({ ...m, summary: {} }), /summary/);
});

test('the guard refuses the proof paths, at any depth', () => {
  const m = buildSeloMetadata(BASE);
  for (const campo of ['statProof', 'subTreeProof', 'mainTreeProof']) {
    assert.throws(
      () => assertNoLicensedData({ ...m, properties: { files: [], extra: { [campo]: ['a'] } } }),
      new RegExp(campo),
      `${campo} had to be refused even when nested`,
    );
  }
});

test('the guard refuses a trait that NAMES a forbidden field, not just the key', () => {
  const m = buildSeloMetadata(BASE);
  const contaminado = {
    ...m,
    attributes: [...m.attributes, { trait_type: 'statToProve', value: 'qualquer coisa' }],
  };
  assert.throws(() => assertNoLicensedData(contaminado), /statToProve/);
});

test('the guard refuses odds, Pct and the pre-match lines', () => {
  const m = buildSeloMetadata(BASE);
  assert.throws(() => assertNoLicensedData({ ...m, Pct: 31.2 }), /Pct/);
  assert.throws(() => assertNoLicensedData({ ...m, odds: [] }), /odds/);
  assert.throws(() => assertNoLicensedData({ ...m, goalsLine: 2.5 }), /goalsLine/);
});

test('the file name is per FAN: two fans on the SAME question do not collide', () => {
  // Measured in the dry run: Rafy and Kauã debuted on the same question. Keyed by
  // question, the second file overwrote the first and both assets pointed at a
  // document naming only one of them. Permanent, on chain.
  const slug = 'france-england-2026-07-18';
  assert.notEqual(metadataFileName(slug, 'Rafy'), metadataFileName(slug, 'Kauã'));
  assert.equal(metadataFileName(slug, 'Rafy'), 'france-england-2026-07-18-rafy.json');
  // Accents become ascii; nothing outside [a-z0-9_-] survives into the URL.
  assert.equal(metadataFileName(slug, 'Kauã'), 'france-england-2026-07-18-kaua.json');
  assert.doesNotMatch(metadataFileName('s', 'a b/c?d#e:f'), /[ /?#:]/);
});
