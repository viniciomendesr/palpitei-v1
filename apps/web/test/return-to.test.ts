import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnTo } from '../src/lib/return-to.ts';

test('returnTo aceita apenas rotas internas do Palpitei', () => {
  assert.equal(safeReturnTo('/convite/ABC234'), '/convite/ABC234');
  assert.equal(safeReturnTo('/convite/ABC234?from=whatsapp'), '/convite/ABC234?from=whatsapp');
  assert.equal(safeReturnTo('https://evil.example/roubar'), null);
  assert.equal(safeReturnTo('//evil.example/roubar'), null);
  assert.equal(safeReturnTo('javascript:alert(1)'), null);
});
