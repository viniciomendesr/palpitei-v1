import test from 'node:test';
import assert from 'node:assert/strict';

import { showsTrophyMark } from '../src/lib/ranking.ts';
import { globalRanking } from '../src/lib/mock.ts';
import { DEMO_TROPHIES, canAfford, perkById } from '../src/lib/marketplace.ts';

const T = { meSubYou: 'VOCÊ' } as never;
const EU = { nickname: 'Você', initials: 'VC', xp: 1240 };

test('saldo zero não desenha a marca: a ausência É o zero, não um desconhecido', () => {
  // Troféu é escasso (hoje só a estreia ao vivo concede um), então quase toda
  // linha das 50 mostraria "0". Repetir zero 49 vezes faria a coisa mais rara do
  // produto virar a mais barulhenta da tela, ao lado do XP que é a métrica.
  assert.equal(showsTrophyMark(0), false);
});

test('saldo positivo desenha a marca', () => {
  assert.equal(showsTrophyMark(1), true);
  assert.equal(showsTrophyMark(7), true);
});

test('saldo negativo não desenha marca — o ledger pode ir abaixo de zero', () => {
  // `trophy_ledger` é livro-razão: `delta` pode ser negativo (perk_redeem). Um
  // saldo negativo é dado real, mas não é um troféu para exibir.
  assert.equal(showsTrophyMark(-1), false);
});

test('a linha do demo carrega o MESMO saldo que a loja mostra', () => {
  // Rule 4: se o ranking desenhasse 0 enquanto a loja diz 1 Troféu, o produto se
  // contradiria no caminho do jurado. A fonte é uma só (`DEMO_TROPHIES`), lida
  // aqui e em MarketplaceState — o número não é duplicado.
  const eu = globalRanking(T, EU)[0];
  assert.ok(eu, 'o demo sempre rende a linha do próprio fã');
  assert.equal(eu.trophies, DEMO_TROPHIES);
  assert.equal(showsTrophyMark(eu.trophies), true, 'o fã do demo TEM troféu, então a marca aparece');
});

test('o saldo do demo é o que a loja precisa para o perk de estreia', () => {
  // Amarra a consistência pelo comportamento, não pela constante: com o saldo do
  // demo, o Selo (1 Troféu) é resgatável. Se alguém zerar DEMO_TROPHIES, os dois
  // lados quebram juntos em vez de divergirem em silêncio.
  const poc = perkById('poc');
  assert.ok(poc);
  assert.equal(canAfford(poc, { xp: 0, trophies: DEMO_TROPHIES }), true);
});
