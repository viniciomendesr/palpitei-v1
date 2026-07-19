import test from 'node:test';
import assert from 'node:assert/strict';
import { resultadosDoDemo } from '../src/lib/demo-resumo.ts';
import { calcularResumoDaSala } from '../src/lib/resumo.ts';

const DESAFIOS = [
  { xp: 40, correct: 'arg', optIds: ['arg', 'cab', 'none'] },
  { xp: 30, correct: 'cab', optIds: ['arg', 'cab', 'none'] },
] as unknown as Parameters<typeof resultadosDoDemo>[1];

const TEXTOS = [
  { type: 'PRÓXIMO GOL', prompt: 'Quem marca o próximo gol?', opts: { arg: 'Argentina', cab: 'Cabo Verde', none: 'Ninguém até o fim' } },
  { type: 'PRÓXIMO GOL', prompt: 'Quem marca o próximo gol?', opts: { arg: 'Argentina', cab: 'Cabo Verde', none: 'Ninguém até o fim' } },
] as unknown as Parameters<typeof resultadosDoDemo>[2];

test('the demo resumo rebuilds what the fan chose, with the dictionary label', () => {
  const resultados = resultadosDoDemo(
    { answers: [{ index: 0, choice: 'arg', gained: 40 }], scoreA: 2, scoreB: 1 },
    DESAFIOS,
    TEXTOS,
  );
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0]?.minhaEscolha, 'arg');
  assert.equal(resultados[0]?.correctOptionId, 'arg');
  assert.deepEqual(resultados[0]?.options?.[0], { id: 'arg', label: 'Argentina' });
});

test('a demo hit and a miss both feed the same sala resumo tally', () => {
  const resultados = resultadosDoDemo(
    {
      answers: [
        { index: 0, choice: 'arg', gained: 40 },
        { index: 1, choice: 'arg', gained: 0 },
      ],
      scoreA: 2,
      scoreB: 2,
    },
    DESAFIOS,
    TEXTOS,
  );
  const resumo = calcularResumoDaSala(resultados, 1, 0);
  assert.equal(resumo.picks, 2);
  assert.equal(resumo.hits, 1, 'only the first one matches the answer key');
  assert.equal(resumo.xp, 40);
});

test('a missed window in the demo does NOT count as a hit', () => {
  const resultados = resultadosDoDemo(
    { answers: [{ index: 0, choice: null, gained: 0 }], scoreA: 2, scoreB: 1 },
    DESAFIOS,
    TEXTOS,
  );
  assert.equal(resultados[0]?.minhaEscolha, null);
  assert.equal(calcularResumoDaSala(resultados, 1, 0).hits, 0);
});

test('an index outside the dictionary is dropped, never half-rendered', () => {
  const resultados = resultadosDoDemo(
    {
      answers: [
        { index: 0, choice: 'arg', gained: 40 },
        { index: 99, choice: 'arg', gained: 40 },
      ],
      scoreA: 2,
      scoreB: 1,
    },
    DESAFIOS,
    TEXTOS,
  );
  assert.equal(resultados.length, 1);
});
