import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { searchProducts } from '../lib/pos-core.mjs';

const codes = (items) => items.map((p) => p.code);
test('Exact code leads prefix and embedded matches, regardless of original catalog order or case', () => {
  const items = [
    'CUNP63A',
    'LLP669',
    'P6-10',
    'P61',
    'P6',
    'P6-2',
    'AP6',
    'P60',
  ].map((code) => ({ code, name: '商品' }));
  assert.deepEqual(codes(searchProducts(items, ' p6 ')), [
    'P6',
    'P60',
    'P61',
    'P6-2',
    'P6-10',
    'AP6',
    'LLP669',
    'CUNP63A',
  ]);
  assert.deepEqual(
    codes(searchProducts(items, 'Ｐ６')),
    codes(searchProducts(items, 'p6')),
  );
});
test('An exact barcode is not buried among partial codes and names', () => {
  const items = [
    { code: '4711234000' },
    { code: 'BOOK', webBarcode: '4711234' },
    { code: 'XYZ', name: '4711234 商品' },
  ];
  assert.deepEqual(codes(searchProducts(items, '4711234')), [
    'BOOK',
    '4711234000',
    'XYZ',
  ]);
});
test('Name, CSV name, website name and multiple terms remain searchable without mutating products', () => {
  const items = [
    { code: 'B10', name: '其他', csvName: '漢語 聖經' },
    { code: 'B2', name: '漢語 聖經' },
    { code: 'B3', webName: '漢語聖經' },
  ];
  const before = structuredClone(items);
  assert.deepEqual(codes(searchProducts(items, '漢語 聖經')), [
    'B2',
    'B10',
    'B3',
  ]);
  assert.equal(searchProducts(items, '不存在').length, 0);
  assert.equal(searchProducts(items, ' ').length, 0);
  assert.equal(searchProducts([items[1], items[1]], '漢語').length, 1);
  assert.deepEqual(items, before);
});
test('The real P6 product leads the current CSV catalog matches and retains its product identity', () => {
  const { products } = JSON.parse(fs.readFileSync('data/catalog.json', 'utf8'));
  const found = searchProducts(products, 'p6');
  assert.ok(found.length > 1);
  assert.equal(found[0].code, 'P6');
  assert.equal(
    found[0],
    products.find((p) => p.code === 'P6'),
  );
});
