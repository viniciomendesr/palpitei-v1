import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TxlineHttpError } from '@palpitei/txline';
import {
  extractPregameMarkets,
  extractMarketLine,
  marketById,
  matchesMarketLine,
  fetchPregameOdds,
  resetPregameOddsForTest,
  getPregameOddsStatus,
} from '../src/server/pregameOdds.ts';

const base = {
  FixtureId: 700001,
  MarketPeriod: null,
  Prices: [1900, 2100],
};

test('extractMarketLine reads the TxLINE string and rejects lines with push/half-win', () => {
  assert.equal(extractMarketLine('line=2.5'), 2.5);
  assert.equal(extractMarketLine('sport=football; line = 9.5'), 9.5);
  assert.equal(extractMarketLine({ line: 3.5 }), 3.5);
  assert.equal(extractMarketLine('line=3'), null, 'a whole line can tie');
  assert.equal(extractMarketLine('line=2.25'), null, 'an asian line is not binary');
  assert.equal(extractMarketLine('wrong=2.5'), null);
});

test('extracts a list of TxLINE markets and picks the most balanced goals line', () => {
  const markets = extractPregameMarkets([
    {
      ...base,
      SuperOddsType: '1X2_PARTICIPANT_RESULT',
      PriceNames: ['part1', 'draw', 'part2'],
      Prices: [1900, 3400, 4400],
      Pct: ['52.4', '29.2', '18.4'],
    },
    {
      ...base,
      SuperOddsType: 'OVERUNDER_PARTICIPANT_GOALS',
      MarketParameters: 'line=1.5',
      PriceNames: ['over', 'under'],
      Pct: ['80', '20'],
    },
    {
      ...base,
      SuperOddsType: 'OVERUNDER_PARTICIPANT_GOALS',
      MarketParameters: 'line=3.5',
      PriceNames: ['over', 'under'],
      Pct: ['48', '52'],
    },
    {
      ...base,
      SuperOddsType: 'OVERUNDER_PARTICIPANT_CORNERS',
      MarketParameters: 'line=9.5',
      PriceNames: ['over', 'under'],
      Pct: ['51.2', '48.8'],
    },
  ]);

  assert.deepEqual(markets, [
    {
      id: 'result', kind: 'result',
      options: [{ id: 'home', pct: 52.4 }, { id: 'draw', pct: 29.2 }, { id: 'away', pct: 18.4 }],
    },
    {
      id: 'goals', kind: 'over_under', line: 3.5,
      options: [{ id: 'over', pct: 48 }, { id: 'under', pct: 52 }],
    },
    {
      id: 'corners', kind: 'over_under', line: 9.5,
      options: [{ id: 'over', pct: 51.2 }, { id: 'under', pct: 48.8 }],
    },
  ]);
  assert.equal(matchesMarketLine(3.5, marketById(markets, 'goals')), true);
  assert.equal(matchesMarketLine(2.5, marketById(markets, 'goals')), false);
});

test('misaligned arrays, Pct NA, a period and an invalid line never become an invented chance', () => {
  const markets = extractPregameMarkets([
    {
      ...base,
      SuperOddsType: '1X2_PARTICIPANT_RESULT',
      PriceNames: ['part1', 'draw', 'part2'],
      Prices: [1900, 3400],
      Pct: ['52', '29', '18'],
    },
    {
      ...base,
      SuperOddsType: 'OVERUNDER_PARTICIPANT_GOALS',
      MarketParameters: 'line=2.5',
      PriceNames: ['over', 'under'],
      Pct: ['NA', 'NA'],
    },
    {
      ...base,
      SuperOddsType: 'OVERUNDER_PARTICIPANT_CORNERS',
      MarketPeriod: 'half=1',
      MarketParameters: 'line=4.5',
      PriceNames: ['over', 'under'],
      Pct: ['45', '55'],
    },
  ]);

  assert.deepEqual(markets, []);
});

test('a TxLINE failure stays observable without logging body or secret', async () => {
  resetPregameOddsForTest();
  const indisponivel = await fetchPregameOdds(
    700003,
    async () => {
      throw new TxlineHttpError(503, '/odds/snapshot/700003', 'Bearer segredo-que-nao-pode-vazar');
    },
  );

  assert.deepEqual(indisponivel, { markets: [], txlineAvailable: false });
  const status = getPregameOddsStatus();
  assert.equal(status.txlineQueries, 1);
  assert.equal(status.cacheHits, 0);
  assert.equal(status.unavailableResponses, 1);
  assert.equal(status.lastUnavailableReason, 'HTTP 503');
  assert.equal(typeof status.lastUnavailableAt, 'number');
});
