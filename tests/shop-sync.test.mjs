import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sitemapProducts,
  syncStatus,
  syncShopStep,
} from '../lib/shop-sync.mjs';

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
