import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { refreshShopProducts } from '../lib/shop-product-refresh.mjs';
import { resolveProductPricing, refreshAutomaticCartPrices, cartTotal } from '../lib/pos-core.mjs';

const page = variants => '<script type="application/ld+json">{"@type":"Product","name":"商品"}</script><script>var productData = '+JSON.stringify(variants)+';</script>';
const url = 'https://www.pbooks.com.tw/products/oij204205206';
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE shop(code TEXT PRIMARY KEY,data TEXT); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);');
  const db = { prepare(sql) { const q = sqlite.prepare(sql); let args=[]; return { bind(...values) { args=values; return this; }, async all() { return { results:q.all(...args) }; }, async run() { return q.run(...args); } }; }, async batch(qs) { sqlite.exec('BEGIN'); try { for(const q of qs) await q.run(); sqlite.exec('COMMIT'); } catch(e) { sqlite.exec('ROLLBACK'); throw e; } } };
  return { db, sqlite };
}
test('Single-product refresh updates official sibling SKUs atomically, preserves unrelated prices and bumps version', async () => {
  const {db,sqlite}=database();
  const products=[{code:'OIJ204'},{code:'OIJ205'},{code:'OTHER'}];
  const initial={OIJ204:{sourceUrl:url,websitePrice:99},OIJ205:{sourceUrl:url,websitePrice:99}};
  sqlite.prepare('INSERT INTO shop VALUES(?,?)').run('OTHER',JSON.stringify({websitePrice:50}));
  const result=await refreshShopProducts(db,products,initial,['OIJ204'],async source=>{
    assert.equal(source,url);
    return new Response(page(['OIJ204','OIJ205','UNKNOWN'].map(sku=>({sku,price:108,compare_at_price:120,currency:'TWD'}))));
  });
  assert.deepEqual(result.updated,['OIJ204','OIJ205']);
  assert.equal(JSON.parse(sqlite.prepare('SELECT data FROM shop WHERE code=?').get('OIJ205').data).websitePrice,108);
  assert.equal(JSON.parse(sqlite.prepare('SELECT data FROM shop WHERE code=?').get('OTHER').data).websitePrice,50);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM shop').get().n,3);
  assert.equal(JSON.parse(sqlite.prepare("SELECT value FROM settings WHERE key='shop-revision'").get().value).revision,result.revision);
  sqlite.close();
});
test('Refresh rejects unknown/unsafe URLs, failed pages and missing SKUs without overwriting cache', async () => {
  for(const scenario of ['unknown','unsafe','failed','missing']) {
    const {db,sqlite}=database();
    const initial={A:{sourceUrl:scenario==='unsafe'?'https://evil.test/products/a':url,websitePrice:99}};
    let fetches=0;
    await assert.rejects(refreshShopProducts(db,[{code:'A'}],initial,[scenario==='unknown'?'BAD':'A'],async()=>{
      fetches++;return scenario==='failed'?new Response('',{status:503}):new Response(page([{sku:'B',price:108,currency:'TWD'}]));
    }));
    if(['unknown','unsafe'].includes(scenario)) assert.equal(fetches,0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM shop').get().n,0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM settings').get().n,0);
    sqlite.close();
  }
});
test('Automatic cart follows 99 to 108 while manual prices, free gifts, quantities and saved orders stay intact', () => {
  const products={A:resolveProductPricing({code:'A',price:120,websitePrice:108})};
  const items=[{code:'A',price:99,quantity:2,discount:100,priceSource:'website'},
    {code:'A',price:88,quantity:1,discount:100,isManual:true},
    {code:'A',price:99,quantity:1,discount:0,promotionGift:true}];
  const before=structuredClone(items), savedOrder=structuredClone(items);
  const updated=refreshAutomaticCartPrices(items,products);
  assert.equal(updated[0].price,108);
  assert.equal(updated[0].quantity,2);
  assert.equal(cartTotal(updated),304);
  assert.equal(updated[1],items[1]);assert.equal(updated[2],items[2]);
  assert.deepEqual(items,before);assert.deepEqual(savedOrder,before);
  assert.equal(refreshAutomaticCartPrices(updated,products)[0],updated[0]);
});
