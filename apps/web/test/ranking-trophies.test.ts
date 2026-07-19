import test from 'node:test';
import assert from 'node:assert/strict';

import { showsTrophyMark } from '../src/lib/ranking.ts';
import { globalRanking } from '../src/lib/mock.ts';
import { DEMO_TROPHIES, canAfford, perkById } from '../src/lib/marketplace.ts';

const T = { meSubYou: 'VOCÊ' } as never;
const EU = { nickname: 'Você', initials: 'VC', xp: 1240 };

test('a zero balance draws no mark: the absence IS the zero, not an unknown', () => {
  // A Trophy is scarce (today only the live debut grants one), so almost every
  // one of the 50 rows would show "0". Repeating zero 49 times would turn the
  // rarest thing in the product into the loudest on screen, next to XP, the metric.
  assert.equal(showsTrophyMark(0), false);
});

test('a positive balance draws the mark', () => {
  assert.equal(showsTrophyMark(1), true);
  assert.equal(showsTrophyMark(7), true);
});

test('a negative balance draws no mark — the ledger can go below zero', () => {
  // `trophy_ledger` is a ledger: `delta` can be negative (perk_redeem). A negative
  // balance is real data, but it is not a trophy to display.
  assert.equal(showsTrophyMark(-1), false);
});

test('the demo row carries the SAME balance the store shows', () => {
  // Rule 4: if the ranking drew 0 while the store says 1 Trophy, the product would
  // contradict itself on the judge's path. There is a single source (`DEMO_TROPHIES`),
  // read here and in MarketplaceState — the number is not duplicated.
  const eu = globalRanking(T, EU)[0];
  assert.ok(eu, 'the demo always renders the row of the fan themselves');
  assert.equal(eu.trophies, DEMO_TROPHIES);
  assert.equal(showsTrophyMark(eu.trophies), true, 'the demo fan HAS a trophy, so the mark shows up');
});

test('the demo balance is exactly what the store needs for the debut perk', () => {
  // Ties consistency to behaviour, not to the constant: with the demo balance the
  // Selo (1 Trophy) is redeemable. If someone zeroes DEMO_TROPHIES, both sides break
  // together instead of diverging in silence.
  const poc = perkById('poc');
  assert.ok(poc);
  assert.equal(canAfford(poc, { xp: 0, trophies: DEMO_TROPHIES }), true);
});
