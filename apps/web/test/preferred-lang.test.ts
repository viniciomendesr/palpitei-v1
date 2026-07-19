import assert from 'node:assert/strict';
import test from 'node:test';

import { preferredLang } from '../src/lib/preferred-lang.ts';

test('a Portuguese visitor keeps the pt-BR copy', () => {
  assert.equal(preferredLang(['pt-BR']), 'pt');
  assert.equal(preferredLang(['pt']), 'pt');
  assert.equal(preferredLang(['PT-br']), 'pt');
});

test('an international visitor gets English instead of a language they cannot read', () => {
  assert.equal(preferredLang(['en-US']), 'en');
  assert.equal(preferredLang(['es-ES']), 'en');
  assert.equal(preferredLang(['ja']), 'en');
});

test('the first stated preference wins', () => {
  assert.equal(preferredLang(['pt-BR', 'en-US']), 'pt');
  assert.equal(preferredLang(['en-US', 'pt-BR']), 'en');
});

test('no stated preference leaves the pt-BR default in place', () => {
  assert.equal(preferredLang([]), null);
  assert.equal(preferredLang(['']), null);
});
