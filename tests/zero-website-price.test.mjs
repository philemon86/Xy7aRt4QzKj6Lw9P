import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseShop, parseVariantPrices } from '../lib/shop.mjs';
import { parseCollectionPrices } from '../lib/shop-collection.mjs';
import { composeCatalogProduct } from '../lib/catalog.mjs';
import {
  resolveProductPricing,
  repairWebsiteZeroCart,
} from '../lib/pos-core.mjs';
import { repairZeroShopPrices } from '../lib/shop-repair.mjs';

const info =
  '81245541,S046F,25.0,,30.0,deny,0.0,聖靈運行在臺灣,公益系列／A5線條筆記本,,|51737472,PH05,280.0,,350.0,deny,0.0,,不怕黑夜行的瘟疫,,|1,PROMO,330,,330,deny,297';
const html = (variants, prices = info) =>
  '<script type="application/ld+json">{"@type":"Product","name":"商品"}</script><script>var productData = ' +
  JSON.stringify(variants) +
  ';const config={productVariantsInfo: ' +
  JSON.stringify(prices) +
  '};</script>';

test('The real S046F and PH05 no-campaign zeros retain official selling prices; real campaigns remain active', () => {
  const parsed = parseShop(
    html([
      { sku: 'S046F', price: 25, compare_at_price: 30, currency: 'TWD' },
      { sku: 'PH05', price: 280, compare_at_price: 350, currency: 'TWD' },
      { sku: 'PROMO', price: 330, compare_at_price: 330, currency: 'TWD' },
    ]),
    'https://www.pbooks.com.tw/products/s046f',
  );
  assert.deepEqual(
    parsed.map((p) => p.websitePrice),
    [25, 280, 297],
  );
  const collection = parseCollectionPrices(
    [{ handle: 'example', variants_info: info }],
    [{ code: 'S046F' }, { code: 'PH05' }, { code: 'PROMO' }],
  );
  assert.deepEqual(
    collection.map((p) => p.websitePrice),
    [25, 280, 297],
  );
  assert.ok(parsed.every((p) => p.websiteZeroConfirmed === false));
});

test('Empty website prices are rejected; actual zero base prices require explicit confirmation', () => {
  for (const price of ['', null, undefined])
    assert.throws(
      () => parseShop(html([{ sku: 'A', price, currency: 'TWD' }], '')),
      /價格不合法/,
    );
  const free = parseShop(
    html(
      [{ sku: 'FREE', price: 0, compare_at_price: 10, currency: 'TWD' }],
      '2,FREE,0,,10,deny,0',
    ),
    'https://www.pbooks.com.tw/products/free',
  )[0];
  assert.equal(free.websitePrice, 0);
  assert.equal(free.websiteZeroConfirmed, true);
  assert.equal(
    parseVariantPrices('3,A,25,,30,deny,0').get('A').websitePrice,
    25,
  );
  assert.throws(() => parseVariantPrices('3,A,25,,30,deny, '));
});

test('Unconfirmed old zero caches fall back to existing pricing, without blocking manual/free-gift zero prices', () => {
  const csv = { code: 'A', price: 100, class: '01' };
  const pricing = {
    products: {},
    classes: { '01': { mode: 'discount', value: 80 } },
  };
  const composed = composeCatalogProduct(
    csv,
    { websitePrice: 0, listPrice: 100 },
    pricing,
  );
  assert.equal(composed.websitePrice, null);
  const p = resolveProductPricing(composed);
  assert.equal(p.price, 100);
  assert.equal(p.defaultDiscount, 80);
  assert.equal(p.priceSource, 'legacy');
  assert.equal(resolveProductPricing({ ...csv, websitePrice: 0 }).price, 100);
  assert.equal(
    resolveProductPricing({
      ...csv,
      websitePrice: 0,
      websiteZeroConfirmed: true,
    }).price,
    0,
  );
  assert.equal(
    resolveProductPricing({
      ...csv,
      websitePrice: 0,
      productRule: { mode: 'price', value: 0 },
    }).price,
    0,
  );
});

test('Unfinished automatic zero-priced cart lines recover without mutating manual prices, gifts, discounts or original items', () => {
  const items = [
    {
      code: 'S046F',
      price: 0,
      quantity: 2,
      discount: 100,
      priceSource: 'website',
    },
    {
      code: 'S046F',
      price: 0,
      quantity: 1,
      discount: 100,
      priceSource: 'website',
      isManual: true,
    },
    {
      code: 'S046F',
      price: 0,
      quantity: 1,
      discount: 0,
      priceSource: 'website',
    },
    {
      code: 'S046F',
      price: 0,
      quantity: 1,
      discount: 100,
      priceSource: 'group',
      promotionGift: true,
    },
    {
      code: 'S046F',
      price: 20,
      quantity: 1,
      discount: 100,
      priceSource: 'website',
    },
  ];
  const before = JSON.stringify(items);
  const result = repairWebsiteZeroCart(items, {
    S046F: {
      price: 25,
      defaultDiscount: 100,
      priceSource: 'website',
      priceLabel: '官網售價',
    },
  });
  assert.equal(result[0].price, 25);
  assert.equal(result[0].quantity, 2);
  result.slice(1).forEach((p, i) => assert.equal(p, items[i + 1]));
  assert.equal(JSON.stringify(items), before);
});

test('Production zero cache repair persists corrected prices and cannot overwrite confirmed free items or concurrent changes', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE shop(code TEXT PRIMARY KEY,data TEXT)');
  const old = { websitePrice: 0, syncedAt: '2026-10-08T03:00:00Z' };
  for (const code of ['S046F', 'PH05', 'FREE', 'CONCURRENT'])
    sqlite
      .prepare('INSERT INTO shop VALUES(?,?)')
      .run(
        code,
        JSON.stringify({ ...old, code, websiteZeroConfirmed: code === 'FREE' }),
      );
  let changed = false;
  const db = {
    prepare(sql) {
      let values = [];
      return {
        bind(...v) {
          values = v;
          return this;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...values) };
        },
        async first() {
          return sqlite.prepare(sql).get(...values);
        },
        async run() {
          return {
            meta: {
              changes: Number(sqlite.prepare(sql).run(...values).changes),
            },
          };
        },
      };
    },
    async batch(queries) {
      if (!changed) {
        changed = true;
        sqlite
          .prepare('UPDATE shop SET data=? WHERE code=?')
          .run(
            JSON.stringify({ code: 'CONCURRENT', websitePrice: 99 }),
            'CONCURRENT',
          );
      }
      return Promise.all(queries.map((q) => q.run()));
    },
  };
  const verified = Object.fromEntries(
    ['S046F', 'PH05', 'FREE', 'CONCURRENT'].map((code) => [
      code,
      {
        code,
        websitePrice: code === 'PH05' ? 280 : 25,
        syncedAt: '2026-10-08T04:00:00Z',
      },
    ]),
  );
  const result = await repairZeroShopPrices(db, verified);
  assert.deepEqual(result, { repaired: 2, remainingInvalidZero: 0 });
  const read = (code) =>
    JSON.parse(
      sqlite.prepare('SELECT data FROM shop WHERE code=?').get(code).data,
    );
  assert.equal(read('S046F').websitePrice, 25);
  assert.equal(read('PH05').websitePrice, 280);
  assert.equal(read('FREE').websitePrice, 0);
  assert.equal(read('CONCURRENT').websitePrice, 99);
  sqlite.close();
});

test('Every affected cache entry has been checked and the bundled correction contains no accidental zero', () => {
  const report = JSON.parse(
    fs.readFileSync('data/shop-price-repair-report.json', 'utf8'),
  );
  const cache = JSON.parse(fs.readFileSync('data/shop-cache.json', 'utf8'));
  assert.equal(report.affected, 482);
  assert.equal(report.repaired, 482);
  assert.equal(cache.S046F.websitePrice, 25);
  assert.equal(cache.PH05.websitePrice, 280);
  assert.ok(
    report.correctedCodes.every((code) => cache[code].websitePrice > 0),
  );
});
