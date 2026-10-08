import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Pilot from '../lib/pilot-core.mjs';
import {
  exportContext,
  preparePilotSources,
  finalizePilotExport,
  validateFinalExport,
  collectEris,
  DATE_FIELDS,
} from '../lib/pilot-finalize.mjs';
const context = {
  date: '2026/09/08',
  firstCode: '1152778',
  firstInvoice: 'FR13223935',
};
const products = {
  T: { code: 'T', name: '應稅品', ntaxFlag: '0', cost: 15, unitCode: '1' },
  E: { code: 'E', name: '免稅品', ntaxFlag: '1', cost: 20, unitCode: '1' },
};
const customerMap = {
  '0002': {
    code: '0002',
    name: '書展',
    invoiceName: '書展',
    invcate: '3',
    einvflag: '0',
  },
  305: {
    code: '305',
    name: 'POS 現銷',
    invoiceName: 'POS 現銷',
    invcate: '2',
    einvflag: '1',
  },
  AA01: {
    code: 'AA01',
    name: '臺北教會',
    invoiceName: '臺北教會',
    invcate: '2',
    einvflag: '1',
  },
};
const item = (code, price = 100, quantity = 1) => ({
  code,
  name: products[code].name,
  price,
  quantity,
  discount: 100,
});
const order = (id, items, options = {}) => {
  const amount = Math.round(
    items.reduce((s, i) => s + i.price * i.quantity, 0),
  );
  return {
    id,
    transactionId: id,
    createdAt: '2026-09-08T00:00:00Z',
    amount,
    items,
    isValid: true,
    paymentMethod: 'LINE PAY',
    paymentRecords: amount ? [{ method: 'LINE PAY', amount }] : [],
    invoiceInfo: {},
    ...options,
  };
};
const prepare = (clients, ctx = context) =>
  preparePilotSources({
    clients,
    products,
    customerMap,
    unitMap: { 1: '本' },
    context: ctx,
  });
const generator = (start = 0) => {
  let n = start;
  return (type) =>
    ({ master: '0H5', detail: '0H8', pay: '01E' })[type] +
    '0010LU0' +
    (++n).toString(36).toUpperCase().padStart(6, '0');
};
const objects = (rows) =>
  rows
    .slice(1)
    .map((row) => Object.fromEntries(rows[0].map((key, i) => [key, row[i]])));

test('Separate invoices use one base per transaction, mixed-tax suffix and independent invoice counter', () => {
  const clients = {
    a: order('a', [item('T'), item('E')], {
      invoiceInfo: { carrier: '/ABC1234' },
    }),
    b: order('b', [item('E')], { invoiceInfo: { carrier: '/ABC1234' } }),
    c: order('c', [item('T')], {
      invoiceInfo: { taxId: '12345678' },
      bookFairCustomerCode: 'AA01',
    }),
  };
  const original = JSON.stringify(clients),
    source = prepare(clients);
  const final = finalizePilotExport(source, { generateERI: generator() });
  const masters = objects(final.rows.stkSale1);
  assert.deepEqual(
    masters.map((m) => m.CODE),
    ['1152778', '11527781', '1152779', '1152780'],
  );
  assert.deepEqual(
    masters.map((m) => m.INVNO),
    ['FR13223935', 'FR13223936', 'FR13223937', 'FR13223938'],
  );
  assert.deepEqual(
    final.preview.map((m) => m.sourceId),
    ['a', 'a', 'b', 'c'],
  );
  assert.equal(final.mappings[0].transactionId, 'a');
  assert.equal(JSON.stringify(clients), original);
  for (const [key, fields] of Object.entries(DATE_FIELDS))
    for (const row of objects(final.rows[key]))
      for (const field of fields) assert.equal(row[field], context.date);
});

test('Every export gets new ERIs and all detail/voucher links use the new masters', () => {
  const source = prepare({
    a: order('a', [item('T'), item('E')], { eri: '0H50010LU0000001' }),
  });
  const original = JSON.stringify(source);
  const first = finalizePilotExport(source, { generateERI: generator() });
  const second = finalizePilotExport(source, {
    generateERI: generator(),
    usedEris: new Set(first.newEris),
  });
  assert.equal(
    first.newEris.some((e) => second.newEris.includes(e)),
    false,
  );
  assert.equal(first.newEris.includes('0H50010LU0000001'), false);
  const masters = new Map(objects(second.rows.stkSale1).map((m) => [m.ERI, m]));
  for (const d of objects(second.rows.stkSale2)) {
    assert.ok(masters.has(d.MASTERI));
    assert.equal(d.CODE, masters.get(d.MASTERI).CODE);
    assert.equal(d.INVNO, '');
  }
  for (const v of objects(second.rows.vchrplus)) {
    assert.ok(masters.has(v.SRCERI));
    assert.equal(v.CODE, '51');
  }
  assert.equal(JSON.stringify(source), original);
});

test('Finalization preserves carrier, customer, INVQTY, negative lines, payment classes and every business field', () => {
  const sources = prepare({
    a: order('a', [item('T', 200), item('T', -20), item('E', 100)], {
      invoiceInfo: { carrier: '/ABC1234' },
      paymentMethod: '文化幣(80) + LINE PAY(200)',
      paymentRecords: [
        { method: '文化幣', amount: 80 },
        { method: 'LINE PAY', amount: 200 },
      ],
    }),
    b: order('b', [item('E', 60, -1)], {
      invoiceInfo: { taxId: '52399254' },
      bookFairCustomerCode: 'AA01',
    }),
    c: order('c', [item('T', 0)]),
  });
  const final = finalizePilotExport(sources, { generateERI: generator() });
  assert.equal(validateFinalExport(final, sources), true);
  assert.ok(objects(final.rows.stkSale1).some((m) => m.CUST === '305'));
  assert.ok(final.preview.some((p) => p.carrier === '/ABC1234'));
  assert.ok(objects(final.rows.stkSale2).some((d) => Number(d.PRICE) < 0));
  assert.ok(objects(final.rows.stkSale1).some((d) => d.CUST === 'AA01'));
});

test('Preview validation rejects invalid dates, invoice overflow, duplicate final codes and broken relations', () => {
  assert.throws(
    () => exportContext({ ...context, date: '2026/02/30' }),
    /日期/,
  );
  assert.throws(
    () => exportContext({ ...context, firstInvoice: 'FR123' }),
    /發票/,
  );
  const source = prepare(
    { a: order('a', [item('T'), item('E')]) },
    { ...context, firstInvoice: 'FR99999999' },
  );
  assert.throws(
    () => finalizePilotExport(source, { generateERI: generator() }),
    /8 碼/,
  );
  const normal = prepare({ a: order('a', [item('T')]) });
  const final = finalizePilotExport(normal, { generateERI: generator() });
  final.rows.stkSale2[1][Pilot.STKSALE2_HEADER.indexOf('MASTERI')] =
    'old-master';
  assert.throws(() => validateFinalExport(final, normal), /關聯/);
  const many = Object.fromEntries(
    Array.from({ length: 84 }, (_, i) => {
      const id = String(i).padStart(3, '0');
      return [
        id,
        order(id, i === 0 ? [item('T'), item('E')] : [item('T')], {
          invoiceInfo: { carrier: '/ABC1234' },
        }),
      ];
    }),
  );
  assert.throws(
    () =>
      finalizePilotExport(prepare(many, { ...context, firstCode: '9' }), {
        generateERI: generator(),
      }),
    /重複/,
  );
});

test('Blank invoices and default donations consolidate exactly like legacy while retaining each source mapping', () => {
  const clients = {
    a: order('a', [item('T', 11), item('E', 100)]),
    b: order('b', [item('T', 11)], {
      invoiceInfo: { donationCode: '2995' },
      paymentMethod: '信用卡',
      paymentRecords: [{ method: '信用卡', amount: 11 }],
    }),
    c: order('c', [item('E', 0)], {
      invoiceInfo: { carrier: ' ', taxId: ' ' },
    }),
    d: order('d', [item('E', -20)], {
      paymentMethod: '文化幣',
      paymentRecords: [{ method: '文化幣', amount: -20 }],
    }),
    e: order('e', [item('T', 80)], {
      invoiceInfo: { carrier: '/ABC1234', donationCode: '2995' },
    }),
    f: order('f', [item('T', 90)], { invoiceInfo: { carrier: '/ABC1234' } }),
    g: order('g', [item('E', 50)], {
      invoiceInfo: { taxId: '12345678' },
      bookFairCustomerCode: 'AA01',
    }),
    h: order('h', [item('E', 50)], {
      invoiceInfo: { taxId: '12345678' },
      bookFairCustomerCode: 'AA01',
    }),
    i: order('i', [item('E', 15)], { invoiceInfo: { donationCode: '12345' } }),
    j: order('j', [item('E', 25)], { invoiceInfo: { donationCode: '12345' } }),
  };
  const before = JSON.stringify(clients);
  const legacy = Pilot.buildPilotExport({
    clients: structuredClone(clients),
    products,
    customerMap,
    unitMap: { 1: '本' },
    generateERI: generator(),
    now: new Date('2026-09-08T00:00:00Z'),
  });
  assert.equal(legacy.ok, true, legacy.validationErrors.join(';'));
  const final = finalizePilotExport(prepare(clients), {
    generateERI: generator(1000),
    numbers: { a: 'PF-A', b: 'PF-B', c: 'PF-C', d: 'PF-D' },
  });
  const masters = objects(final.rows.stkSale1);
  assert.equal(masters.length, 8);
  assert.deepEqual(
    masters.map((m) => m.CODE),
    [
      '1152778',
      '11527781',
      '1152779',
      '1152780',
      '1152781',
      '1152782',
      '1152783',
      '1152784',
    ],
  );
  assert.deepEqual(
    masters.slice(0, 2).map((m) => [m.TAXCATE, m.AMT + m.TAX, m.AMT, m.TAX]),
    [
      [0, 22, 21, 1],
      [1, 80, 80, 0],
    ],
  );
  assert.match(masters[0].REMARK, /捐贈：2995/);
  assert.deepEqual(final.preview[0].sourceNumbers, ['PF-A', 'PF-B']);
  assert.deepEqual(final.preview[1].sourceNumbers, [
    'PF-A',
    'PF-B',
    'PF-C',
    'PF-D',
  ]);
  const mapping = new Map(final.mappings.map((m) => [m.transactionId, m]));
  assert.equal(mapping.size, 10);
  for (const id of ['a', 'b', 'c', 'd'])
    assert.equal(mapping.get(id).baseCode, '1152778');
  assert.deepEqual(
    mapping.get('b').masters.map((m) => m.code),
    ['1152778', '11527781'],
  );
  assert.deepEqual(
    mapping.get('c').masters.map((m) => m.code),
    ['11527781'],
  );
  assert.notEqual(mapping.get('e').baseCode, mapping.get('f').baseCode);
  assert.notEqual(mapping.get('g').baseCode, mapping.get('h').baseCode);
  assert.notEqual(mapping.get('i').baseCode, mapping.get('j').baseCode);
  const finalFields = new Set([
    'ERI',
    'MASTERI',
    'SRCERI',
    'INVNO',
    'SDATE',
    'INVDATE',
    'BILDATE',
    'RADVDATE',
    'PAYCASH',
    'EINVFLAG',
    'INVCATE',
    'EDITOR',
    'PLUSSUB',
    'TOTAL',
    'INVNAME',
  ]);
  for (const key of ['stkSale1', 'stkSale2']) {
    const canonical = (rows) =>
      objects(rows)
        .map((row) =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(row).filter(
                ([field]) =>
                  !finalFields.has(field) &&
                  (field !== 'CODE' || key === 'vchrplus'),
              ),
            ),
          ),
        )
        .sort();
    assert.deepEqual(
      canonical(final.rows[key]),
      canonical(legacy.rows[key]),
      key + ' retains the full legacy business output',
    );
  }
  const generalMasters = masters.slice(0, 2);
  assert.equal(generalMasters[0].PLUSSUB, 0);
  assert.equal(generalMasters[1].PLUSSUB, -102);
  const oldPayments = objects(legacy.rows.vchrplus),
    newPayments = objects(final.rows.vchrplus);
  for (const code of ['5', '51', '61'])
    assert.equal(
      newPayments
        .filter((v) => v.CODE === code)
        .reduce((sum, v) => sum + v.AMT, 0),
      oldPayments
        .filter((v) => v.CODE === code)
        .reduce((sum, v) => sum + v.AMT, 0),
    );
  assert.equal(JSON.stringify(clients), before);
  const again = finalizePilotExport(prepare(clients), {
    generateERI: generator(1000),
    usedEris: new Set(final.newEris),
  });
  assert.ok(again.newEris.every((eri) => !final.newEris.includes(eri)));
});

test('Exempt-only consolidated sales use the base number and empty or invalid records do not consume another invoice', () => {
  const clients = {
    a: order('a', [item('E')]),
    b: order('b', [item('E', 50)], { invoiceInfo: { donationCode: '2995' } }),
    empty: order('empty', []),
    voided: order('voided', [item('T')], { isValid: false }),
  };
  const final = finalizePilotExport(prepare(clients), {
    generateERI: generator(),
  });
  assert.deepEqual(
    objects(final.rows.stkSale1).map((m) => [m.CODE, m.INVNO, m.AMT]),
    [['1152778', 'FR13223935', 150]],
  );
  assert.equal(
    final.mappings.find((m) => m.transactionId === 'empty').skipped,
    true,
  );
  assert.equal(
    final.mappings.some((m) => m.transactionId === 'voided'),
    false,
  );
  assert.throws(
    () => prepare({ ...clients, duplicate: { ...clients.a, id: 'other' } }),
    /transaction id 重複/,
  );
});

test('Server module preserves the legacy core apart from the approved tax-ID customer routing', () => {
  const legacy = fs.readFileSync('legacy/pilot-exporter.cjs', 'utf8');
  const body = legacy.slice(
    legacy.indexOf('function () {') + 'function () {'.length,
    legacy.lastIndexOf('});'),
  );
  const originalRouting =
    /        customerCode = String\(client\.bookFairCustomerCode \|\| ''\)\.trim\(\);\r?\n        if \(!customerCode \|\| customerCode === BOOK_FAIR_CODE \|\| customerCode === PERSONAL_CODE\) \{\r?\n          customerResolverFailed = true;\r?\n        \}/;
  const revised = fs.readFileSync('lib/pilot-core.mjs', 'utf8');
  const original = 'export default (function () {' + body + '})();\n';
  const approvedRouting =
    /        if \(taxId !== '52399254'\) \{\r?\n          customerCode = PERSONAL_CODE;\r?\n        \} else \{\r?\n[\s\S]*?\r?\n        \}(?=\r?\n      \} else if \(carrier\))/;
  assert.ok(originalRouting.test(original));
  assert.ok(approvedRouting.test(revised));
  assert.equal(
    revised
      .replace(approvedRouting, original.match(originalRouting)[0])
      .replaceAll('\r\n', '\n'),
    original.replaceAll('\r\n', '\n'),
  );
  assert.ok(collectEris({ eri: '0H50010LU0000001' }).has('0H50010LU0000001'));
});

test('Personal tax invoices retain CMPID and separate mixed-tax slices with customer 305', () => {
  const clients = {
    personal: order('personal', [item('T'), item('E')], {
      invoiceInfo: { taxId: '12345678' },
      bookFairCustomerCode: 'AA01', // Old selection must not route a personal invoice to church.
    }),
    general: order('general', [item('E')]),
  };
  const before = JSON.stringify(clients);
  const final = finalizePilotExport(prepare(clients), {
    generateERI: generator(),
  });
  const personal = objects(final.rows.stkSale1).filter(
    (m) => m.CMPID === '12345678',
  );
  assert.equal(personal.length, 2);
  assert.deepEqual(
    personal.map((m) => m.TAXCATE),
    [0, 1],
  );
  assert.ok(
    personal.every(
      (m) =>
        m.CUST === '305' && m.BILCUST === '305' && m.INVNAME === 'POS 現銷',
    ),
  );
  assert.ok(
    objects(final.rows.stkSale2)
      .filter((d) => personal.some((m) => m.ERI === d.MASTERI))
      .every((d) => d.CUST === '305'),
  );
  assert.equal(final.preview.filter((m) => m.customerCode === '305').length, 2);
  assert.equal(JSON.stringify(clients), before);
  assert.equal(final.invoiceTitles[0].pending, false);
});

test('52399254 cannot export without a valid church customer; other tax IDs need no church', () => {
  assert.throws(
    () =>
      prepare({
        a: order('a', [item('T')], { invoiceInfo: { taxId: '52399254' } }),
      }),
    /客戶 resolver/,
  );
  assert.doesNotThrow(() =>
    prepare({
      a: order('a', [item('T')], { invoiceInfo: { taxId: '12345678' } }),
    }),
  );
  const final = finalizePilotExport(
    prepare({
      a: order('a', [item('T')], {
        invoiceInfo: { taxId: '52399254' },
        bookFairCustomerCode: 'AA01',
      }),
    }),
    { generateERI: generator() },
  );
  const master = objects(final.rows.stkSale1)[0];
  assert.equal(master.CUST, 'AA01');
  assert.equal(master.CMPID, '52399254');
});

test('Formal invoices always check POS cash sale and electronic invoice without changing source defaults', () => {
  const source = prepare({
    general: order('general', [item('T'), item('E')]),
    donation: order('donation', [item('E')], {
      invoiceInfo: { donationCode: '12345' },
    }),
    church: order('church', [item('T')], {
      invoiceInfo: { taxId: '12345678' },
      bookFairCustomerCode: 'AA01',
    }),
  });
  const before = JSON.stringify(source);
  const history = JSON.parse(
    fs.readFileSync('data/pilot-eri-history.json', 'utf8'),
  );
  const forbidden = new Set(history.eris);
  const final = finalizePilotExport(source, {
    generateERI: generator(),
    usedEris: forbidden,
  });
  for (const master of objects(final.rows.stkSale1)) {
    assert.equal(master.PAYCASH, 1);
    assert.equal(master.EINVFLAG, 1);
    assert.equal(master.INVCATE, 2);
  }
  assert.equal(JSON.stringify(source), before);
  assert.ok(final.newEris.every((eri) => !forbidden.has(eri)));
  assert.ok(history.eris.some((eri) => eri.startsWith('0H50010LU0')));
  final.rows.stkSale1[1][Pilot.STKSALE1_HEADER.indexOf('EINVFLAG')] = 0;
  assert.throws(() => validateFinalExport(final, source), /勾選/);
});

test('Book-fair adjustments all link to exempt, can exceed its sales and keep taxable math', () => {
  const clients = {
    a: order('a', [item('T', 500), item('E', 100)], {
      paymentRecords: [
        { method: 'LINE PAY', amount: 300 },
        { method: '現金', amount: 300 },
      ],
    }),
  };
  const before = JSON.stringify(clients);
  const final = finalizePilotExport(prepare(clients), {
    generateERI: generator(),
  });
  const [taxable, exempt] = objects(final.rows.stkSale1);
  assert.deepEqual(
    [taxable.AMT, taxable.TAX, taxable.PLUSSUB, taxable.TOTAL],
    [476, 24, 0, 500],
  );
  assert.deepEqual(
    [exempt.AMT, exempt.TAX, exempt.PLUSSUB, exempt.TOTAL],
    [100, 0, -300, -200],
  );
  assert.equal(objects(final.rows.vchrplus)[0].SRCERI, exempt.ERI);
  assert.equal(final.preview[1].total, -200);
  assert.equal(final.voucherPreview[0].code, exempt.CODE);
  assert.equal(JSON.stringify(clients), before);
});

test('Book-fair payment methods form separate chronological blocks without netting source records', () => {
  const clients = {
    late: order('late', [item('T', 100)], {
      createdAt: '2026-09-08T03:00:00Z',
    }),
    card: order('card', [item('E', 40)], {
      createdAt: '2026-09-08T01:00:00Z',
      paymentRecords: [{ method: '信用卡', amount: 40 }],
    }),
    culture: order('culture', [item('E', 50)], {
      createdAt: '2026-09-08T00:30:00Z',
      paymentRecords: [{ method: '文化幣', amount: 50 }],
    }),
    early: order('early', [item('E', 30)], {
      createdAt: '2026-09-08T10:00:00+08:00',
    }),
    refund: order('refund', [item('E', -20)], {
      createdAt: '2026-09-08T01:00:00Z',
    }),
  };
  const final = finalizePilotExport(prepare(clients), {
    generateERI: generator(),
  });
  const payments = objects(final.rows.vchrplus);
  assert.deepEqual(
    final.voucherPreview.map((p) => p.transactionId),
    ['refund', 'early', 'late', 'culture', 'card'],
  );
  assert.deepEqual(
    payments.map((p) => [p.SERIAL, p.CODE, p.SUBJNO, p.AMT]),
    [
      [0, '51', '1144.358', 20],
      [1, '51', '1144.358', -30],
      [2, '51', '1144.358', -100],
      [3, '61', '1144.61', -50],
      [4, '5', '1144.355', -40],
    ],
  );
  const exempt = objects(final.rows.stkSale1).find((m) => m.TAXCATE === 1);
  assert.ok(payments.every((p) => p.SRCERI === exempt.ERI));
});

test('Taxable-only payments use a unique exempt adjustment master, without fabricated goods', () => {
  const final = finalizePilotExport(
    prepare({
      a: order('a', [item('T')]),
      separate: order('z', [item('E')], {
        invoiceInfo: { carrier: '/C-43+N2' },
      }),
    }),
    { generateERI: generator() },
  );
  const masters = objects(final.rows.stkSale1);
  assert.deepEqual(
    masters.map((m) => [m.CODE, m.INVNO]),
    [
      ['1152778', 'FR13223935'],
      ['11527781', 'FR13223936'],
      ['1152779', 'FR13223937'],
    ],
  );
  assert.deepEqual(
    [
      masters[1].TAXCATE,
      masters[1].AMT,
      masters[1].QTY,
      masters[1].COST,
      masters[1].TOTAL,
    ],
    [1, 0, 0, 0, -100],
  );
  assert.equal(
    objects(final.rows.stkSale2).filter((d) => d.MASTERI === masters[1].ERI)
      .length,
    0,
  );
  assert.equal(final.preview[1].adjustmentOnly, true);
  assert.match(masters[2].REMARK, /^載具：\/C-43\+N2$/);
  assert.equal(final.mappings[0].masters.length, 2);
  const cash = finalizePilotExport(
    prepare({
      a: order('a', [item('T')], {
        paymentRecords: [{ method: '現金', amount: 100 }],
      }),
    }),
    { generateERI: generator() },
  );
  assert.equal(cash.rows.stkSale1.length, 2);
});

test('Adjustment-only and offsetting payments retain every signed nonzero record', () => {
  for (const [amount, records, expected] of [
    [300, [{ method: '文化幣', amount: 300 }], -300],
    [-300, [{ method: '信用卡', amount: -300 }], 300],
    [
      0,
      [
        { method: 'LINE PAY', amount: 50 },
        { method: 'LINE PAY', amount: -50 },
      ],
      0,
    ],
  ]) {
    const final = finalizePilotExport(
      prepare({ a: order('a', [], { amount, paymentRecords: records }) }),
      { generateERI: generator() },
    );
    const [master] = objects(final.rows.stkSale1);
    assert.deepEqual(
      [
        master.TAXCATE,
        master.AMT,
        master.TAX,
        master.QTY,
        master.PLUSSUB,
        master.TOTAL,
      ],
      [1, 0, 0, 0, expected, expected],
    );
    assert.equal(final.rows.stkSale2.length, 1);
    assert.equal(final.rows.vchrplus.length - 1, records.length);
    assert.equal(master.CODE, context.firstCode);
  }
  assert.throws(
    () =>
      prepare({
        a: order('a', [item('E')], {
          paymentRecords: [{ method: 'LINE PAY', amount: '' }],
        }),
      }),
    /未填寫/,
  );
  assert.throws(
    () =>
      prepare({
        a: order('a', [item('E')], {
          paymentRecords: [{ method: 'LINE PAY', amount: 99 }],
        }),
      }),
    /不一致/,
  );
  const zero = finalizePilotExport(
    prepare({
      a: order('a', [item('E', 0)], {
        paymentRecords: [{ method: 'LINE PAY', amount: 0 }],
      }),
    }),
    { generateERI: generator() },
  );
  assert.equal(zero.rows.vchrplus.length, 1);
  assert.equal(objects(zero.rows.stkSale2)[0].INVQTY, 1);
});

test('Independent carriers, donations and tax invoices keep their original capped tax allocation', () => {
  const clients = {
    a: order('a', [item('T'), item('E')], {
      invoiceInfo: { carrier: '/C-43+N2' },
    }),
    b: order('b', [item('T'), item('E')], {
      invoiceInfo: { donationCode: '12345' },
    }),
    c: order('c', [item('T'), item('E')], {
      invoiceInfo: { taxId: '23101590', invoiceName: '實際買受人' },
    }),
  };
  const prepared = prepare(clients);
  const final = finalizePilotExport(prepared, { generateERI: generator() });
  const masters = objects(final.rows.stkSale1);
  assert.equal(masters.length, 6);
  assert.ok(masters.every((m) => m.PLUSSUB === -100 && m.TOTAL === 0));
  assert.equal(final.invoiceTitles[0].pending, false);
  assert.equal(masters[4].CUST, '305');
  assert.equal(masters[4].CMPID, '23101590');
  assert.equal(masters[4].INVNAME, '實際買受人');
  assert.equal(masters[4].REMARK, '');
  assert.match(masters[2].REMARK, /捐贈：12345/);
  const supplied = preparePilotSources({
    clients: { c: { ...clients.c, invoiceInfo: { taxId: '23101590' } } },
    products,
    customerMap,
    unitMap: { 1: '本' },
    context,
    invoiceNames: { c: '確認後的抬頭' },
  });
  assert.equal(
    finalizePilotExport(supplied, { generateERI: generator() }).preview[0]
      .customer,
    '確認後的抬頭',
  );
});

test('Known imported reference numbers and invoice numbers produce conflicts rather than automatic renumbering', () => {
  const reference = JSON.parse(
    fs.readFileSync('data/pilot-known-imports.json', 'utf8'),
  );
  assert.equal(reference.eris.length, 317);
  assert.equal(new Set(reference.eris).size, 317);
  for (const ctx of [
    { ...context, firstCode: reference.codes[0] },
    { ...context, firstInvoice: reference.invoices[0] },
  ])
    assert.throws(
      () =>
        finalizePilotExport(prepare({ a: order('a', [item('E')]) }, ctx), {
          generateERI: generator(),
        }),
      /已成功匯入 PILOT/,
    );
});

test('Already issued invoices preserve their source identities and reject missing mixed-tax mappings or duplicates', () => {
  const sources = {
    a: order('a', [item('E')], { invoiceInfo: { invoiceNo: 'AA12345678' } }),
    b: order('b', [item('E')], { invoiceInfo: { invoiceNo: 'AA12345679' } }),
  };
  const final = finalizePilotExport(prepare(sources), {
    generateERI: generator(),
  });
  assert.deepEqual(
    objects(final.rows.stkSale1).map((m) => m.INVNO),
    ['AA12345678', 'AA12345679'],
  );
  assert.notEqual(final.mappings[0].baseCode, final.mappings[1].baseCode);
  const mixed = {
    a: order('a', [item('T'), item('E')], {
      invoiceInfo: { invoiceNo: 'AA12345678' },
    }),
  };
  assert.throws(
    () => finalizePilotExport(prepare(mixed), { generateERI: generator() }),
    /原始發票對應/,
  );
  mixed.a.invoiceInfo = {
    invoiceNumbers: { 0: 'AA12345678', 1: 'AA12345679' },
  };
  assert.deepEqual(
    objects(
      finalizePilotExport(prepare(mixed), { generateERI: generator() }).rows
        .stkSale1,
    ).map((m) => m.INVNO),
    ['AA12345678', 'AA12345679'],
  );
  sources.b.invoiceInfo.invoiceNo = sources.a.invoiceInfo.invoiceNo;
  assert.throws(
    () => finalizePilotExport(prepare(sources), { generateERI: generator() }),
    /重複/,
  );
});
