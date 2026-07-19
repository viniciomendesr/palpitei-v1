import assert from 'node:assert/strict';
import test from 'node:test';
import { localizeTeamName } from '../src/lib/team-names.ts';

test('it localizes canonical TxLINE names in English and Portuguese', () => {
  assert.equal(localizeTeamName('England', 'pt'), 'Inglaterra');
  assert.equal(localizeTeamName('Inglaterra', 'en'), 'England');
  assert.equal(localizeTeamName('Brazil', 'pt'), 'Brasil');
  assert.equal(localizeTeamName('Brasil', 'en'), 'Brazil');
});

test('it accepts common aliases, abbreviations, and differing case and accents', () => {
  assert.equal(localizeTeamName('USA', 'pt'), 'Estados Unidos');
  assert.equal(localizeTeamName('eua', 'en'), 'United States');
  assert.equal(localizeTeamName('Korea Republic', 'pt'), 'Coreia do Sul');
  assert.equal(localizeTeamName('Korea', 'pt'), 'Coreia do Sul');
  assert.equal(localizeTeamName('COTE D IVOIRE', 'pt'), 'Costa do Marfim');
  assert.equal(localizeTeamName('Mexico', 'pt'), 'México');
});

test('it keeps an unknown name literally as a safe fallback', () => {
  const unknown = 'Seleção Nova da TxLINE';
  assert.equal(localizeTeamName(unknown, 'pt'), unknown);
  assert.equal(localizeTeamName(unknown, 'en'), unknown);
});
