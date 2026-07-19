import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERKS,
  canAfford,
  canOpenDetail,
  perkById,
  perksInCategory,
  shortAddress,
  showsFeaturedCard,
  storeMode,
  walletChip,
} from '../src/lib/marketplace.ts';

test('a loja completa só existe no modo demo', () => {
  assert.equal(storeMode(true), 'full');
  assert.equal(storeMode(false), 'soon');
});

test('as telas de detalhe são inertes para o fã real', () => {
  assert.equal(canOpenDetail(true), true);
  assert.equal(canOpenDetail(false), false);
});

test('a vitrine mostra o card de destaque e nenhum perk aparece duas vezes', () => {
  assert.equal(showsFeaturedCard('featured'), true);
  assert.equal(showsFeaturedCard('identity'), false);

  const vitrine = perksInCategory('featured');
  assert.ok(!vitrine.some((p) => p.featured), 'o perk em destaque não repete na grade');
  assert.equal(vitrine.length, PERKS.length - 1);
});

test('cada categoria devolve só os seus perks', () => {
  assert.deepEqual(
    perksInCategory('partners').map((p) => p.id),
    ['ticket', 'discount', 'product'],
  );
  assert.deepEqual(perksInCategory('game').map((p) => p.id), ['markets']);
});

test('o catálogo tem ids únicos e um único destaque', () => {
  const ids = PERKS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(PERKS.filter((p) => p.featured).length, 1);
  assert.equal(perkById('poc')?.currency, 'trophy');
  assert.equal(perkById('inexistente'), null);
});

test('preço em Troféu não pode ser pago com XP', () => {
  const poc = perkById('poc')!;
  const markets = perkById('markets')!;

  assert.equal(canAfford(poc, { xp: 999_999, trophies: 0 }), false);
  assert.equal(canAfford(poc, { xp: 0, trophies: 1 }), true);
  assert.equal(canAfford(markets, { xp: 800, trophies: 0 }), true);
  assert.equal(canAfford(markets, { xp: 799, trophies: 99 }), false);
});

test('o endereço encurta pelas pontas e endereço curto fica inteiro', () => {
  assert.equal(shortAddress('7xKqAAAAAAAAAAAA9fPz'), '7xKq…9fPz');
  assert.equal(shortAddress('abc'), 'abc');
});

test('o chip da carteira nunca inventa endereço', () => {
  assert.deepEqual(walletChip({ isDemo: true, address: null }), { kind: 'demo', address: null });
  // Mesmo com carteira, o demo não exibe endereço: a conta é local e simulada.
  assert.deepEqual(walletChip({ isDemo: true, address: '7xKqAAAAAAAAAAAA9fPz' }), {
    kind: 'demo',
    address: null,
  });
  assert.deepEqual(walletChip({ isDemo: false, address: '   ' }), { kind: 'pending', address: null });
  assert.deepEqual(walletChip({ isDemo: false, address: '7xKqAAAAAAAAAAAA9fPz' }), {
    kind: 'address',
    address: '7xKq…9fPz',
  });
});
