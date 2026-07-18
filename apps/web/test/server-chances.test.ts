import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CHANCE_READINGS,
  update1x2Percentages,
  optionIdFor1x2,
  mergeTimeline,
  recordChanceReading,
  type ChanceReading,
  type Pct1x2,
} from '../src/server/chances.ts';
import type { OddsEvent, ScoreEvent } from '@palpitei/core';

// Minimal helpers: merging uses `kind` and `ts`, while percentage mapping uses `prices`.
const placar = (ts: number, seq = 0): ScoreEvent =>
  ({ kind: 'score', ts, seq } as unknown as ScoreEvent);
const odds = (ts: number, prices: { name: string; pct: number }[] = []): OddsEvent =>
  ({ kind: 'odds', ts, prices } as unknown as OddsEvent);

test('mescla ordena por ts e intercala odds entre os lances', () => {
  const linha = mergeTimeline([placar(10), placar(30)], [odds(20), odds(40)]);
  assert.deepEqual(
    linha.map((e) => [e.kind, e.ts]),
    [
      ['score', 10],
      ['odds', 20],
      ['score', 30],
      ['odds', 40],
    ],
  );
});

test('no EMPATE de ts, o placar vem ANTES da cotação (o lance é o contexto dela)', () => {
  const linha = mergeTimeline([placar(100)], [odds(100)]);
  assert.deepEqual(
    linha.map((e) => e.kind),
    ['score', 'odds'],
  );
});

test('a mescla preserva a ordem de seq dos lances mesmo com ts fora de ordem (A3)', () => {
  // The feed can contain out-of-order timestamps; sequence order remains authoritative.
  const linha = mergeTimeline([placar(50, 1), placar(40, 2)], [odds(45)]);
  const soPlacar = linha.filter((e) => e.kind === 'score') as ScoreEvent[];
  assert.deepEqual(
    soPlacar.map((e) => e.seq),
    [1, 2],
  );
});

test('idDaOpcao1x2 traduz os nomes do feed para o id da opção', () => {
  assert.equal(optionIdFor1x2('part1'), 'p1');
  assert.equal(optionIdFor1x2('1'), 'p1');
  assert.equal(optionIdFor1x2('home'), 'p1');
  assert.equal(optionIdFor1x2('draw'), 'draw');
  assert.equal(optionIdFor1x2('x'), 'draw');
  assert.equal(optionIdFor1x2('part2'), 'p2');
  assert.equal(optionIdFor1x2('2'), 'p2');
  assert.equal(optionIdFor1x2('away'), 'p2');
  assert.equal(optionIdFor1x2('Part1'), 'p1'); // Feed casing is not guaranteed.
  // Unknown names return null; the UI must not invent a value.
  assert.equal(optionIdFor1x2('over'), null);
});

test('atualizarPct1x2 guarda a última leitura por opção e ignora nomes estranhos', () => {
  const mapa: Pct1x2 = {};
  update1x2Percentages(mapa, odds(1, [
    { name: 'part1', pct: 41.2 },
    { name: 'draw', pct: 27.5 },
    { name: 'part2', pct: 31.3 },
  ]));
  assert.deepEqual(mapa, { p1: 41.2, draw: 27.5, p2: 31.3 });

  // The next event cites only two options; omitted values must not regress or disappear.
  update1x2Percentages(mapa, odds(2, [
    { name: 'part1', pct: 55.0 },
    { name: 'over', pct: 99.9 }, // Another market, outside the 1X2 map.
  ]));
  assert.deepEqual(mapa, { p1: 55.0, draw: 27.5, p2: 31.3 });
});

test('registrarLeitura põe a mais recente PRIMEIRO e respeita o cap', () => {
  const chances: ChanceReading[] = [];
  const leitura = (ts: number): ChanceReading => ({
    id: `odds-${ts}:part1`,
    ts,
    minute: null,
    priceName: 'part1',
    fromPct: 40,
    toPct: 45,
    text: 'x',
  });
  for (let i = 1; i <= MAX_CHANCE_READINGS + 5; i++) recordChanceReading(chances, leitura(i));
  assert.equal(chances.length, MAX_CHANCE_READINGS);
  assert.equal(chances[0]!.ts, MAX_CHANCE_READINGS + 5); // Most recent first.
  assert.equal(chances.at(-1)!.ts, 6); // The five oldest readings were trimmed.
});
