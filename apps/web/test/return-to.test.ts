import test from 'node:test';
import assert from 'node:assert/strict';
import { returnToFromSearch, safeReturnTo } from '../src/lib/return-to.ts';

test('returnTo aceita apenas rotas internas do Palpitei', () => {
  assert.equal(safeReturnTo('/convite/ABC234'), '/convite/ABC234');
  assert.equal(safeReturnTo('/convite/ABC234?from=whatsapp'), '/convite/ABC234?from=whatsapp');
  assert.equal(safeReturnTo('https://evil.example/roubar'), null);
  assert.equal(safeReturnTo('//evil.example/roubar'), null);
  assert.equal(safeReturnTo('javascript:alert(1)'), null);
});

test('returnTo sobrevive ao redirecionamento de login do convite', () => {
  assert.equal(returnToFromSearch('?returnTo=%2Fconvite%2FABC234'), '/convite/ABC234');
  assert.equal(returnToFromSearch('?returnTo=https%3A%2F%2Fevil.example'), null);
});
