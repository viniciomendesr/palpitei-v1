import assert from 'node:assert/strict';
import test from 'node:test';
import { localizeTeamName } from '../src/lib/team-names.ts';

test('localiza nomes canônicos da TxLINE em inglês e português', () => {
  assert.equal(localizeTeamName('England', 'pt'), 'Inglaterra');
  assert.equal(localizeTeamName('Inglaterra', 'en'), 'England');
  assert.equal(localizeTeamName('Brazil', 'pt'), 'Brasil');
  assert.equal(localizeTeamName('Brasil', 'en'), 'Brazil');
});

test('aceita aliases comuns, siglas, caixa e acentos diferentes', () => {
  assert.equal(localizeTeamName('USA', 'pt'), 'Estados Unidos');
  assert.equal(localizeTeamName('eua', 'en'), 'United States');
  assert.equal(localizeTeamName('Korea Republic', 'pt'), 'Coreia do Sul');
  assert.equal(localizeTeamName('Korea', 'pt'), 'Coreia do Sul');
  assert.equal(localizeTeamName('COTE D IVOIRE', 'pt'), 'Costa do Marfim');
  assert.equal(localizeTeamName('Mexico', 'pt'), 'México');
});

test('mantém literalmente um nome desconhecido como fallback seguro', () => {
  const unknown = 'Seleção Nova da TxLINE';
  assert.equal(localizeTeamName(unknown, 'pt'), unknown);
  assert.equal(localizeTeamName(unknown, 'en'), unknown);
});
