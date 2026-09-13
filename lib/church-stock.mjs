export function churchInventory(events, configured) {
  const supplied = { ...(configured?.quantities || {}) },
    sold = {};
  for (const e of events) {
    const state = typeof e.state === 'string' ? JSON.parse(e.state) : e.state;
    if (!configured)
      for (const [key, value] of Object.entries(state))
        if (key.startsWith('stock:'))
          supplied[key.slice(6)] =
            (supplied[key.slice(6)] || 0) + Number(value);
    for (const [key, order] of Object.entries(state))
      if (key.startsWith('order:') && order?.isValid)
        for (const item of order.items || [])
          sold[item.code] = (sold[item.code] || 0) + item.quantity;
  }
  const codes = [...new Set([...Object.keys(supplied), ...Object.keys(sold)])];
  return {
    revision: configured?.revision || '',
    quantities: supplied,
    sold,
    rows: codes.map((code) => ({
      code,
      supplied: supplied[code] || 0,
      sold: sold[code] || 0,
      available: (supplied[code] || 0) - (sold[code] || 0),
    })),
  };
}
export function parseStock(text, products) {
  const result = {};
  const map = new Map(
    products.flatMap((p) => [
      [p.code.toUpperCase(), p.code],
      [String(p.barcode || '').toUpperCase(), p.code],
    ]),
  );
  for (const [index, line] of String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    if (!line.trim()) continue;
    const clean = line.replaceAll('"', '').trim();
    if (
      index === 0 &&
      /商品|code/i.test(clean) &&
      /數量|qty|quantity/i.test(clean)
    )
      continue;
    const m = clean.match(/^([^,，\s]+)[,，\s]+(-?\d+)$/);
    if (!m) throw Error('第 ' + (index + 1) + ' 行請填商品代碼,數量');
    const code = map.get(m[1].toUpperCase()),
      n = Number(m[2]);
    if (!code) throw Error('找不到商品：' + m[1]);
    if (!Number.isSafeInteger(n) || Math.abs(n) > 10000000)
      throw Error('數量超出範圍');
    result[code] = (result[code] || 0) + n;
  }
  if (!Object.keys(result).length) throw Error('請先輸入商品數量');
  return result;
}
