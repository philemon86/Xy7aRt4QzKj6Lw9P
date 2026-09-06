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
        websitePrice: price,
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
