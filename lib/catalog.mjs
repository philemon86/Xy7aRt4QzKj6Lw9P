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
// A shipped CSV update takes effect once; later administrator edits remain intact.
export function rebaseCatalogProducts(existing, baseline, importedCodes) {
  const codes = new Set(importedCodes);
  return mergeProducts(
    existing,
    baseline.filter((p) => codes.has(p.code)),
  );
}
export function defaultPricing(products, savedProducts = []) {
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
  // New products and their initial discount share one atomic catalog write.
  // Later pricing edits/deletion markers override this initial rule as usual.
  for (const p of savedProducts)
    if (p.initialPriceRule) rules.products[p.code] = p.initialPriceRule;
  return rules;
}

export function validateNewProduct(input, catalog) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('商品資料格式錯誤');
  const text = (key, max = 100) => {
    if (input[key] != null && typeof input[key] !== 'string') throw Error('商品欄位格式錯誤：' + key);
    const value = (input[key] || '').trim();
    if (value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw Error('商品欄位過長或含無效字元：' + key);
    return value;
  };
  const code = text('code').toUpperCase(), name = text('name', 300), barcode = text('barcode').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,99}$/.test(code) || ['constructor','prototype','__proto__'].includes(code.toLowerCase()))
    throw Error('商品代碼請使用英數字、-、_、. 或 /');
  if (!name || /[<>]/.test(name.replace(/<[\u3400-\u9fff-]+>/g, ''))) throw Error('請輸入有效的商品名稱');
  if (barcode && !/^[A-Z0-9+./_%$-]+$/.test(barcode)) throw Error('條碼請使用英數字或條碼符號');
  const keys = new Set((catalog.products || []).flatMap(p => [p.code,p.barcode,p.webBarcode]).filter(Boolean).map(v => String(v).toUpperCase()));
  if (keys.has(code)) throw Error('商品代碼已存在或與既有條碼重複：' + code);
  if (barcode && (keys.has(barcode) || barcode === code)) throw Error('條碼已存在或與商品代碼重複：' + barcode);
  const select = (key, dict, required = false) => {
    const value = text(key);
    if ((required || value) && !Object.hasOwn(dict || {}, value)) throw Error('請選擇有效的商品分類／品項／單位');
    return value;
  };
  const amount = (key, optional = false) => {
    const value = input[key];
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
      if (optional && (value == null || value === '')) return 0;
      throw Error('請輸入有效的原價或成本');
    }
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) > 9999999) throw Error('請輸入有效的原價或成本');
    return number;
  };
  if (!['0','1'].includes(input.ntaxFlag)) throw Error('請選擇應稅或免稅');
  const product = {code,name,barcode,class:select('class',catalog.classes,true),kind:select('kind',catalog.kinds),
    unitCode:select('unitCode',catalog.units,true),ntaxFlag:input.ntaxFlag,price:amount('price'),cost:amount('cost',true),origin:'manual'};
  product.unit = product.unitCode;
  product.listPrice = product.price;
  const image = text('image', 2000);
  if (image) {
    let url; try {url = new URL(image);} catch {throw Error('圖片網址請使用完整的 HTTPS 網址');}
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('圖片網址請使用完整的 HTTPS 網址');
    product.image = url.href.replaceAll("'", '%27');
  }
  if (!['default','discount','price'].includes(input.priceMode)) throw Error('請選擇有效的售價方式');
  if (input.priceMode !== 'default') {
    const value = input.priceValue;
    if (!['string','number'].includes(typeof value)) throw Error('請輸入有效的折扣或單價');
    if (input.priceMode === 'discount' && Math.abs(Number(value)*10-Math.round(Number(value)*10)) > 0.000001)
      throw Error('折扣百分比最多小數一位');
    product.initialPriceRule = validatePriceRule({mode:input.priceMode,value,start:text('start',10),end:text('end',10)});
  }
  return product;
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
    websitePrice:
      web?.websitePrice === 0 && !web.websiteZeroConfirmed && csv.price > 0
        ? null
        : (web?.websitePrice ?? null),
    websiteZeroConfirmed: web?.websiteZeroConfirmed === true,
    websitePriceCorrectionFrom: web?.websitePriceCorrectionFrom || [],
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
