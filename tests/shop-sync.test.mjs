import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sitemapProducts,
  syncStatus,
  syncShopStep,
  dailySyncDue,
} from '../lib/shop-sync.mjs';

test('Taiwan daily sync does not skip the next morning after a late finish', () => {
  const job = { finished: '2026-10-02T04:00:00Z' };
  assert.equal(dailySyncDue(job, Date.parse('2026-10-02T19:00:00Z')), true);
  assert.equal(dailySyncDue(job, Date.parse('2026-10-02T06:00:00Z')), false);
});

test('Sync only accepts official product URLs and rejects empty/incomplete sitemaps', () => {
  assert.deepEqual(
    sitemapProducts(
      '<loc>https://www.pbooks.com.tw/products/a?a=1&amp;b=2</loc><loc>http://127.0.0.1/products/x</loc><loc>https://evil.example/products/a</loc>',
    ),
    ['https://www.pbooks.com.tw/products/a?a=1&b=2'],
  );
  assert.throws(
    () => sitemapProducts('<loc>https://evil.example/products/a</loc>'),
    /不完整/,
  );
  assert.deepEqual(syncStatus({ urls: ['private'], cursor: 3 }), { cursor: 3 });
});

function database(job, busy = false) {
  let saved = structuredClone(job),
    released = false,
    batches = [];
  const db = {
    prepare(sql) {
      const q = {
        sql,
        values: [],
        bind(...v) {
          q.values = v;
          return q;
        },
        async first() {
          return saved ? { value: JSON.stringify(saved) } : null;
        },
        async run() {
          if (sql.startsWith('DELETE')) released = true;
          return { meta: { changes: busy ? 0 : 1 } };
        },
      };
      return q;
    },
    async batch(qs) {
      batches.push(qs);
      for (const q of qs)
        if (q.sql.includes("VALUES('sync',?)")) saved = JSON.parse(q.values[0]);
    },
  };
  return {
    db,
    get saved() {
      return saved;
    },
    get released() {
      return released;
    },
    batches,
  };
}
test('Failure retains cached prices, advances a resumable job, and releases lease', async () => {
  const d = database({
    urls: ['https://www.pbooks.com.tw/products/a'],
    cursor: 0,
    matched: 0,
    failed: 0,
  });
  const r = await syncShopStep(
    d.db,
    { products: [{ code: 'A' }] },
    {},
    async () => new Response('unavailable', { status: 503 }),
  );
  assert.equal(r.failed, 1);
  assert.equal(r.cursor, 1);
  assert.ok(r.finished);
  assert.equal(d.batches[0].length, 1, 'No shop overwrite on failure');
  assert.ok(d.released);
});
test('Concurrent worker returns busy without fetching; completed fresh daily run does not fetch', async () => {
  const d = database(
    { urls: ['https://www.pbooks.com.tw/products/a'], cursor: 0 },
    true,
  );
  assert.equal(
    (
      await syncShopStep(d.db, {}, {}, () => {
        throw Error('must not fetch');
      })
    ).busy,
    true,
  );
  const fresh = database({
    promotionsAttempted: true,
    collectionPricesAttempted: true,
    collectionPrices: {codes: []},
    finished: new Date().toISOString(),
    urls: ['https://www.pbooks.com.tw/products/a'],
    cursor: 1,
  });
  assert.equal(
    (
      await syncShopStep(fresh.db, {}, { daily: true }, () => {
        throw Error('must not fetch');
      })
    ).skipped,
    true,
  );
  assert.ok(fresh.released);
});

test('Explicit refresh restarts a finished daily job and preserves resumable failure handling', async () => {
  const oldFinish = new Date().toISOString();
  const d = database({
    finished: oldFinish,
    cursor: 99,
    matched: 99,
    failed: 0,
    urls: ['https://www.pbooks.com.tw/products/old'],
    promotionsAttempted: true,
    collectionPricesAttempted: true,
  });
  const requests = [];
  const result = await syncShopStep(
    d.db,
    { products: [] },
    { daily: true, restart: true },
    async (url) => {
      requests.push(url);
      if (url.endsWith('/sitemap.xml'))
        return new Response(
          '<loc>https://www.pbooks.com.tw/products/new</loc>',
        );
      return new Response('unavailable', { status: 503 });
    },
  );
  assert.equal(result.skipped, undefined);
  assert.equal(result.cursor, 1);
  assert.equal(result.matched, 0);
  assert.equal(result.failed, 1);
  assert.ok(result.finished);
  assert.deepEqual(d.saved.urls, ['https://www.pbooks.com.tw/products/new']);
  assert.ok(requests.includes('https://www.pbooks.com.tw/sitemap.xml'));
  assert.ok(requests.includes('https://www.pbooks.com.tw/products/new'));
  assert.ok(d.released);
});
