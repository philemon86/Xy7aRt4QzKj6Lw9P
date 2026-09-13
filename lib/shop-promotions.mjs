export const BOGO_URL =
  'https://www.pbooks.com.tw/collections/' + encodeURIComponent('買一送一專區');
export const BOGO_API =
  'https://www.pbooks.com.tw/zh-TW/collections/' +
  encodeURIComponent('買一送一專區') +
  '/search_products.json';
export function parseShopPromotions(rows, products) {
  const known = new Set(products.map((p) => p.code));
  return rows.map((p) => {
    const code = String(p.first_variant_sku || '').split('/')[0];
    const giftCodes = [
      ...new Set(
        [
          ...String(p.variants_info || '').matchAll(/贈([A-Z]+\d+[A-Z0-9-]*)/g),
        ].map((m) => m[1]),
      ),
    ];
    if (
      !known.has(code) ||
      !giftCodes.length ||
      giftCodes.some((c) => !known.has(c))
    )
      throw Error('官網買一送一商品或贈品尚未存在 CSV：' + code);
    return {
      id: 'website-bogo-' + code,
      name: '官網買一送一 · ' + code,
      type: 'bogo',
      codes: [code],
      giftCode: giftCodes[0],
      giftCodes,
      giftMode: 'auto',
      priority: 100,
      start: '',
      end: '',
      disabled: false,
      origin: 'website',
      sourceUrl: BOGO_URL,
    };
  });
}
