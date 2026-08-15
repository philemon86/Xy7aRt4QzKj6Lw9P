const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STKSALE1_HEADER,
  STKSALE2_HEADER,
  buildPilotExport,
  formatDocumentPrefix
} = require('../pilot-export.js');

const makeEriGenerator = () => {
  let counter = 0;
  return type => {
    counter += 1;
    const prefix = { master: '0H5', detail: '0H8', pay: '01E' }[type];
    return `${prefix}${String(counter).padStart(13, '0')}`;
  };
};

const product = (code, ntaxFlag, cost, unit = '本') => ({
  code,
  barcode: `BAR-${code}`,
  ntaxFlag,
  cost,
  unit,
  unitCode: unit
});

const item = (code, price = 105, quantity = 1) => ({
  code,
  name: code,
  price,
  quantity,
  discount: 100,
  unit: '本',
  unitCode: '本'
});

const customerMap = {
  '0002': { code: '0002', name: '書展' },
  '305': { code: '305', name: '零售' },
  CH01: { code: 'CH01', name: '測試教會' }
};

test('依交易、客戶與 PRODUCT.NTAXFLAG 拆單，並正確關聯付款', () => {
  const clients = {
    g1: {
      id: 'g1', transactionId: 'g1', isValid: true, amount: 210,
      paymentMethod: '現金', bookFairCustomerCode: 'CH01', invoiceInfo: {},
      items: [item('TAX'), item('EXEMPT')]
    },
    g2: {
      id: 'g2', transactionId: 'g2', isValid: true, amount: 105,
      paymentMethod: '信用卡', bookFairCustomerCode: 'CH01', invoiceInfo: { donationCode: '2995' },
      items: [item('TAX')]
    },
    p1: {
      id: 'p1', transactionId: 'p1', isValid: true, amount: 105,
      paymentMethod: 'LINE PAY', bookFairCustomerCode: 'CH01', invoiceInfo: { carrier: '/SAME' },
      items: [item('TAX')]
    },
    p2: {
      id: 'p2', transactionId: 'p2', isValid: true, amount: 105,
      paymentMethod: '文化幣', bookFairCustomerCode: 'CH01', invoiceInfo: { carrier: '/SAME' },
      items: [item('TAX')]
    },
    church: {
      id: 'church', transactionId: 'church', isValid: true, amount: 210,
      paymentMethod: '信用卡(80) + LINE PAY(130)',
      paymentRecords: [
        { method: '信用卡', amount: 80 },
        { method: 'LINE PAY', amount: 130 }
      ],
      bookFairCustomerCode: 'CH01', invoiceInfo: { taxId: '52399254' },
      items: [item('TAX'), item('EXEMPT')]
    }
  };
  const products = {
    TAX: product('TAX', '0', 60),
    // 非 ISBN 商品仍依正式 NTAXFLAG=1 判定免稅，不能再猜名稱或 ISBN。
    EXEMPT: product('EXEMPT', '1', 40)
  };
  const result = buildPilotExport({
    clients,
    products,
    customerMap,
    unitMap: { 本: '本' },
    generateERI: makeEriGenerator(),
    now: new Date(2026, 7, 15, 10, 20, 30)
  });

  assert.equal(result.ok, true, result.validationErrors.join('\n'));
  assert.equal(result.audit.stkSale1Count, 6);
  assert.equal(result.audit.stkSale2Count, 7);
  assert.equal(result.audit.voucherCount, 5);
  assert.deepEqual(result.audit.first10Codes, [
    '115BF815-001', '115BF815-002', '115BF815-003',
    '115BF815-004', '115BF815-005', '115BF815-006'
  ]);
  assert.equal(result.audit.duplicateCodeCount, 0);
  assert.equal(result.audit.duplicateEriCount, 0);
  assert.equal(result.audit.orphanMasteriCount, 0);
  assert.equal(result.audit.orphanSrceriCount, 0);
  assert.equal(result.audit.taxCateErrorCount, 0);
  assert.equal(result.audit.masterAmountErrorCount, 0);
  assert.equal(result.audit.detailMasterAmountErrorCount, 0);
  assert.equal(result.audit.customerResolverErrorCount, 0);

  const masters = result.rows.stkSale1.slice(1).map(row => Object.fromEntries(STKSALE1_HEADER.map((name, index) => [name, row[index]])));
  const details = result.rows.stkSale2.slice(1).map(row => Object.fromEntries(STKSALE2_HEADER.map((name, index) => [name, row[index]])));
  const personalMasters = masters.filter(master => master.CUST === '305');
  assert.equal(personalMasters.length, 2, '相同載具的兩筆 transaction 不得合併');
  assert.notEqual(result.transactionToPrimaryMasterEri.p1, result.transactionToPrimaryMasterEri.p2);
  personalMasters.forEach(master => {
    assert.match(master.POSREMARK1, /^載具：\/SAME$/);
    assert.equal(master.REMARK, 'POS_Import');
  });

  const churchMasters = masters.filter(master => master.CUST === 'CH01');
  assert.equal(churchMasters.length, 2);
  churchMasters.forEach(master => {
    assert.equal(master.BILCUST, 'CH01');
    assert.equal(master.CMPID, '52399254');
    assert.equal(master.INVNAME, '測試教會');
    assert.equal(master.POSREMARK1, '');
    assert.equal(master.REMARK, 'POS_Import');
  });

  const churchVoucherRows = result.rows.vchrplus.slice(1).filter(row => row[1] === result.transactionToPrimaryMasterEri.church);
  assert.equal(churchVoucherRows.length, 2);
  assert.deepEqual(churchVoucherRows.map(row => row[6]), [-80, -130]);
  details.forEach(detail => {
    const master = masters.find(candidate => candidate.ERI === detail.MASTERI);
    assert.ok(master);
    assert.equal(detail.CODE, master.CODE);
  });
  assert.equal(masters[0].COST, 120, '一般書展應稅 master 成本應加總 CCOST×QTY，不可用 TOTAL');
});

test('統編交易缺少本場教會快照時禁止正式輸出', () => {
  const result = buildPilotExport({
    clients: {
      bad: {
        id: 'bad', transactionId: 'bad', isValid: true, amount: 105,
        paymentMethod: '信用卡', invoiceInfo: { taxId: '52399254' }, items: [item('TAX')]
      }
    },
    products: { TAX: product('TAX', '0', 60) },
    customerMap,
    generateERI: makeEriGenerator(),
    now: new Date(2026, 7, 15)
  });
  assert.equal(result.ok, false);
  assert.ok(result.audit.customerResolverErrorCount > 0);
  assert.match(result.validationErrors.join('\n'), /本場書展教會快照/);
});

test('ERI 碰撞時重新產生，三種 ERI 全域唯一且 prefix/長度維持不變', () => {
  const generated = {
    master: ['0H50000000000001', '0H50000000000001', '0H50000000000002'],
    detail: ['0H80000000000001', '0H80000000000001', '0H80000000000002'],
    pay: ['01E0000000000001', '01E0000000000001', '01E0000000000002']
  };
  const indexes = { master: 0, detail: 0, pay: 0 };
  const generateERI = type => generated[type][indexes[type]++] || makeEriGenerator()(type);
  const result = buildPilotExport({
    clients: {
      a: { id: 'a', transactionId: 'a', isValid: true, amount: 105, paymentMethod: '信用卡', bookFairCustomerCode: 'CH01', invoiceInfo: { carrier: '/A' }, items: [item('TAX')] },
      b: { id: 'b', transactionId: 'b', isValid: true, amount: 105, paymentMethod: '信用卡', bookFairCustomerCode: 'CH01', invoiceInfo: { carrier: '/B' }, items: [item('TAX')] }
    },
    products: { TAX: product('TAX', '0', 60) },
    customerMap,
    generateERI,
    now: new Date(2026, 7, 15)
  });
  assert.equal(result.ok, true, result.validationErrors.join('\n'));
  assert.equal(result.audit.duplicateEriCount, 0);
  const allEris = [
    ...result.rows.stkSale1.slice(1).map(row => row[0]),
    ...result.rows.stkSale2.slice(1).map(row => row[0]),
    ...result.rows.vchrplus.slice(1).map(row => row[0])
  ];
  assert.equal(new Set(allEris).size, allEris.length);
  allEris.forEach(eri => assert.equal(eri.length, 16));
  result.rows.stkSale1.slice(1).forEach(row => assert.match(row[0], /^0H5/));
  result.rows.stkSale2.slice(1).forEach(row => assert.match(row[0], /^0H8/));
  result.rows.vchrplus.slice(1).forEach(row => assert.match(row[0], /^01E/));
});

test('CODE 月份不補零且日期日份補兩碼', () => {
  assert.equal(formatDocumentPrefix(new Date(2026, 7, 3)), '115BF803');
  assert.equal(formatDocumentPrefix(new Date(2026, 9, 5)), '115BF1005');
});

test('STKSALE2 正式 header 的 VLIDDATE 與 DISCOUNT 位置固定', () => {
  assert.equal(STKSALE2_HEADER.length, 43);
  assert.equal(STKSALE2_HEADER.indexOf('VLIDDATE'), 24);
  assert.equal(STKSALE2_HEADER.indexOf('DISCOUNT'), 42);
});
