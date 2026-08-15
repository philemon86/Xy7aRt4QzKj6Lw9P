const fs = require('node:fs');
const path = require('node:path');
const { buildPilotExport } = require('../pilot-export.js');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      if (row.some(cell => String(cell).trim())) rows.push(row);
      row = [];
      value = '';
    } else if (character !== '\r') value += character;
  }
  if (value || row.length) {
    row.push(value);
    if (row.some(cell => String(cell).trim())) rows.push(row);
  }
  return rows;
}

function readSmart(file) {
  const bytes = fs.readFileSync(file);
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return (utf8.match(/\uFFFD/g) || []).length > 5
    ? new TextDecoder('big5').decode(bytes)
    : utf8;
}

function table(file) {
  const rows = parseCsv(readSmart(file));
  const header = rows[0];
  return rows.slice(1).map(row => Object.fromEntries(header.map((name, index) => [name, row[index] || ''])));
}

function makeEriGenerator() {
  let counter = 0;
  return type => {
    counter += 1;
    const prefix = { master: '0H5', detail: '0H8', pay: '01E' }[type];
    return `${prefix}${counter.toString(36).toUpperCase().padStart(13, '0')}`;
  };
}

const backupFile = process.argv[2];
if (!backupFile) throw new Error('用法：node scripts/pilot-dry-run.js <pos_backup.json> [YYYY-MM-DD]');
const repoRoot = path.resolve(__dirname, '..');
const backup = JSON.parse(fs.readFileSync(path.resolve(backupFile), 'utf8'));
const productRows = table(path.join(repoRoot, 'PRODUCT.csv'));
const customerRows = table(path.join(repoRoot, 'CUSTOMERS.csv'));
const unitRows = table(path.join(repoRoot, 'PRODUNIT.csv'));
const products = {};
productRows.forEach(row => {
  if (!row.CODE) return;
  const product = {
    code: row.CODE,
    barcode: row.BARCODE,
    ntaxFlag: row.NTAXFLAG,
    cost: Number(row.CCOST || 0),
    unitCode: row.UNIT
  };
  products[row.CODE] = product;
  if (row.BARCODE && row.BARCODE !== row.CODE) products[row.BARCODE] = product;
});
const customerMap = Object.fromEntries(customerRows
  .filter(row => row.CODE)
  .map(row => [row.CODE, { code: row.CODE, name: row.CNAME }]));
const unitMap = Object.fromEntries(unitRows
  .filter(row => row.CODE)
  .map(row => [row.CODE, row.CNAME || row.CODE]));
const runDate = process.argv[3]
  ? new Date(`${process.argv[3]}T12:00:00`)
  : new Date();
const result = buildPilotExport({
  clients: backup.clients || {},
  products,
  customerMap,
  unitMap,
  generateERI: makeEriGenerator(),
  now: runDate
});

console.log(JSON.stringify({
  ok: result.ok,
  validationErrors: result.validationErrors,
  audit: result.audit
}, null, 2));
process.exitCode = result.ok ? 0 : 2;
