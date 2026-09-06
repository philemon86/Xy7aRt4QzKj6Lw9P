import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { mergeChanges, validateOrder } from '../lib/state.mjs';
import { parseShop } from '../lib/shop.mjs';
const require = createRequire(import.meta.url),
  Pilot = require('../legacy/pilot-exporter.cjs');
test('Parallel cashiers preserve unrelated orders and reject conflicting edits', () => {
  const a = { 'order:a': { amount: 100 } };
  assert.deepEqual(
    mergeChanges(a, [{ key: 'order:b', before: null, after: { amount: 200 } }]),
    { 'order:a': { amount: 100 }, 'order:b': { amount: 200 } },
  );
  assert.throws(
    () =>
      mergeChanges(a, [
        { key: 'order:a', before: { amount: 90 }, after: { amount: 200 } },
      ]),
    /另一台/,
  );
  assert.deepEqual(
    mergeChanges(a, [{ key: 'order:a', before: null, after: { amount: 100 } }]),
    a,
  );
});
test('Server rejects mismatched totals, payments, and unsafe order text', () => {
  const o = {
    id: 'abc',
    items: [
      { code: 'C001', name: '測試', price: 101, quantity: 2, discount: 90 },
    ],
    amount: 182,
    paymentMethod: '現金',
    paymentRecords: [{ method: '現金', amount: 182 }],
  };
  validateOrder(o);
  assert.throws(() => validateOrder({ ...o, amount: 181 }));
  assert.throws(() =>
    validateOrder({ ...o, paymentRecords: [{ method: '現金', amount: 200 }] }),
  );
  validateOrder({
    ...o,
    amount: -182,
    items: [{ ...o.items[0], quantity: -2 }],
    paymentRecords: [{ method: '現金', amount: -182 }],
  });
});
test('The Pilot export implementation is byte-identical to the legacy core', () => {
  const html = fs.readFileSync('legacy/index.html', 'utf8'),
    start = html.indexOf('(function (root, factory)'),
    end = html.indexOf('</script>', start);
  assert.equal(
    fs.readFileSync('legacy/pilot-exporter.cjs', 'utf8'),
    html.slice(start, end),
  );
  assert.equal(typeof Pilot.buildPilotExport, 'function');
});
test('Shop parser preserves both sale and list prices and refuses invalid payloads', () => {
  const html =
    '<script type="application/ld+json">' +
    JSON.stringify({
      '@type': 'Product',
      sku: 'C296',
      name: '測試商品',
      description: 'ISBN：9786269304554',
    }) +
    '</script><script>var productData = ' +
    JSON.stringify([
      { sku: 'C296', price: 899, compare_at_price: 1600, currency: 'TWD' },
    ]) +
    ';</script>';
  const p = parseShop(html, 'https://www.pbooks.com.tw/products/c296')[0];
  assert.equal(p.code, 'C296');
  assert.equal(p.websitePrice, 899);
  assert.equal(p.listPrice, 1600);
  assert.equal(p.webBarcode, '9786269304554');
  assert.throws(() => parseShop('<h1>維護</h1>', 'https://www.pbooks.com.tw'));
});
