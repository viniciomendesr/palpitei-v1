import assert from 'node:assert/strict';
import test from 'node:test';

import { matchSlug } from '@palpitei/selo/metadata';

import {
  findMatchForSlug,
  formatMatchDate,
  parseSeloImageName,
  seloMatchView,
  teamNameFontSize,
} from '../src/server/selo-badge.ts';

/** France x England, 18/07/2026 21:00 UTC — a partida real que gerou os selos. */
const FRANCE_ENGLAND = { p1: 'France', p2: 'England', startTime: Date.UTC(2026, 6, 18, 21, 0, 0) };

test('separa o slug da data que ele carrega', () => {
  assert.deepEqual(parseSeloImageName('france-england-2026-07-18.png'), {
    slug: 'france-england-2026-07-18',
    isoDate: '2026-07-18',
  });
});

test('recusa nome sem .png, sem data e com data impossível', () => {
  assert.equal(parseSeloImageName('france-england-2026-07-18'), null);
  assert.equal(parseSeloImageName('france-england-2026-07-18.jpg'), null);
  assert.equal(parseSeloImageName('france-england.png'), null);
  assert.equal(parseSeloImageName('collection.png'), null);
  // Bem formada, mas não é um dia: chegaria ao banco como consulta vazia.
  assert.equal(parseSeloImageName('france-england-2026-13-40.png'), null);
});

test('recusa travessia de caminho e caixa alta no slug', () => {
  assert.equal(parseSeloImageName('../../etc/passwd-2026-07-18.png'), null);
  assert.equal(parseSeloImageName('France-England-2026-07-18.png'), null);
});

test('o slug aceito é exatamente o que o metadado gera', () => {
  const gerado = matchSlug(FRANCE_ENGLAND.p1, FRANCE_ENGLAND.p2, FRANCE_ENGLAND.startTime);
  assert.equal(gerado, 'france-england-2026-07-18');
  assert.deepEqual(parseSeloImageName(`${gerado}.png`), { slug: gerado, isoDate: '2026-07-18' });
});

test('acha a partida do dia regenerando o slug, não por nome parecido', () => {
  const outra = { p1: 'Spain', p2: 'Argentina', startTime: Date.UTC(2026, 6, 18, 19, 0, 0) };
  const candidatas = [outra, FRANCE_ENGLAND];
  assert.equal(findMatchForSlug('france-england-2026-07-18', candidatas), FRANCE_ENGLAND);
  assert.equal(findMatchForSlug('spain-argentina-2026-07-18', candidatas), outra);
  // Times certos, dia errado: não é a mesma partida e não pode responder pela URL.
  assert.equal(findMatchForSlug('france-england-2026-07-19', candidatas), null);
  // Time só de um lado não basta.
  assert.equal(findMatchForSlug('france-2026-07-18', candidatas), null);
});

test('partida sem horário de início não vira selo', () => {
  assert.equal(findMatchForSlug('france-england-2026-07-18', [{ p1: 'France', p2: 'England' }]), null);
  assert.equal(seloMatchView({ p1: 'France', p2: 'England' }), null);
});

test('a view traz times em caixa alta, data pt-BR e o slug de origem', () => {
  assert.deepEqual(seloMatchView(FRANCE_ENGLAND), {
    home: 'FRANCE',
    away: 'ENGLAND',
    dateLabel: '18/07/2026',
    slug: 'france-england-2026-07-18',
  });
});

test('a data do selo é UTC, o mesmo dia do slug e da âncora', () => {
  // 23:30 UTC de 18/07 é 20:30 de 18/07 em BRT; um fuso local diria 18 e o slug 18,
  // mas às 01:00 UTC de 19/07 (22:00 BRT do 18) eles divergiriam. Fixamos UTC.
  const tarde = Date.UTC(2026, 6, 19, 1, 0, 0);
  assert.equal(formatMatchDate(tarde), '19/07/2026');
  assert.equal(seloMatchView({ p1: 'France', p2: 'England', startTime: tarde })?.dateLabel, '19/07/2026');
});

test('nome longo de time desce de tamanho para não ser cortado pelo Satori', () => {
  const base = 100;
  assert.equal(teamNameFontSize({ home: 'FRANCE', away: 'ENGLAND' }, base), base * 0.88);
  assert.equal(teamNameFontSize({ home: 'ARGENTINA', away: 'SPAIN' }, base), base * 0.8);
  assert.equal(teamNameFontSize({ home: 'BOSNIA AND HERZ', away: 'ITALY' }, base), base * 0.62);
  assert.ok(teamNameFontSize({ home: 'A'.repeat(24), away: 'ITALY' }, base) < base * 0.62);
});
