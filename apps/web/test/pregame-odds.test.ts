import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extrairMercadosPregame, linhaDoMercado, mercadoPorId, mesmaLinha } from '../src/server/pregameOdds.ts';

const base = {
  FixtureId: 700001,
  MarketPeriod: null,
  Prices: [1900, 2100],
};

test('linhaDoMercado lê a string da TxLINE e rejeita linhas com push/meio ganho', () => {
  assert.equal(linhaDoMercado('line=2.5'), 2.5);
  assert.equal(linhaDoMercado('sport=football; line = 9.5'), 9.5);
  assert.equal(linhaDoMercado({ line: 3.5 }), 3.5);
  assert.equal(linhaDoMercado('line=3'), null, 'linha inteira pode empatar');
  assert.equal(linhaDoMercado('line=2.25'), null, 'linha asiática não é binária');
  assert.equal(linhaDoMercado('wrong=2.5'), null);
});

test('extrai uma lista de mercados TxLINE e escolhe a linha de gols mais equilibrada', () => {
  const markets = extrairMercadosPregame([
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
  assert.equal(mesmaLinha(3.5, mercadoPorId(markets, 'goals')), true);
  assert.equal(mesmaLinha(2.5, mercadoPorId(markets, 'goals')), false);
});

test('arrays desalinhados, Pct NA, período e linha inválida não viram uma chance inventada', () => {
  const markets = extrairMercadosPregame([
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
