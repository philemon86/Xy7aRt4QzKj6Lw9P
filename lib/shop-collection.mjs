import { parseVariantPrices } from './shop.mjs';
export const HAN_BIBLE_API =
  'https://www.pbooks.com.tw/zh-TW/collections/' +
  encodeURIComponent('漢語聖經九折') +
  '/search_products.json';

// This named collection advertises 9 折. Keep a lower actual selling price;
// never stack another 10% off an already discounted variant.
export function applyHanBibleDiscount(product) {
  return {
    ...product,
    websitePrice: Math.min(product.websitePrice, Math.round(product.listPrice * 0.9)),
    websiteCollectionDiscount: 90,
  };
}

export function parseCollectionPrices(
  rows,
  products,
  now = new Date().toISOString(),
) {
  const known = new Set(products.map((p) => p.code));
  const result = new Map();
  for (const row of rows) {
    if (!row.handle || /[/?#]/.test(row.handle))
      throw Error('官網分類商品網址無效');
    const variants = parseVariantPrices(row.variants_info);
    if (!variants.size) throw Error('官網分類缺少活動售價');
    for (const [code, price] of variants)
      if (known.has(code))
        result.set(code, {
          ...price,
          sourceUrl:
            'https://www.pbooks.com.tw/products/' +
            encodeURIComponent(row.handle),
          image: row.featured_image?.grande
            ? new URL(row.featured_image.grande, 'https://www.pbooks.com.tw')
                .href
            : '',
          syncedAt: now,
        });
  }
  return [...result.values()];
}

export async function syncCollectionPrices(db, config, fetcher = fetch) {
  const products = [];
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const response = await fetcher(HAN_BIBLE_API + '?page=' + page, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error('官網九折分類暫時無法同步');
    const data = await response.json();
    if (
      !Array.isArray(data.products) ||
      !Number.isInteger(data.total_count) ||
      !Number.isInteger(data.total_pages) ||
      data.total_pages < 1 ||
      data.total_pages > 10 ||
      data.current_page !== page
    )
      throw Error('官網九折分類格式變更');
    if (page > 1 && total !== data.total_count)
      throw Error('官網九折分類正在更新，保留快取');
    total = data.total_count;
    products.push(...data.products);
    if (page >= data.total_pages) break;
  }
  if (
    products.length !== total ||
    !total ||
    new Set(products.map((p) => p.id)).size !== total
  )
    throw Error('官網九折分類清單不完整，保留快取');
  const incoming = parseCollectionPrices(products, config.products).map(applyHanBibleDiscount);
  if (!incoming.length) throw Error('官網九折分類尚無對應 CSV 商品');
  const rows = await db.prepare('SELECT code,data FROM shop').all();
  const saved = Object.fromEntries(
    rows.results.map((r) => [r.code, JSON.parse(r.data)]),
  );
  await db.batch(
    incoming.map((p) =>
      db
        .prepare(
          'INSERT INTO shop(code,data) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data',
        )
        .bind(p.code, JSON.stringify({ ...saved[p.code], ...p })),
    ),
  );
  return { count: incoming.length, codes: incoming.map(p => p.code) };
}
