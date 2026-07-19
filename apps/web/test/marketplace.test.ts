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

test('the full store only exists in demo mode', () => {
  assert.equal(storeMode(true), 'full');
  assert.equal(storeMode(false), 'soon');
});

test('detail screens are inert for the real fan', () => {
  assert.equal(canOpenDetail(true), true);
  assert.equal(canOpenDetail(false), false);
});

test('the showcase shows the featured card and no perk appears twice', () => {
  assert.equal(showsFeaturedCard('featured'), true);
  assert.equal(showsFeaturedCard('identity'), false);

  const vitrine = perksInCategory('featured');
  assert.ok(!vitrine.some((p) => p.featured), 'the featured perk is not repeated in the grid');
  assert.equal(vitrine.length, PERKS.length - 1);
});

test('each category returns only its own perks', () => {
  assert.deepEqual(
    perksInCategory('partners').map((p) => p.id),
    ['ticket', 'discount', 'product'],
  );
  assert.deepEqual(perksInCategory('game').map((p) => p.id), ['markets']);
});

test('the catalogue has unique ids and a single featured perk', () => {
  const ids = PERKS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(PERKS.filter((p) => p.featured).length, 1);
  assert.equal(perkById('poc')?.currency, 'trophy');
  assert.equal(perkById('inexistente'), null);
});

test('a Trophy price cannot be paid with XP', () => {
  const poc = perkById('poc')!;
  const markets = perkById('markets')!;

  assert.equal(canAfford(poc, { xp: 999_999, trophies: 0 }), false);
  assert.equal(canAfford(poc, { xp: 0, trophies: 1 }), true);
  assert.equal(canAfford(markets, { xp: 800, trophies: 0 }), true);
  assert.equal(canAfford(markets, { xp: 799, trophies: 99 }), false);
});

test('an address is shortened at both ends and a short address stays whole', () => {
  assert.equal(shortAddress('7xKqAAAAAAAAAAAA9fPz'), '7xKq…9fPz');
  assert.equal(shortAddress('abc'), 'abc');
});

test('the wallet chip never invents an address', () => {
  assert.deepEqual(walletChip({ isDemo: true, address: null }), { kind: 'demo', address: null });
  // Even with a wallet, the demo shows no address: the account is local and simulated.
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
