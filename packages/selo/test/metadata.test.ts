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

// France x England, 18/07/2026 21:00 UTC — a fixture 18257865, ingerida ao vivo.
const KICKOFF = Date.UTC(2026, 6, 18, 21, 0, 0);
// A estreia real do Rafy, medida no Postgres: 18/07 21:19:44 UTC, e ele ERROU.
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

test('o slug é estável e sem acento', () => {
  assert.equal(matchSlug('France', 'England', KICKOFF), 'france-england-2026-07-18');
  assert.equal(matchSlug('Espanha', 'Argentina', KICKOFF), 'espanha-argentina-2026-07-18');
  assert.equal(isoDate(KICKOFF), '2026-07-18');
});

test('os campos do design saem do metadado, e o MERCADO é o prompt do motor', () => {
  const m = buildSeloMetadata(BASE);
  assert.equal(trait(m, 'Match'), 'France x England');
  assert.equal(trait(m, 'Match date'), '2026-07-18');
  assert.equal(trait(m, 'Fan'), 'Rafy');
  // MERCADO na tela = a pergunta do Palpitei, nunca nome de mercado da TxLINE.
  assert.equal(trait(m, 'Question'), 'Sai outro escanteio em até 10 minutos?');
  assert.equal(trait(m, 'Palpite'), 'Sai');
  assert.equal(trait(m, 'Data source'), 'TxLINE (TxODDS)');
  assert.equal(trait(m, 'Transferable'), 'No');
  assert.equal(trait(m, 'Anchor program'), '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J');
});

test('o Selo diz que marca ESTREIA, e diz o instante dela', () => {
  const m = buildSeloMetadata(BASE);
  assert.equal(trait(m, 'Milestone'), 'First live palpite');
  assert.equal(trait(m, 'Placed at'), '2026-07-18T21:19Z');
});

test('NENHUM trait afirma acerto — dois dos três selos vão para palpites errados', () => {
  const m = buildSeloMetadata(BASE);
  assert.equal(trait(m, 'Outcome'), undefined, 'o trait Outcome não existe mais');
  assert.equal(trait(m, 'Result'), undefined);
  // O metadado é IDÊNTICO para quem errou e para quem acertou: o Selo não sabe,
  // não pergunta e não conta. Silêncio para o errado e alarde para o certo seria
  // a mentira que o guarda existe para impedir.
  for (const t of m.attributes) {
    assert.doesNotMatch(t.value, /\bcorrect\b|\bacerto\b|\bwon\b/i, `${t.trait_type} afirma acerto`);
  }
});

test('a descrição declara que o palpite pode ter dado errado', () => {
  const m = buildSeloMetadata(BASE);
  assert.match(m.description, /primeiro palpite/);
  assert.match(m.description, /não acerto/);
  assert.match(m.description, /pode ter dado certo ou não/);
});

test('o guarda recusa um trait de acerto reintroduzido depois', () => {
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

test('a descrição é ISENTA do guarda: ela precisa NOMEAR o acerto para negá-lo', () => {
  const m = buildSeloMetadata(BASE);
  // A própria descrição contém "não acerto"; se o guarda a varresse, o metadado
  // legítimo seria recusado por dizer a verdade.
  assert.doesNotThrow(() => assertNoCorrectnessClaim(m));
});

test('o programa da âncora acompanha o cluster — selo e âncora no mesmo lugar', () => {
  const devnet = buildSeloMetadata(BASE);
  const mainnet = buildSeloMetadata({ ...BASE, cluster: 'mainnet-beta' });
  assert.notEqual(trait(devnet, 'Anchor program'), trait(mainnet, 'Anchor program'));
  assert.equal(trait(mainnet, 'Anchor program'), '9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA');
});

test('o eventStatRoot entra quando existe e é OMITIDO quando não existe', () => {
  const sem = buildSeloMetadata(BASE);
  assert.equal(trait(sem, 'TxLINE event stat root'), undefined, 'sem root, sem trait inventado');

  // O prefixo bs58: é obrigatório: 44 chars sem rótulo são indistinguíveis de
  // hex ou base64 na tela, e o verificador precisa saber o que comparar.
  const com = buildSeloMetadata({ ...BASE, eventStatRoot: '346twX6wRXJKFaTnazGULWHsh7cmETYrZrbNfbdANghP' });
  assert.equal(
    trait(com, 'TxLINE event stat root'),
    'bs58:346twX6wRXJKFaTnazGULWHsh7cmETYrZrbNfbdANghP',
  );
});

test('sem apelido, o trait Fan some em vez de virar placeholder', () => {
  const m = buildSeloMetadata({ ...BASE, handle: undefined });
  assert.equal(trait(m, 'Fan'), undefined);
  assert.ok(m.name.includes('france-england'), 'o nome cai para o slug da partida');
});

test('a descrição amarra o selo ao DADO ancorado, não a um endosso da TxODDS', () => {
  const m = buildSeloMetadata(BASE);
  assert.match(m.description, /ancorados pela TxLINE/);
  assert.doesNotMatch(m.description, /Verificado pela TxLINE|Certificado TxLINE/);
  // A TxODDS não atestou esta NFT e não sabe que ela existe.
  assert.doesNotMatch(m.description, /verificad[oa] pel[oa]/i);
  // E não afirma um gesto que não aconteceu: no backfill quem cunha é o operador.
  assert.doesNotMatch(m.description, /cunhado pelo próprio fã/);
});

test('a copy não usa jargão de aposta nem travessão', () => {
  const m = buildSeloMetadata(BASE);
  const textos = [m.name, m.description, ...m.attributes.map((a) => `${a.trait_type} ${a.value}`)];
  for (const t of textos) {
    assert.doesNotMatch(t, /—/, `travessão em ${JSON.stringify(t)}`);
    assert.doesNotMatch(t, /\bcall\b/i, `jargão de aposta em ${JSON.stringify(t)}`);
  }
});

test('o placar, o fixture_id e o seq resolvedor NÃO estão no metadado', () => {
  const m = buildSeloMetadata(BASE);
  const bruto = JSON.stringify(m);
  assert.doesNotMatch(bruto, /18257865/, 'fixture_id fica de fora: a âncora é por DIA');
  assert.doesNotMatch(bruto, /resolved_by_seq|resolvedBySeq/);
  assert.equal(trait(m, 'Score'), undefined, 'o badge descreve o palpite, nunca a partida');
});

test('o guarda recusa statToProve e summary — o dado licenciado em si', () => {
  const m = buildSeloMetadata(BASE);
  assert.throws(
    () => assertNoLicensedData({ ...m, statToProve: 'Goals=2' }),
    /METADADO BLOQUEADO.*statToProve/s,
  );
  assert.throws(() => assertNoLicensedData({ ...m, summary: {} }), /summary/);
});

test('o guarda recusa os caminhos de prova, em qualquer profundidade', () => {
  const m = buildSeloMetadata(BASE);
  for (const campo of ['statProof', 'subTreeProof', 'mainTreeProof']) {
    assert.throws(
      () => assertNoLicensedData({ ...m, properties: { files: [], extra: { [campo]: ['a'] } } }),
      new RegExp(campo),
      `${campo} tinha que ser recusado mesmo aninhado`,
    );
  }
});

test('o guarda recusa um trait que NOMEIA campo proibido, não só a chave', () => {
  const m = buildSeloMetadata(BASE);
  const contaminado = {
    ...m,
    attributes: [...m.attributes, { trait_type: 'statToProve', value: 'qualquer coisa' }],
  };
  assert.throws(() => assertNoLicensedData(contaminado), /statToProve/);
});

test('o guarda recusa odds, Pct e as linhas de pré-jogo', () => {
  const m = buildSeloMetadata(BASE);
  assert.throws(() => assertNoLicensedData({ ...m, Pct: 31.2 }), /Pct/);
  assert.throws(() => assertNoLicensedData({ ...m, odds: [] }), /odds/);
  assert.throws(() => assertNoLicensedData({ ...m, goalsLine: 2.5 }), /goalsLine/);
});

test('o nome do arquivo é por FÃ: dois fãs na MESMA pergunta não colidem', () => {
  // Medido no dry run: Rafy e Kauã estrearam na mesma pergunta. Chaveado por
  // pergunta, o segundo arquivo sobrescrevia o primeiro e os dois assets
  // apontavam para um documento que nomeava só um deles. Permanente, na cadeia.
  const slug = 'france-england-2026-07-18';
  assert.notEqual(metadataFileName(slug, 'Rafy'), metadataFileName(slug, 'Kauã'));
  assert.equal(metadataFileName(slug, 'Rafy'), 'france-england-2026-07-18-rafy.json');
  // Acento vira ascii; nada fora de [a-z0-9_-] sobrevive até a URL.
  assert.equal(metadataFileName(slug, 'Kauã'), 'france-england-2026-07-18-kaua.json');
  assert.doesNotMatch(metadataFileName('s', 'a b/c?d#e:f'), /[ /?#:]/);
});
