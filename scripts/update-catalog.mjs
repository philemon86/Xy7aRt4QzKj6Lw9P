import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  parseProductCSV,
  mergeProducts,
  defaultPricing,
} from '../lib/catalog.mjs';

// Replace only the four supplied product tables; customers and manual rules stay intact.
const root = path.resolve(import.meta.dirname, '..');
const dir = process.argv[2];
if (!dir) throw Error('請提供商品 CSV 目錄');
const catalogPath = path.join(root, 'data/catalog.json');
const old = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const hashes = {},
  text = {};
for (const name of ['PRODUCT', 'PRODCLAS', 'PRODKIND', 'PRODUNIT']) {
  const bytes = fs.readFileSync(path.join(dir, name + '.csv'));
  hashes[name] = createHash('sha256').update(bytes).digest('hex');
  text[name] = new TextDecoder('big5', { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, '');
}
function lookup(csv, nameField) {
  const rows = [];
  let row = [],
    value = '',
    quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') {
      if (value) throw Error('分類 CSV 引號格式錯誤');
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (char !== '\r') value += char;
  }
  if (quoted) throw Error('分類 CSV 引號未結束');
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const headers = rows.shift().map((v) => v.trim().toUpperCase());
  const code = headers.indexOf('CODE'),
    name = headers.indexOf(nameField);
  if (code < 0 || name < 0) throw Error('分類 CSV 缺少欄位');
  const entries = [];
  const seen = new Set();
  for (const r of rows.filter((r) => r.some((v) => v.trim()))) {
    if (r.length !== headers.length) throw Error('分類 CSV 欄位數不符');
    const key = r[code].trim(),
      label = r[name].trim();
    if (
      !key ||
      !label ||
      seen.has(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    )
      throw Error('分類 CSV 代碼或名稱無效');
    seen.add(key);
    entries.push([key, label]);
  }
  if (!entries.length) throw Error('分類 CSV 無資料');
  return Object.fromEntries(entries);
}
const parsed = parseProductCSV(text.PRODUCT);
const defaults = defaultPricing(old.products).classes;
const products = mergeProducts(
  old.products,
  parsed.products.map((p) => ({
    ...p,
    defaultDiscount: defaults[p.class]?.value ?? 100,
  })),
);
const oldMap = new Map(old.products.map((p) => [p.code, p]));
const sourceRevision = createHash('sha256')
  .update(JSON.stringify(hashes))
  .digest('hex');
const next = {
  ...old,
  products,
  classes: lookup(text.PRODCLAS, 'NAME'),
  kinds: lookup(text.PRODKIND, 'NAME'),
  units: lookup(text.PRODUNIT, 'CNAME'),
  sourceRevision,
  importedCodes: parsed.products.map((p) => p.code),
};
assert.deepEqual(next.customers, old.customers);
for (const p of products) {
  if (oldMap.has(p.code))
    assert.equal(p.specialDiscount, oldMap.get(p.code).specialDiscount);
}
const report = {
  date: new Date().toISOString(),
  encoding: 'Big5',
  sourceRevision,
  hashes,
  imported: parsed.products.length,
  total: products.length,
  newProducts: parsed.products
    .filter((p) => !oldMap.has(p.code))
    .map((p) => p.code),
  changedProducts: parsed.products
    .filter(
      (p) =>
        oldMap.has(p.code) &&
        Object.entries(p).some(([k, v]) => oldMap.get(p.code)[k] !== v),
    )
    .map((p) => p.code),
  skipped: parsed.skipped,
  classes: Object.keys(next.classes).length,
  units: Object.keys(next.units).length,
  kinds: Object.keys(next.kinds).length,
};
fs.writeFileSync(catalogPath, JSON.stringify(next));
fs.writeFileSync(
  path.join(root, 'data/catalog-import-report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
