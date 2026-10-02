import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { applyPromotions } from '../lib/promotions.mjs';
const code = fs.readFileSync('scripts/register-cart.js', 'utf8');
const source = code.slice(
  code.indexOf('function removeCartLine('),
  code.indexOf('const updateCartDisplay ='),
);
function setup(cart, groups = []) {
  let saves = 0;
  const context = {
    cart,
    cloud: { event: { status: 'open' } },
    checkoutBusy: false,
    priceOverrides: { A: 90 },
    localStorage: { setItem() {} },
    updateCartDisplay() {},
    calculateTotal() {},
    saveCart() {
      saves++;
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const lines = () =>
    applyPromotions(
      context.cart,
      { A: { code: 'A', price: 100 }, B: { code: 'B', price: 200 } },
      groups,
    );
  return {
    context,
    lines,
    remove: (line) => context.removeCartLine(line),
    saves: () => saves,
  };
}
const item = (code, quantity = 1) => ({
  code,
  quantity,
  price: code === 'A' ? 100 : 200,
  discount: 100,
});
const bogo = {
  id: 'bogo',
  type: 'bogo',
  name: '買一送一',
  codes: ['A'],
  giftCodes: ['A'],
  priority: 0,
};
test('Remove one cart line, retaining the other product and saving the draft', () => {
  const x = setup([item('A', 3), item('B')]);
  x.remove(x.lines()[0]);
  assert.equal(x.context.cart.length, 1);
  assert.equal(x.context.cart[0].code, 'B');
  assert.equal(x.context.priceOverrides.A, undefined);
  assert.equal(x.saves(), 1);
});
test('Remove a BOGO gift or paid line without deleting the other physical book; recalculate its price', () => {
  for (const gift of [false, true]) {
    const x = setup([item('A', 2)], [bogo]);
    x.remove(x.lines().find((i) => !!i.promotionGift === gift));
    assert.equal(x.context.cart[0].quantity, 1);
    assert.equal(x.lines().length, 1);
    assert.equal(x.lines()[0].discount, 100);
    assert.equal(x.saves(), 1);
  }
});
test('Refund removal and closed/saving register guards', () => {
  const x = setup([item('A', -2), item('B')]);
  const line = x.lines()[0];
  x.context.checkoutBusy = true;
  x.remove(line);
  assert.equal(x.context.cart.length, 2);
  x.context.checkoutBusy = false;
  x.context.cloud.event.status = 'archived';
  x.remove(line);
  assert.equal(x.saves(), 0);
  x.context.cloud.event.status = 'open';
  x.remove(line);
  assert.equal(x.context.cart.length, 1);
});
