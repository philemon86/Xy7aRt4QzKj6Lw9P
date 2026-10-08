import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShop, parseVariantPrices, mergeShopCache } from '../lib/shop.mjs';
import {
  parseCollectionPrices,
  syncCollectionPrices,
  applyHanBibleDiscount,
} from '../lib/shop-collection.mjs';
import { resolveProductPricing } from '../lib/pos-core.mjs';
const info =
  '51726869,CAT6991,330.0,,330.0,deny,297.0,,五經 - ,,|52223195,CCT12901,1350.0,,1500.0,deny,1350.0,,研讀本 - ,,';
const row = { id: 1, handle: 'cat6991', variants_info: info };
const known = [{ code: 'CAT6991' }, { code: 'CCT12901' }];
test('Website variant prices ignore the loyalty redemption cap; Hanyu collection discount does not stack', () => {
  const prices = parseVariantPrices(info);
  assert.equal(prices.get('CAT6991').websitePrice, 330);
  assert.equal(prices.get('CCT12901').websitePrice, 1350);
  const html =
    '<script type="application/ld+json">{"@type":"Product","name":"五經"}</script><script>var productData = ' +
    JSON.stringify([
      { sku: 'CAT6991', price: 330, compare_at_price: 330, currency: 'TWD' },
      { sku: 'CCT12901', price: 1350, compare_at_price: 1500, currency: 'TWD' },
    ]) +
    ';const x={productVariantsInfo: ' +
    JSON.stringify(info) +
    '};</script>';
  const parsed = parseShop(html, 'https://www.pbooks.com.tw/products/cat6991');
  assert.deepEqual(
    parsed.map((p) => p.websitePrice),
    [330, 1350],
  );
  assert.equal(
    resolveProductPricing({
      price: 330,
      websitePrice: applyHanBibleDiscount(parsed[0]).websitePrice,
      categoryRule: { mode: 'discount', value: 90 },
    }).price,
    297,
  );
  assert.equal(
    resolveProductPricing({
      price: 330,
      websitePrice: 297,
      productRule: { mode: 'price', value: 200 },
    }).price,
    200,
  );
});
test('Price payloads reject broken amounts and collection SKUs remain limited to the CSV', () => {
  assert.throws(() => parseVariantPrices('51726869,CAT6991,NaN,,330,deny,0'));
  assert.throws(() => parseVariantPrices('51726869,CAT6991,-1,,330,deny,0'));
  assert.equal(parseVariantPrices('51726869,CAT6991,330,,330,deny,NaN').get('CAT6991').websitePrice,330);
  assert.deepEqual(
    parseCollectionPrices([row], [known[0]]).map((p) => p.code),
    ['CAT6991'],
  );
});
test('The new bundled correction beats an old DB cache; future synced prices win normally', () => {
  const initial = {
    A: { websitePrice: 297, syncedAt: '2026-10-03T06:00:00Z' },
  };
  assert.equal(
    mergeShopCache(initial, {
      A: { websitePrice: 330, syncedAt: '2026-10-02T06:00:00Z' },
    }).A.websitePrice,
    297,
  );
  assert.equal(
    mergeShopCache(initial, {
      A: { websitePrice: 290, syncedAt: '2026-10-04T06:00:00Z' },
    }).A.websitePrice,
    290,
  );
});
test('Incomplete collection pagination never overwrites cached prices; complete sync preserves barcode', async () => {
  const writes = [];
  const db = {
    prepare(sql) {
      const q = {
        sql,
        bind(...values) {
          q.values = values;
          return q;
        },
        async all() {
          return {
            results: [
              {
                code: 'CAT6991',
                data: JSON.stringify({ webBarcode: '9789625139913' }),
              },
            ],
          };
        },
      };
      return q;
    },
    async batch(rows) {
      writes.push(...rows);
    },
  };
  const fetcher = async () =>
    Response.json({
      total_count: 2,
      total_pages: 1,
      current_page: 1,
      products: [row],
    });
  await assert.rejects(
    () => syncCollectionPrices(db, { products: known }, fetcher),
    /不完整/,
  );
  assert.equal(writes.length, 0);
  const result = await syncCollectionPrices(db, { products: known }, async () =>
    Response.json({
      total_count: 1,
      total_pages: 1,
      current_page: 1,
      products: [row],
    }),
  );
  assert.equal(result.count, 2);
  const saved = JSON.parse(writes[0].values[1]);
  assert.equal(saved.websitePrice, 297);
  assert.equal(saved.webBarcode, '9789625139913');
});
