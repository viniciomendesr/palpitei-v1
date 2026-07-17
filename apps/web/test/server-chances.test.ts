import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LEITURAS,
  atualizarPct1x2,
  idDaOpcao1x2,
  mesclarLinhaDoTempo,
  registrarLeitura,
  type LeituraDeChance,
  type Pct1x2,
} from '../src/server/chances.ts';
import type { OddsEvent, ScoreEvent } from '@palpitei/core';

// Helpers mínimos: para a mescla só importam `kind` e `ts`; para o mapa de pct,
// `prices`. O resto do evento não participa da lógica testada.
const placar = (ts: number, seq = 0): ScoreEvent =>
  ({ kind: 'score', ts, seq } as unknown as ScoreEvent);
const odds = (ts: number, prices: { name: string; pct: number }[] = []): OddsEvent =>
  ({ kind: 'odds', ts, prices } as unknown as OddsEvent);

test('mescla ordena por ts e intercala odds entre os lances', () => {
  const linha = mesclarLinhaDoTempo([placar(10), placar(30)], [odds(20), odds(40)]);
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
  const linha = mesclarLinhaDoTempo([placar(100)], [odds(100)]);
  assert.deepEqual(
    linha.map((e) => e.kind),
    ['score', 'odds'],
  );
});

test('a mescla preserva a ordem de seq dos lances mesmo com ts fora de ordem (A3)', () => {
  // O feed real traz ts fora de ordem dentro da série de placar; a ordem por
  // seq é a verdade e a mescla não pode reordenar os lances entre si.
  const linha = mesclarLinhaDoTempo([placar(50, 1), placar(40, 2)], [odds(45)]);
  const soPlacar = linha.filter((e) => e.kind === 'score') as ScoreEvent[];
  assert.deepEqual(
    soPlacar.map((e) => e.seq),
    [1, 2],
  );
});

test('idDaOpcao1x2 traduz os nomes do feed para o id da opção', () => {
  assert.equal(idDaOpcao1x2('part1'), 'p1');
  assert.equal(idDaOpcao1x2('1'), 'p1');
  assert.equal(idDaOpcao1x2('home'), 'p1');
  assert.equal(idDaOpcao1x2('draw'), 'draw');
  assert.equal(idDaOpcao1x2('x'), 'draw');
  assert.equal(idDaOpcao1x2('part2'), 'p2');
  assert.equal(idDaOpcao1x2('2'), 'p2');
  assert.equal(idDaOpcao1x2('away'), 'p2');
  assert.equal(idDaOpcao1x2('Part1'), 'p1'); // o feed não garante caixa
  // Desconhecido é null, NUNCA um chute: número inventado é o G6.
  assert.equal(idDaOpcao1x2('over'), null);
});

test('atualizarPct1x2 guarda a última leitura por opção e ignora nomes estranhos', () => {
  const mapa: Pct1x2 = {};
  atualizarPct1x2(mapa, odds(1, [
    { name: 'part1', pct: 41.2 },
    { name: 'draw', pct: 27.5 },
    { name: 'part2', pct: 31.3 },
  ]));
  assert.deepEqual(mapa, { p1: 41.2, draw: 27.5, p2: 31.3 });

  // Evento seguinte só cita duas opções: as outras NÃO regridem nem somem.
  atualizarPct1x2(mapa, odds(2, [
    { name: 'part1', pct: 55.0 },
    { name: 'over', pct: 99.9 }, // nome de outro mercado: fora do mapa
  ]));
  assert.deepEqual(mapa, { p1: 55.0, draw: 27.5, p2: 31.3 });
});

test('registrarLeitura põe a mais recente PRIMEIRO e respeita o cap', () => {
  const chances: LeituraDeChance[] = [];
  const leitura = (ts: number): LeituraDeChance => ({
    id: `odds-${ts}:part1`,
    ts,
    minute: null,
    priceName: 'part1',
    fromPct: 40,
    toPct: 45,
    text: 'x',
  });
  for (let i = 1; i <= MAX_LEITURAS + 5; i++) registrarLeitura(chances, leitura(i));
  assert.equal(chances.length, MAX_LEITURAS);
  assert.equal(chances[0]!.ts, MAX_LEITURAS + 5); // mais recente primeiro
  assert.equal(chances.at(-1)!.ts, 6); // as 5 mais velhas caíram
});
