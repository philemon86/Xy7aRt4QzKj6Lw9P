const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>\s*(\(function \(root, factory\)[\s\S]*?<\/script>)/);
assert.ok(scriptMatch, '找不到 PilotExporter inline script');

const moduleBox = { exports: {} };
new Function('module', 'exports', scriptMatch[1].replace(/<\/script>\s*$/, ''))(
  moduleBox,
  moduleBox.exports
);
const PilotExporter = moduleBox.exports;

const createEriGenerator = () => {
  let counter = 0;
  return (type) => {
    const prefix = { master: '0H5', detail: '0H8', pay: '01E' }[type];
    counter += 1;
    return `${prefix}0010LU0${counter.toString(36).toUpperCase().padStart(6, '0')}`;
  };
};

const result = PilotExporter.buildPilotExport({
  clients: {
    '20260828-001': {
      id: '20260828-001',
      transactionId: '20260828-001',
      amount: 0,
      paymentMethod: '信用卡',
      paymentRecords: [{ method: '信用卡', amount: 0 }],
      invoiceInfo: {},
      items: [
        { code: 'C254', name: '杏樹枝9', price: 300, quantity: 1, discount: 90 },
        { code: 'C001', name: '對觀福音書', price: 150, quantity: 1, discount: 90 }
      ],
      isValid: true
    },
    '20260828-000': {
      id: '20260828-000',
      transactionId: '20260828-000',
      amount: 0,
      paymentMethod: '現金',
      paymentRecords: [{ method: '現金', amount: 0 }],
      invoiceInfo: {},
      items: [],
      isValid: true
    }
  },
  products: {
    C254: { code: 'C254', ntaxFlag: '0', cost: 103, unitCode: '1' },
    C001: { code: 'C001', ntaxFlag: '0', cost: 44.29811, unitCode: '1' }
  },
  customerMap: {
    '0002': { code: '0002', name: '書展', invoiceName: '書展', invcate: '3', einvflag: '0' }
  },
  unitMap: { '1': '本' },
  generateERI: createEriGenerator(),
  now: new Date('2026-08-28T10:00:00+08:00')
});

assert.equal(result.ok, true, result.validationErrors.join('\n'));
assert.equal(result.audit.expectedGross, 405);
assert.equal(result.audit.exportedGross, 405);
assert.equal(result.audit.paymentAssociationErrorCount, 0);
assert.equal(result.audit.paymentAmountErrorCount, 0);
assert.equal(result.audit.skippedZeroAmountCount, 1);
assert.equal(result.audit.stkSale1Count, 1);
assert.equal(result.rows.vchrplus.length, 2);
assert.equal(result.rows.vchrplus[1][6], -405);

console.log('PilotExporter zero-total recovery regression test passed.');
