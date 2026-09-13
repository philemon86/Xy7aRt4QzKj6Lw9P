import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('Generated checkout totals apply current promotions without repricing saved invoices', () => {
  const html = fs.readFileSync('public/register.html', 'utf8');
  const start = html.indexOf('      const pricedCart=');
  const end = html.indexOf('      const calculateTotal =', start);
  const context = {
    POSCore: { applyPromotions },
    cart: [item(), item('B')],
    products: Object.fromEntries(products.map((p) => [p.code, p])),
    cloud: { catalog: { pricingRules: { groups: [bogo] } } },
  };
  vm.createContext(context);
  vm.runInContext(
    html.slice(start, end) +
      '\nglobalThis.getTotal=calculateCartTotal;globalThis.lines=pricedCart;',
    context,
  );
  assert.equal(context.getTotal(context.cart), 100);
  assert.equal(context.lines().length, 2);
  assert.equal(context.getTotal([{ ...item(), quantity: 2 }]), 79);
});
import { applyPromotions, validatePromotion } from '../lib/promotions.mjs';
import { churchInventory } from '../lib/church-stock.mjs';
import { validateOrder } from '../lib/state.mjs';
const products = [
  { code: 'A', name: '書A', price: 100, legacyPrice: 100 },
  { code: 'B', name: '書B', price: 200, legacyPrice: 200 },
];
const item = (code = 'A', quantity = 1) => ({
  ...products.find((p) => p.code === code),
  price: 50,
  quantity,
  discount: 79,
  isManual: false,
});
const bogo = {
  id: 'g',
  name: '買一送一',
  type: 'bogo',
  codes: ['A'],
  giftCode: 'B',
  giftMode: 'auto',
  priority: 0,
};
const tiers = {
  id: 't',
  name: '數量折扣',
  type: 'tiers',
  codes: ['A', 'B'],
  priority: 0,
  tiers: [
    { quantity: 1, mode: 'discount', value: 79 },
    { quantity: 3, mode: 'discount', value: 75 },
    { quantity: 6, mode: 'discount', value: 69 },
  ],
};
const total = (rows) =>
  Math.round(
    rows.reduce((s, i) => s + (i.price * i.quantity * i.discount) / 100, 0),
  );
test('BOGO reprices two scanned products without adding physical quantity or mutating the draft', () => {
  const cart = [item(), item('B')];
  const before = JSON.stringify(cart);
  const result = applyPromotions(cart, products, [bogo]);
  assert.deepEqual(
    result.map((p) => [p.code, p.quantity, p.discount]),
    [
      ['A', 1, 100],
      ['B', 1, 0],
    ],
  );
  assert.equal(total(result), 100);
  assert.equal(JSON.stringify(cart), before);
  assert.deepEqual(applyPromotions(cart, products, [bogo]), result);
  validateOrder({
    id: 'x',
    items: result,
    amount: 100,
    paymentMethod: 'LINE PAY',
    paymentRecords: [{ method: 'LINE PAY', amount: 100 }],
  });
});
test('Old auto rules require a scanned eligible gift; unmatched scans keep their prices', () => {
  const lone = applyPromotions([item()], products, [bogo]);
  assert.equal(lone.length, 1);
  assert.equal(lone[0].discount, 79);
  assert.equal(lone[0].price, 50);
  const noRule = applyPromotions([item(), item('B')], products, []);
  assert.ok(noRule.every((i) => i.discount === 79));
  const reversed = applyPromotions([item('B'), item()], products, [bogo]);
  assert.equal(total(reversed), 100);
  const removed = applyPromotions([item()], products, [bogo]);
  assert.equal(total(removed), 40);
  const manual = applyPromotions(
    [item(), { ...item('B'), isManual: true }],
    products,
    [bogo],
  );
  assert.equal(manual.length, 2);
  assert.ok(manual.every((i) => !i.promotionGift));
});
test('Scanned mode conserves physical quantity for same and different books', () => {
  const same = applyPromotions([item('A', 3)], products, [
    { ...bogo, giftCode: 'A', giftMode: 'scanned' },
  ]);
  assert.deepEqual(
    same.map((i) => [i.quantity, i.discount]),
    [
      [2, 100],
      [1, 0],
    ],
  );
  const diff = applyPromotions([item(), item('B', 1)], products, [
    { ...bogo, giftMode: 'scanned' },
  ]);
  assert.equal(
    diff.reduce((s, i) => s + i.quantity, 0),
    2,
  );
  assert.equal(total(diff), 100);
});
test('Group quantities cross products and supersede single and website prices without stacking', () => {
  for (const [quantity, discount] of [
    [1, 79],
    [3, 75],
    [6, 69],
  ]) {
    const rows = applyPromotions([item('A', quantity)], products, [tiers]);
    assert.equal(rows[0].price, 100);
    assert.equal(rows[0].discount, discount);
  }
  assert.equal(
    applyPromotions([item('A', 2), item('B', 1)], products, [tiers])[0]
      .discount,
    75,
  );
  assert.equal(
    applyPromotions([item()], products, [
      { ...tiers, tiers: [{ quantity: 1, mode: 'price', value: 23 }] },
    ])[0].price,
    23,
  );
});
test('Priority, inactive dates, manual prices and refunds remain deterministic', () => {
  const now = new Date('2026-09-13T00:00:00Z');
  assert.equal(
    applyPromotions(
      [item()],
      products,
      [{ ...tiers, start: '2026-09-14' }],
      now,
    )[0].price,
    50,
  );
  assert.equal(
    applyPromotions([{ ...item(), isManual: true }], products, [bogo]).length,
    1,
  );
  assert.equal(
    applyPromotions([item('A', -1)], products, [bogo])[0].discount,
    79,
  );
  assert.equal(
    applyPromotions([item(), item('B')], products, [
      { ...tiers, priority: 2 },
      bogo,
    ])[0].promotionId,
    'g',
  );
  assert.throws(() =>
    validatePromotion(
      { ...tiers, tiers: [{ quantity: 1, disabled: true }] },
      products,
    ),
  );
});
test('Church stock sums all valid sales including free gifts, and reverses deleted and refunded quantities', () => {
  const configured = { revision: 'x', quantities: { A: 10, B: 10 } };
  const order = (items) => ({ isValid: true, items });
  const a = {
    state: {
      'order:a': order([
        { code: 'A', quantity: 1 },
        { code: 'B', quantity: 1 },
      ]),
    },
  };
  const b = {
    state: {
      'order:b': order([{ code: 'A', quantity: 2 }]),
      'order:r': order([{ code: 'B', quantity: -1 }]),
    },
  };
  const inventory = churchInventory([a, b], configured);
  assert.equal(inventory.rows.find((r) => r.code === 'A').available, 7);
  assert.equal(inventory.rows.find((r) => r.code === 'B').available, 10);
  delete b.state['order:b'];
  assert.equal(churchInventory([a, b], configured).rows[0].available, 9);
});
test('Official cached promotion mappings contain all seven website products and their selectable gifts', () => {
  const groups = JSON.parse(fs.readFileSync('data/shop-promotions.json'));
  assert.equal(groups.length, 7);
  assert.deepEqual(groups.find((g) => g.codes[0] === 'C212').giftCodes, [
    'C175',
    'C188',
    'C197',
    'C212',
  ]);
});

import { formatDiscount } from '../lib/pos-core.mjs';
test('Taiwan discount labels preserve one decimal and shipment totals round to integer', () => {
  assert.equal(formatDiscount(79), '79 折');
  assert.equal(formatDiscount(88), '88 折');
  assert.equal(formatDiscount(79.5), '79.5 折');
  assert.equal(formatDiscount(100), '原價');
  const rows = applyPromotions([item()], products, [
    { ...tiers, tiers: [{ quantity: 1, mode: 'discount', value: 79.5 }] },
  ]);
  assert.equal(rows[0].discount, 79.5);
  assert.equal(total(rows), 80);
  validateOrder({
    id: 'rounding',
    items: rows,
    amount: 80,
    paymentMethod: 'LINE PAY',
    paymentRecords: [{ method: 'LINE PAY', amount: 80 }],
  });
});
