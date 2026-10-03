// Cyberbiz exposes the campaign price separately from productData.price.
// Column 6 is the final selling price, including the campaign, not another discount.
export function parseVariantPrices(info) {
  if (typeof info !== 'string' || !info.trim()) return new Map();
  return new Map(
    info.split('|').map((row) => {
      const fields = row.split(',');
      const code = String(fields[1] || '')
        .trim()
        .toUpperCase();
      const base = Number(fields[2]),
        list = Number(fields[4] || fields[2]),
        price = Number(fields[6]);
      if (
        fields.length < 7 ||
        !/^\d+$/.test(fields[0]) ||
        !code ||
        !fields[2] ||
        !fields[6] ||
        ![base, list, price].every(
          (n) => Number.isFinite(n) && n >= 0 && n <= 9999999,
        )
      )
        throw Error('官網活動售價格式不符，保留原快取');
      return [code, { code, websitePrice: price, listPrice: list }];
    }),
  );
}

export function mergeShopCache(initial, saved) {
  const result = { ...initial };
  for (const [code, product] of Object.entries(saved)) {
    if (
      !result[code] ||
      (Date.parse(product.syncedAt) || 0) >=
        (Date.parse(result[code].syncedAt) || 0)
    )
      result[code] = product;
  }
  return result;
}

export function parseShop(html, url) {
  const ld = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ]
    .flatMap((m) => {
      try {
        return [JSON.parse(m[1])];
      } catch {
        return [];
      }
    })
    .find((x) => x['@type'] === 'Product');
  const match = html.match(/var productData\s*=\s*(\[[^;]*\]);/);
  if (!ld || !match) throw new Error('官網商品格式不符，保留原快取');
  const variants = JSON.parse(match[1]);
  const offerMatch = html.match(/productVariantsInfo:\s*("(?:[^"\\]|\\.)*")/);
  const offerPrices = parseVariantPrices(
    offerMatch ? JSON.parse(offerMatch[1]) : '',
  );
  const og = html.match(
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i,
  )?.[1];
  return variants
    .filter((v) => v.sku)
    .map((v) => {
      const price = Number(v.price),
        list = Number(v.compare_at_price || v.price);
      if (
        !Number.isFinite(price) ||
        price < 0 ||
        !Number.isFinite(list) ||
        list < 0 ||
        v.currency !== 'TWD'
      )
        throw new Error('官網價格不合法');
      return {
        code: String(v.sku).toUpperCase(),
        name: v.name || ld.name,
        websitePrice:
          offerPrices.get(String(v.sku).toUpperCase())?.websitePrice ?? price,
        listPrice: list,
        image: og || ld.image || '',
        sourceUrl: url,
        webBarcode:
          ld.gtin13 ||
          ld.gtin ||
          String(ld.description || '')
            .match(/ISBN[：:]\s*([\d-]+)/)?.[1]
            ?.replaceAll('-', '') ||
          '',
        syncedAt: new Date().toISOString(),
      };
    });
}
