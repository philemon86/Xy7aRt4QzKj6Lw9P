import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
export function csv(s) {
  let rows = [],
    r = [],
    v = '',
    q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        v += '"';
        i++;
      } else if (c === '"') q = false;
      else v += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      r.push(v);
      v = '';
    } else if (c === '\n') {
      r.push(v);
      rows.push(r);
      r = [];
      v = '';
    } else if (c !== '\r') v += c;
  }
  if (v || r.length) {
    r.push(v);
    rows.push(r);
  }
  const h = rows.shift();
  return rows
    .filter((r) => r.some(Boolean))
    .map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] || ''])));
}
const inputDir = process.argv[2];
if (!inputDir) throw Error('請提供 CSV 目錄');
const tables = {};
for (const n of [
  'CUSTADDR',
  'CUSTOMER',
  'CUSTCLAS',
  'PRODUCT',
  'PRODUNIT',
  'PRODCLAS',
  'PRODKIND',
]) {
  const b = fs.readFileSync(path.join(inputDir, n + '.csv'));
  tables[n] = csv(new TextDecoder('big5', { fatal: true }).decode(b));
}
const legacy = fs.readFileSync(path.resolve(root, 'legacy/index.html'), 'utf8');
const discount = JSON.parse(legacy.match(/discountRates = (\{[\s\S]*?\});/)[1]);
const special = JSON.parse(
  legacy.match(/const SPECIAL_DISCOUNT_MAP = (\{[\s\S]*?\});/)[1],
);
const products = tables.PRODUCT.map((p) => ({
  code: p.CODE,
  name: p.CNAME,
  barcode: p.BARCODE,
  class: p.CLAS,
  kind: p.KIND,
  unit: p.UNIT,
  unitCode: p.UNIT,
  ntaxFlag: p.NTAXFLAG,
  cost: +p.CCOST || 0,
  price: +p.PRICE1 || 0,
  listPrice: +p.PRICE1 || 0,
  defaultDiscount: discount[p.CLAS] || 100,
  specialDiscount: special[p.CODE] ?? special[p.BARCODE],
  image: '',
  websitePrice: null,
  sourceUrl: '',
  syncedAt: null,
}));
const customers = tables.CUSTOMER.map((c) => ({
  code: c.CODE,
  name: c.CNAME,
  invoiceName:
    tables.CUSTADDR.find((a) => a.CUST === c.CODE)?.INVNAME || c.CNAME,
  invcate: c.INVCATE,
  einvflag: c.EINVFLAG,
  class: c.CLAS,
}));
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'data/catalog.json'),
  JSON.stringify({
    products,
    customers,
    units: Object.fromEntries(tables.PRODUNIT.map((x) => [x.CODE, x.CNAME])),
    classes: Object.fromEntries(tables.PRODCLAS.map((x) => [x.CODE, x.NAME])),
    kinds: Object.fromEntries(tables.PRODKIND.map((x) => [x.CODE, x.NAME])),
  }),
);
fs.writeFileSync(
  path.join(root, 'data/source-report.json'),
  JSON.stringify(
    Object.fromEntries(
      Object.entries(tables).map(([k, v]) => [
        k,
        { rows: v.length, encoding: 'Big5' },
      ]),
    ),
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    products: products.length,
    customers: customers.length,
    aa01: customers.find((c) => c.code === 'AA01'),
  }),
);
