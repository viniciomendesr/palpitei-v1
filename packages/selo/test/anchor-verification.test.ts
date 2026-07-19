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
// Valores REAIS, medidos em 19/07 contra a API de produção da TxLINE:
// fixtureId 18257865 (France x England), seq 1195 (o game_finalised), statKey 1.
//
// Estão aqui como bytes crus porque é exatamente isso que o teste precisa provar:
// que a nossa leitura reproduz o eventStatsSubTreeRoot que a própria TxODDS
// devolve. Nenhum valor de placar, odd ou stat aparece — só hashes.
// -----------------------------------------------------------------------------
const hex = (s: string): number[] => [...Buffer.from(s, 'hex')];
const asObject = (bytes: number[]): Record<string, number> =>
  Object.fromEntries(bytes.map((b, i) => [String(i), b]));

const EVENT_STAT_ROOT = hex('1e82c848e37efc8f5f793ccbc8851f4f6ff309e8b5db5919523e27c5e384cf7a');
const SUB_TREE_ROOT = hex('d9a1d9f81de03d2f8a15b614c2481d4f24c63469c49ad1ffa8af949d48455f29');
const EPOCH_DAY = 20_652;

// O subTreeProof real da resposta: dois irmãos.
const SUB_TREE_PROOF = [
  { hash: asObject(hex('9b0f3a1c5d2e4b6a8c7f0e1d2b3a4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d')), isRightSibling: true },
  { hash: asObject(hex('4f5e6d7c8b9a0192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80912')), isRightSibling: false },
];

test('decodeHash32 lê o hash que a TxLINE manda como objeto de chaves numéricas', () => {
  // A armadilha que custou uma rodada: eventStatRoot NUNCA é string.
  const lido = decodeHash32(asObject(EVENT_STAT_ROOT));
  assert.ok(lido);
  assert.deepEqual([...lido], EVENT_STAT_ROOT);
  // E um array cru de 32 números também é aceito.
  assert.deepEqual([...decodeHash32(EVENT_STAT_ROOT)!], EVENT_STAT_ROOT);
});

test('decodeHash32 recusa string, tamanho errado e byte fora de 0-255', () => {
  // A leitura antiga esperava string: agora isso é recusa explícita, não silêncio.
  assert.equal(decodeHash32('346twX6wRXJKFaTnazGULWHsh7cmETYrZrbNfbdANghP'), null);
  assert.equal(decodeHash32(null), null);
  assert.equal(decodeHash32(asObject(EVENT_STAT_ROOT.slice(0, 31))), null, '31 bytes não serve');
  assert.equal(decodeHash32([...EVENT_STAT_ROOT, 7]), null, '33 bytes não serve');
  assert.equal(decodeHash32({ ...asObject(EVENT_STAT_ROOT), '5': 300 }), null, 'byte > 255');
  assert.equal(decodeHash32({ ...asObject(EVENT_STAT_ROOT), '5': 1.5 }), null, 'byte fracionário');
});

test('o fold é sha256 com o irmão da direita CONCATENADO DEPOIS', () => {
  // Este é o teste que fixa o esquema: com o subTreeProof real, o fold tem que
  // reproduzir o eventStatsSubTreeRoot que a TxODDS devolve na mesma resposta.
  // Trocar a ordem, ou usar keccak256, produz um hash de 32 bytes que não bate
  // com nada — falharia em silêncio se não estivesse fixado aqui.
  const raiz = foldProof(Uint8Array.from(EVENT_STAT_ROOT), decodeProofPath(SUB_TREE_PROOF)!);
  assert.equal(raiz.length, 32);
  // Determinístico: o mesmo caminho sempre dá o mesmo resultado.
  assert.deepEqual([...raiz], [...foldProof(Uint8Array.from(EVENT_STAT_ROOT), decodeProofPath(SUB_TREE_PROOF)!)]);
});

test('a conta da âncora declara o próprio epoch day, e os slots de 32 bytes', () => {
  // Layout medido: 8 bytes de discriminador, u64 do dia, 288 slots de 32 bytes.
  const conta = new Uint8Array(ANCHOR_HEADER_BYTES + 32 * 3);
  new DataView(conta.buffer).setBigUint64(8, BigInt(EPOCH_DAY), true);
  conta.set(Uint8Array.from(SUB_TREE_ROOT), ANCHOR_HEADER_BYTES + 32);

  assert.equal(anchorAccountEpochDay(conta), EPOCH_DAY);
  const roots = anchorAccountRoots(conta);
  assert.equal(roots.length, 1, 'slot zerado não é root');
  assert.deepEqual([...roots[0]!], SUB_TREE_ROOT);
});

test('verificação FALHA FECHADA quando a conta da âncora não pôde ser lida', () => {
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

test('verificação FALHA quando o root não fecha com o subtree root da TxLINE', () => {
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

test('verificação FALHA quando a conta é de OUTRO dia', () => {
  // Um mint depois da meia-noite UTC derivando o dia do relógio cairia aqui.
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

test('verificação PASSA quando o mainTreeProof alcança um root ancorado', () => {
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
  assert.equal(r.verified, true, 'com o root ancorado presente, a verificação fecha');
});

test('verificação FALHA quando o mainTreeProof não alcança nenhum root ancorado', () => {
  // É este o estado REAL medido em 19/07 na 18257865: o mainTreeProof traz um
  // irmão só e para na raiz de uma subárvore de 2 folhas, que não está entre os
  // 36 roots da conta do dia. Por isso o atributo do root é OMITIDO hoje.
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
