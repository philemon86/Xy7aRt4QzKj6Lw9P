export function parseProductCSV(text) {
  const rows = [];
  let row = [],
    value = '',
    quoted = false;
  text = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"') {
      if (value) throw Error('CSV 引號格式錯誤');
      quoted = true;
    } else if (c === ',') {
      row.push(value);
      value = '';
    } else if (c === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (c !== '\r') value += c;
  }
  if (quoted) throw Error('CSV 有未結束的引號');
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const headers = (rows.shift() || []).map((s) => s.trim().toUpperCase());
  for (const key of ['CODE', 'CNAME', 'PRICE1', 'CLAS', 'NTAXFLAG'])
    if (!headers.includes(key)) throw Error('PRODUCT.csv 缺少欄位 ' + key);
  const seen = new Set(),
    skipped = [];
  const products = rows
    .filter((r) => r.some((v) => v.trim()))
    .map((r, index) => {
      if (r.length !== headers.length)
        throw Error('CSV 第 ' + (index + 2) + ' 行欄位數不符');
      const p = Object.fromEntries(headers.map((h, i) => [h, r[i].trim()]));
      if (
        !p.CODE ||
        ['__proto__', 'constructor', 'prototype'].includes(p.CODE) ||
        ['__proto__', 'constructor', 'prototype'].includes(p.CLAS) ||
        /[<>]/.test(p.CODE) ||
        p.CODE.length > 100 ||
        p.CNAME.length > 300
      )
        throw Error('CSV 第 ' + (index + 2) + ' 行代碼或名稱無效');
      if (!p.CNAME) {
        skipped.push({
          line: index + 2,
          code: p.CODE,
          reason: '名稱空白，保留原資料',
        });
        return null;
      }
      if (/[<>]/.test(p.CNAME.replace(/<[\u3400-\u9fff-]+>/g, '')))
        throw Error('CSV 商品名稱含不支援的 HTML：' + p.CODE);
      if (seen.has(p.CODE)) throw Error('CSV 商品代碼重複：' + p.CODE);
      seen.add(p.CODE);
      if (
        !p.PRICE1 ||
        !Number.isFinite(Number(p.PRICE1)) ||
        Math.abs(Number(p.PRICE1)) > 9999999 ||
        !['0', '1'].includes(p.NTAXFLAG)
      )
        throw Error('CSV 商品 ' + p.CODE + ' 原價或稅別無效');
      const cost = Number(p.CCOST || 0);
      if (!Number.isFinite(cost)) throw Error('CSV 成本無效：' + p.CODE);
      return {
        code: p.CODE,
        name: p.CNAME,
        barcode: p.BARCODE || '',
        class: p.CLAS,
        kind: p.KIND || '',
        unit: p.UNIT || '',
        unitCode: p.UNIT || '',
        ntaxFlag: p.NTAXFLAG,
        cost,
        price: Number(p.PRICE1),
        listPrice: Number(p.PRICE1),
      };
    })
    .filter(Boolean);
  if (!products.length || products.length > 10000)
    throw Error('CSV 須包含 1～10,000 件商品');
  return { products, skipped };
}
export function mergeProducts(existing, updates) {
  const map = new Map(existing.map((p) => [p.code, p]));
  for (const p of updates) map.set(p.code, { ...map.get(p.code), ...p });
  return [...map.values()];
}
export function defaultPricing(products) {
  const rules = { products: {}, classes: {} };
  for (const p of products) {
    if (p.specialDiscount != null)
      rules.products[p.code] = {
        mode: 'discount',
        value: Number(p.specialDiscount),
        start: '',
        end: '',
        origin: 'legacy',
      };
    if (p.class && p.defaultDiscount != null)
      rules.classes[p.class] = {
        mode: 'discount',
        value: Number(p.defaultDiscount),
        start: '',
        end: '',
        origin: 'legacy',
      };
  }
  return rules;
}
export function validatePriceRule(rule) {
  if (rule?.disabled === true) return { disabled: true };
  if (
    !rule ||
    !['price', 'discount'].includes(rule.mode) ||
    String(rule.value).trim() === '' ||
    !Number.isFinite(Number(rule.value)) ||
    Number(rule.value) < 0 ||
    Number(rule.value) > (rule.mode === 'discount' ? 100 : 9999999)
  )
    throw Error('請輸入有效的折扣百分比或單價');
  for (const day of [rule.start, rule.end])
    if (
      day &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isFinite(Date.parse(day)) ||
        new Date(day).toISOString().slice(0, 10) !== day)
    )
      throw Error('有效日期不存在');
  if (rule.start && rule.end && rule.start > rule.end)
    throw Error('結束日期不可早於開始日期');
  return {
    mode: rule.mode,
    value: Number(rule.value),
    start: rule.start || '',
    end: rule.end || '',
    origin: 'custom',
  };
}
export function composeCatalogProduct(csv, web, rules) {
  return {
    ...csv,
    image: web?.image || csv.image || '',
    websitePrice: web?.websitePrice ?? null,
    websiteListPrice: web?.listPrice ?? null,
    webName: web?.name || '',
    webBarcode: web?.webBarcode || '',
    sourceUrl: web?.sourceUrl || '',
    syncedAt: web?.syncedAt || null,
    csvName: csv.name,
    legacyPrice: csv.price,
    price: csv.price,
    listPrice: csv.price,
    productRule: rules.products[csv.code] || { disabled: true },
    categoryRule: rules.classes[csv.class] || { disabled: true },
  };
}
