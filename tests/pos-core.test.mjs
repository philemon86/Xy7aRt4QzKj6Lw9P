import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  resolveProductPricing,
  editCartItem,
  evaluateExpression,
  insertOperand,
  createScanGate,
} from '../lib/pos-core.mjs';
import { stats, validateOrder } from '../lib/state.mjs';
const base = {
  code: 'C291',
  name: '測試',
  price: 300,
  listPrice: 300,
  defaultDiscount: 80,
  specialDiscount: 79,
};
test('Price precedence: individual setting including legacy, website, category, original', () => {
  let p = resolveProductPricing({ ...base, websitePrice: 200 });
  assert.deepEqual(
    [p.price, p.defaultDiscount, p.priceSource],
    [300, 79, 'legacy-special'],
  );
  p = resolveProductPricing({ ...base, websitePrice: 300 });
  assert.deepEqual(
    [p.price, p.defaultDiscount, p.priceSource],
    [300, 79, 'legacy-special'],
  );
  p = resolveProductPricing({
    ...base,
    specialDiscount: undefined,
    websitePrice: 320,
    listPrice: 320,
  });
  assert.deepEqual(
    [p.price, p.defaultDiscount, p.priceSource],
    [320, 100, 'website'],
  );
  p = resolveProductPricing({ ...base, websitePrice: null });
  assert.deepEqual(
    [p.price, p.defaultDiscount, p.priceSource],
    [300, 79, 'legacy-special'],
  );
  p = resolveProductPricing({
    ...base,
    specialDiscount: undefined,
    websitePrice: null,
  });
  assert.deepEqual(
    [p.price, p.defaultDiscount, p.priceSource],
    [300, 80, 'legacy'],
  );
  assert.equal(
    resolveProductPricing({
      ...base,
      specialDiscount: undefined,
      websitePrice: 0,
    }).price,
    0,
  );
  assert.equal(
    resolveProductPricing({ ...base, websitePrice: -10 }).price,
    300,
  );
});
test('All cached products resolve to valid prices; sold order snapshots remain untouched', () => {
  const data = JSON.parse(fs.readFileSync('data/catalog.json', 'utf8'));
  const cache = JSON.parse(fs.readFileSync('data/shop-cache.json', 'utf8'));
  for (const base of data.products) {
    const p = resolveProductPricing({ ...base, ...cache[base.code] });
    assert.ok(
      Number.isFinite(p.price) && Math.abs(p.price) <= 9999999,
      base.code,
    );
    assert.ok(p.defaultDiscount >= 0 && p.defaultDiscount <= 100, base.code);
  }
  const original = { ...base, quantity: 2, discount: 79 };
  const before = JSON.stringify(original);
  editCartItem(original, { price: '100.5', quantity: '3', discount: '90' });
  assert.equal(JSON.stringify(original), before);
});
test('Manual cart edits support sale-price overrides, fractional prices, refunds and zero discounts', () => {
  const product = resolveProductPricing({ ...base, websitePrice: 200 });
  const item = editCartItem(product, {
    price: '120.5',
    quantity: '-2',
    discount: '90',
  });
  assert.deepEqual(
    [item.price, item.quantity, item.discount, item.isManual],
    [120.5, -2, 90, true],
  );
  assert.equal(
    editCartItem(product, { price: '0', quantity: '1', discount: '0' })
      .discount,
    0,
  );
  for (const values of [
    { price: '', quantity: 1, discount: 100 },
    { price: 1, quantity: 1.5, discount: 100 },
    { price: 1, quantity: 1, discount: 101 },
    { price: Infinity, quantity: 1, discount: 100 },
  ])
    assert.throws(() => editCartItem(product, values));
  const voucher = editCartItem(product, {
    price: -50,
    quantity: 1,
    discount: 100,
  });
  validateOrder({
    id: 'voucher',
    items: [voucher],
    amount: -50,
    paymentMethod: '現金退款',
    paymentRecords: [{ method: '現金', amount: -50 }],
  });
});
test('Calculator respects precedence, signs and decimals, and rejects unsafe/incomplete input', () => {
  const cases = [
    ['1000−250×2', 500],
    ['(1000-100)÷3', 300],
    ['-5*-2+0.1+0.2', 10.3],
    ['0', 0],
    ['1/3', 0.333333333333],
  ];
  for (const [input, expected] of cases)
    assert.equal(evaluateExpression(input), expected);
  for (const input of [
    '1/0',
    '(1+2',
    '1+',
    '1 2',
    '1;alert(1)',
    '2**3',
    '9'.repeat(300),
  ]) {
    assert.throws(() => evaluateExpression(input));
  }
  assert.equal(insertOperand('100×', 900), '100×900');
  assert.equal(insertOperand('100', -50), '100+(-50)');
});
test('Cash reference includes split payments and refunds and excludes voided sales without writes', () => {
  const state = {
    'order:a': {
      isValid: true,
      amount: 1000,
      items: [],
      paymentRecords: [
        { method: '文化幣', amount: 600 },
        { method: '現金', amount: 400 },
      ],
    },
    'order:b': {
      isValid: true,
      amount: -100,
      items: [],
      paymentRecords: [{ method: '現金', amount: -100 }],
    },
    'order:c': {
      isValid: false,
      amount: 500,
      items: [],
      paymentRecords: [{ method: '現金', amount: 500 }],
    },
  };
  const before = JSON.stringify(state);
  assert.equal(stats(state).payments['現金'], 300);
  assert.equal(
    evaluateExpression(insertOperand('11000+', stats(state).payments['現金'])),
    11300,
  );
  assert.equal(JSON.stringify(state), before);
});
test('Camera suppresses frames of the same barcode, accepts a new item and re-entry', () => {
  const gate = createScanGate();
  assert.equal(gate('C296', 0), true);
  for (const now of [90, 180, 600, 1200, 1800])
    assert.equal(gate('C296', now), false);
  assert.equal(gate('C291', 1900), true);
  assert.equal(gate('C296', 2000), true);
  assert.equal(gate('C296', 3100), true);
});
test('Generated register scripts parse and manual discount overrides preset specials on repeat scans', () => {
  const html = fs.readFileSync('public/register.html', 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))
    new vm.Script(match[1]);
  const start = html.indexOf('      const getSpecialDiscount =');
  const end = html.indexOf('      const resetIdleTimer', start);
  const context = {
    SPECIAL_DISCOUNT_MAP: { C291: 79 },
    sessionRules: { A: 90 },
  };
  vm.createContext(context);
  vm.runInContext(
    html.slice(start, end) + '\nglobalThis.discount=calculateItemDiscount;',
    context,
  );
  assert.equal(
    context.discount({ ...base, class: 'A', discount: 60, isManual: true }),
    60,
  );
  assert.equal(
    context.discount({
      ...resolveProductPricing({ ...base, websitePrice: 200 }),
      class: 'A',
      isManual: false,
    }),
    79,
  );
  assert.equal(
    context.discount({
      ...resolveProductPricing(base),
      class: 'A',
      isManual: false,
    }),
    79,
  );
});

test('Scan success adds once; lookup failures and busy state only emit feedback', () => {
  const source = fs.readFileSync('scripts/register-search.js', 'utf8');
  const start = source.indexOf('function addScannedProduct('),
    end = source.indexOf('function favoriteButton(', start);
  const cart = [],
    notices = [];
  const context = {
    cart,
    products: { C291: base },
    cloud: { event: { status: 'open' } },
    checkoutBusy: false,
    editDialog: { open: false },
    parseProductInput: () => null,
    feedback: (...args) => notices.push(args),
    addProductToCart: () => cart.push({ ...base, quantity: 1 }),
    productCodeInput: { value: '' },
    searchResultsElement: { replaceChildren() {} },
    clearTimeout() {},
    searchTimer: null,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  context.addScannedProduct('unknown', true);
  assert.equal(cart.length, 0);
  assert.equal(notices.at(-1)[0], false);
  context.addScannedProduct('c291', true);
  assert.equal(cart.length, 1);
  assert.equal(notices.at(-1)[0], true);
  const before = JSON.stringify(cart);
  context.checkoutBusy = true;
  context.addScannedProduct('C291', true);
  assert.equal(JSON.stringify(cart), before);
  assert.equal(notices.at(-1)[0], false);
});

test('Favorite star changes shared favorites without adding a sale or changing quantities', () => {
  const source = fs.readFileSync('scripts/register-search.js', 'utf8');
  const start = source.indexOf('function favoriteButton('),
    end = source.indexOf('function renderFavorites(', start);
  const persisted = {};
  const context = {
    favorites: [],
    document: { createElement: () => ({ setAttribute() {} }) },
    cloud: { event: { status: 'open' } },
    readFavorites() {},
    localStorage: { setItem: (k, v) => (persisted[k] = v) },
    renderFavorites() {},
    renderSearch() {},
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  context.favoriteButton(base).onclick();
  assert.equal(persisted.favorites, '["C291"]');
  context.favoriteButton(base).onclick();
  assert.equal(persisted.favorites, '[]');
});
