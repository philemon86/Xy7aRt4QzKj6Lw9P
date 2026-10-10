import { mergeShopCache, parseShop } from './shop.mjs';
import { applyHanBibleDiscount } from './shop-collection.mjs';

// A selected product can refresh without waiting for the full-site queue.
export async function refreshShopProducts(db, products, initial, codes, fetcher = fetch) {
  if (!Array.isArray(codes) || !codes.length || codes.length > 20 ||
      codes.some(code => !products.some(p => p.code === code))) throw Error('請選擇 1～20 個有效商品');
  const rows = await db.prepare('SELECT code,data FROM shop').all();
  const cache = mergeShopCache(initial, Object.fromEntries(rows.results.map(row => [row.code, JSON.parse(row.data)])));
  const urls = [...new Set(codes.map(code => cache[code]?.sourceUrl))];
  for (const url of urls) {
    const parsed = url && new URL(url);
    if (!parsed || parsed.origin !== 'https://www.pbooks.com.tw' ||
        !parsed.pathname.startsWith('/products/') || parsed.username || parsed.password)
      throw Error('此商品尚未比對官網網址，請先執行全站同步');
  }
  const known = new Set(products.map(p => p.code)), writes = [], updated = [];
  for (const url of urls) {
    // Workers supports manual/follow only; reject redirect responses below.
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error('官網暫時無法讀取，保留既有價格');
    const parsed = parseShop(await response.text(), url);
    if (codes.some(code => cache[code]?.sourceUrl === url && !parsed.some(p => p.code === code)))
      throw Error('官網已移除此商品規格，保留既有價格');
    for (const raw of parsed.filter(p => known.has(p.code))) {
      const p = cache[raw.code]?.websiteCollectionDiscount === 90 ? applyHanBibleDiscount(raw) : raw;
      writes.push(db.prepare('INSERT INTO shop(code,data) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data').bind(p.code, JSON.stringify(p)));
      updated.push(p.code);
    }
  }
  const revision = crypto.randomUUID();
  writes.push(db.prepare("INSERT INTO settings(key,value) VALUES('shop-revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({ revision })));
  await db.batch(writes);
  return { updated, revision };
}
