import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProductCSV,
  mergeProducts,
  composeCatalogProduct,
  defaultPricing,
  validatePriceRule,
} from '../lib/catalog.mjs';
import { resolveProductPricing } from '../lib/pos-core.mjs';
import { validateOrder } from '../lib/state.mjs';
test('PRODUCT CSV preserves quoted names, negative adjustment products and reports blank names', () => {
  const p = parseProductCSV(
    'CODE,CNAME,PRICE1,CLAS,NTAXFLAG\r\nA,"約翰<上>,第二版",100,01,1\r\nR,折抵,-1,POS,0\r\nEMPTY,,0,01,1',
  );
  assert.equal(p.products[0].name, '約翰<上>,第二版');
  assert.equal(p.products[1].price, -1);
  assert.equal(p.skipped[0].code, 'EMPTY');
  assert.throws(
    () =>
      parseProductCSV(
        'CODE,CNAME,PRICE1,CLAS,NTAXFLAG\nA,書,3,01,1\nA,書,3,01,1',
      ),
    /重複/,
  );
  assert.throws(
    () => parseProductCSV('CODE,CNAME,PRICE1,CLAS,NTAXFLAG\nA,<script>,3,01,1'),
    /HTML/,
  );
  const merged = mergeProducts(
    [
      { code: 'A', name: 'old', specialDiscount: 79 },
      { code: 'B', name: 'retain' },
    ],
    p.products,
  );
  assert.equal(merged[0].specialDiscount, 79);
  assert.equal(merged[1].name, 'retain');
});
test('CSV wins names and base prices; legacy singles are integrated with editable rules', () => {
  const csv = {
    code: 'A',
    name: 'CSV書名',
    price: 100,
    class: '01',
    specialDiscount: 79,
    defaultDiscount: 90,
  };
  const result = composeCatalogProduct(
    csv,
    { name: '網站別名', websitePrice: 65, listPrice: 120 },
    defaultPricing([csv]),
  );
  assert.equal(result.name, 'CSV書名');
  assert.equal(result.webName, '網站別名');
  assert.equal(result.price, 100);
  assert.equal(resolveProductPricing(result).defaultDiscount, 79);
});
test('Price order, inclusive Taiwan dates, disabled legacy rules, category fixed prices and zero discounts', () => {
  const p = {
    price: 100,
    websitePrice: 70,
    productRule: {
      mode: 'price',
      value: 50,
      start: '2026-09-12',
      end: '2026-09-12',
    },
    categoryRule: { mode: 'discount', value: 80 },
    specialDiscount: 79,
  };
  assert.equal(
    resolveProductPricing(p, new Date('2026-09-11T16:00:00Z')).price,
    50,
  );
  assert.equal(
    resolveProductPricing(p, new Date('2026-09-12T15:59:59Z')).price,
    50,
  );
  assert.equal(
    resolveProductPricing(p, new Date('2026-09-12T16:00:00Z')).price,
    70,
  );
  assert.equal(
    resolveProductPricing({ ...p, productRule: { disabled: true } }).price,
    70,
  );
  assert.equal(
    resolveProductPricing({
      ...p,
      websitePrice: null,
      productRule: { disabled: true },
    }).defaultDiscount,
    80,
  );
  assert.equal(
    resolveProductPricing({
      ...p,
      websitePrice: null,
      productRule: { disabled: true },
      categoryRule: { mode: 'price', value: 25 },
    }).price,
    25,
  );
  assert.equal(
    resolveProductPricing({ ...p, productRule: { mode: 'discount', value: 0 } })
      .defaultDiscount,
    0,
  );
  assert.equal(
    resolveProductPricing({
      ...p,
      websitePrice: null,
      productRule: { disabled: true },
      categoryRule: { disabled: true },
    }).priceSource,
    'original',
  );
  assert.throws(() => validatePriceRule({ mode: 'discount', value: 101 }));
  assert.throws(() =>
    validatePriceRule({ mode: 'price', value: 1, start: '2026-02-30' }),
  );
  assert.equal(validatePriceRule({ mode: 'price', value: 5 }).end, '');
});
test('Chinese bracketed CSV book names remain valid checkout names without accepting HTML', () => {
  const order = {
    id: 'test',
    items: [
      {
        code: 'A',
        name: '普通書信<來-猶>',
        price: 100,
        quantity: 1,
        discount: 100,
      },
    ],
    amount: 100,
    paymentMethod: 'LINE PAY',
    paymentRecords: [{ method: 'LINE PAY', amount: 100 }],
  };
  assert.equal(validateOrder(order), order);
  assert.throws(() =>
    validateOrder({
      ...order,
      items: [{ ...order.items[0], name: '<img src=x onerror=alert(1)>' }],
    }),
  );
});
