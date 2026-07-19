import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularResumoDaSala } from '../src/lib/resumo.ts';
import type { SalaResultado } from '../src/lib/useSala.ts';

test('resumo counts hits against the answer key, including treino with no XP', () => {
  const resultados = [
    { questionId: '1', prompt: '', correctOptionId: 'p1', minhaEscolha: 'p1', gained: 0 },
    { questionId: '2', prompt: '', correctOptionId: 'yes', minhaEscolha: 'no', gained: 0 },
    { questionId: '3', prompt: '', correctOptionId: 'p2', minhaEscolha: 'p2', gained: 75 },
    { questionId: '4', prompt: '', minhaEscolha: 'p1', gained: 0, voidReason: 'cedo' },
  ] as SalaResultado[];
  assert.deepEqual(calcularResumoDaSala(resultados, 3, 10), {
    picks: 4,
    hits: 2,
    xp: 75,
    players: 3,
    movements: 10,
  });
});
