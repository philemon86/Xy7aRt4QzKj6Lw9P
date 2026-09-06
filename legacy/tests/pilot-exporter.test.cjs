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

const zeroAmountResult = PilotExporter.buildPilotExport({
  clients: {
    '20260828-002': {
      id: '20260828-002',
      transactionId: '20260828-002',
      amount: 0,
      paymentMethod: '零元',
      paymentRecords: [],
      invoiceInfo: {},
      items: [
        { code: 'C254', name: '杏樹枝9', price: 300, quantity: 2, discount: 0 }
      ],
      isValid: true
    }
  },
  products: {
    C254: { code: 'C254', ntaxFlag: '0', cost: 103, unitCode: '1' }
  },
  customerMap: {
    '0002': { code: '0002', name: '書展', invoiceName: '書展', invcate: '3', einvflag: '0' }
  },
  unitMap: { '1': '本' },
  generateERI: createEriGenerator(),
  now: new Date('2026-08-28T10:00:00+08:00')
});

assert.equal(zeroAmountResult.ok, true, zeroAmountResult.validationErrors.join('\n'));
assert.equal(zeroAmountResult.audit.expectedGross, 0);
assert.equal(zeroAmountResult.audit.exportedGross, 0);
assert.equal(zeroAmountResult.audit.skippedZeroAmountCount, 0);
assert.equal(zeroAmountResult.audit.stkSale1Count, 1);
assert.equal(zeroAmountResult.audit.stkSale2Count, 1);
assert.equal(zeroAmountResult.audit.voucherCount, 0);
assert.equal(
  zeroAmountResult.rows.stkSale2[1][PilotExporter.STKSALE2_HEADER.indexOf('QTY')],
  2
);
assert.deepEqual(PilotExporter.getPaymentRecords({ amount: 0, paymentMethod: '現金' }), []);

const refundResult = PilotExporter.buildPilotExport({
  clients: {
    '20260829-003': {
      id: '20260829-003',
      transactionId: '20260829-003',
      amount: -500,
      paymentMethod: '信用卡退款',
      paymentRecords: [{ method: '信用卡', amount: -500 }],
      invoiceInfo: {},
      items: [
        { code: 'C254', name: '杏樹枝9', price: 300, quantity: -2, discount: 100 },
        { code: 'E001', name: '免稅換貨商品', price: 100, quantity: 1, discount: 100 }
      ],
      isValid: true
    }
  },
  products: {
    C254: { code: 'C254', ntaxFlag: '0', cost: 103, unitCode: '1' },
    E001: { code: 'E001', ntaxFlag: '1', cost: 40, unitCode: '1' }
  },
  customerMap: {
    '0002': { code: '0002', name: '書展', invoiceName: '書展', invcate: '3', einvflag: '0' }
  },
  unitMap: { '1': '本' },
  generateERI: createEriGenerator(),
  now: new Date('2026-08-29T10:00:00+08:00')
});

assert.equal(refundResult.ok, true, refundResult.validationErrors.join('\n'));
assert.equal(refundResult.audit.expectedGross, -500);
assert.equal(refundResult.audit.exportedGross, -500);
assert.equal(refundResult.audit.stkSale1Count, 2);
assert.equal(refundResult.audit.stkSale2Count, 2);
assert.equal(refundResult.audit.voucherCount, 2);
assert.equal(refundResult.audit.paymentAssociationErrorCount, 0);
assert.equal(refundResult.audit.paymentAmountErrorCount, 0);

const refundVoucherAmounts = refundResult.rows.vchrplus.slice(1)
  .map(row => row[PilotExporter.VCHRPLUS_HEADER.indexOf('AMT')])
  .sort((a, b) => a - b);
assert.deepEqual(refundVoucherAmounts, [-100, 600]);
assert.ok(refundResult.rows.stkSale1.slice(1).every(row => (
  row[PilotExporter.STKSALE1_HEADER.indexOf('TOTAL')] === 0
)));

const negativePriceResult = PilotExporter.buildPilotExport({
  clients: {
    '20260829-004': {
      id: '20260829-004',
      transactionId: '20260829-004',
      amount: -270,
      paymentMethod: '現金退款',
      paymentRecords: [{ method: '現金', amount: -270 }],
      invoiceInfo: {},
      items: [
        { code: 'C254', name: '禮券折抵', price: -300, quantity: 1, discount: 90 }
      ],
      isValid: true
    }
  },
  products: {
    C254: { code: 'C254', ntaxFlag: '0', cost: 103, unitCode: '1' }
  },
  customerMap: {
    '0002': { code: '0002', name: '書展', invoiceName: '書展', invcate: '3', einvflag: '0' }
  },
  unitMap: { '1': '本' },
  generateERI: createEriGenerator(),
  now: new Date('2026-08-29T10:00:00+08:00')
});

assert.equal(negativePriceResult.ok, true, negativePriceResult.validationErrors.join('\n'));
assert.equal(negativePriceResult.audit.expectedGross, -270);
assert.equal(negativePriceResult.audit.exportedGross, -270);
assert.equal(negativePriceResult.audit.voucherCount, 0);

const negativePriceDetail = negativePriceResult.rows.stkSale2[1];
assert.equal(negativePriceDetail[PilotExporter.STKSALE2_HEADER.indexOf('QTY')], 1);
assert.ok(negativePriceDetail[PilotExporter.STKSALE2_HEADER.indexOf('PRICE')] < 0);
assert.ok(negativePriceDetail[PilotExporter.STKSALE2_HEADER.indexOf('AMT')] < 0);
assert.equal(negativePriceDetail[PilotExporter.STKSALE2_HEADER.indexOf('INVPRC')], -270);
assert.equal(negativePriceDetail[PilotExporter.STKSALE2_HEADER.indexOf('INVAMT')], -270);
assert.equal(
  negativePriceResult.rows.stkSale1[1][PilotExporter.STKSALE1_HEADER.indexOf('TOTAL')],
  -270
);

console.log('PilotExporter zero-amount and refund regression tests passed.');
