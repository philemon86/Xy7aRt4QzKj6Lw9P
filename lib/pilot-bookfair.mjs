import { itemTotal } from './pos-core.mjs';
import Pilot from './pilot-core.mjs';

// The account codes are the existing PILOT mapping, verified against the
// successfully imported reference. They are adjustment codes, not sale numbers.
export const PAYMENT_ACCOUNTS = Object.freeze({
  'LINE PAY': { code: '51', subject: '1144.358', order: 0 },
  文化幣: { code: '61', subject: '1144.61', order: 1 },
  信用卡: { code: '5', subject: '1144.355', order: 2 },
});
const round = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const objects = (rows) =>
  rows
    .slice(1)
    .map((row) =>
      Object.fromEntries(rows[0].map((field, i) => [field, row[i]])),
    );
const rowsFor = (header, items) => [
  header,
  ...items.map((item) => header.map((field) => item[field] ?? '')),
];

export function comparePilotSources(a, b) {
  const time = (c) => {
    const value = c.createdAt;
    const parsed =
      typeof value === 'number' ? value : Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return (
    time(a) - time(b) ||
    String(a.transactionId || a.id || '').localeCompare(
      String(b.transactionId || b.id || ''),
      'en',
      { numeric: true },
    )
  );
}

// Resolve payments without the legacy per-tax-slice sale cap. Keep the legacy
// recovery for old zero-total orders, but retain explicit offsetting payments.
export function bookFairPayments(client) {
  if (
    Array.isArray(client.paymentRecords) &&
    client.paymentRecords.some(
      (record) => record.amount == null || String(record.amount).trim() === '',
    )
  )
    throw Error(
      '來源交易 ' + (client.transactionId || client.id) + '：付款金額未填寫',
    );
  const allocated = (client.items || []).reduce(
    (sum, item) =>
      sum +
      itemTotal(item, client.roundingMode || 'legacy'),
    0,
  );
  const saved = Number(client.amount);
  const recover =
    Number.isFinite(saved) && round(saved) === 0 && allocated !== 0;
  const amount =
    Number.isFinite(saved) && !recover ? Math.round(saved) : allocated;
  let records =
    Array.isArray(client.paymentRecords) && client.paymentRecords.length
      ? Pilot.getPaymentRecords({ ...client, amount: 1 })
      : Pilot.getPaymentRecords({ ...client, amount });
  if (
    recover &&
    round(
      records.reduce(
        (sum, r) => sum + (Number.isFinite(r.amount) ? r.amount : 0),
        0,
      ),
    ) === 0
  )
    records = Pilot.getPaymentRecords({
      paymentMethod: client.paymentMethod,
      amount,
    });
  if (
    !Number.isFinite(amount) ||
    records.some((r) => !Number.isFinite(r.amount)) ||
    round(records.reduce((sum, r) => sum + r.amount, 0)) !== round(amount)
  )
    throw Error(
      '來源交易 ' +
        (client.transactionId || client.id) +
        '：付款金額與交易金額不一致',
    );
  return { amount, records };
}

function adjustmentMaster(template, customer, context, generateERI) {
  const date = context.date;
  const result = template
    ? { ...template }
    : Object.fromEntries(Pilot.STKSALE1_HEADER.map((key) => [key, '']));
  return {
    ...result,
    ERI: generateERI('master'),
    CODE: 'ADJUSTMENT',
    STAFF: template?.STAFF || '02',
    CUST: '0002',
    BILCUST: '0002',
    SDATE: date,
    INVDATE: date,
    BILDATE: date,
    RADVDATE: date,
    CURR: 'NTD',
    RATE: 1,
    GWN: template?.GWN || '0000',
    DPTNO: '0000',
    COMPNO: '0000',
    TAXCATE: 1,
    TAX: 0,
    AMT: 0,
    QTY: 0,
    COST: 0,
    PLUSSUB: 0,
    TOTAL: 0,
    EDITOR: 'POS',
    TYPE: 0,
    SRCERI: '',
    INVNO: '',
    CMPID: '',
    INVNAME: customer?.invoiceName || customer?.name || '書展',
    INVCATE: 2,
    EINVFLAG: 1,
    PAYCASH: 1,
    PRNIMMED: 0,
    PRNONCE: 0,
    ACCGEN: 0,
    INVAMT: 0,
    PRINTX: 0,
    NORCV: 0,
    LASTUPD: template?.LASTUPD || date.replaceAll('/', '').slice(2) + '000000',
  };
}

// Only general book-fair groups call this layer. Goods and their tax calculation
// come from the existing exporter; payments are attached to the exempt master.
export function allocateBookFairPayments({
  result,
  sources,
  context,
  customerMap,
  generateERI,
}) {
  const masters = objects(result.rows.stkSale1);
  const payments = [];
  for (const source of sources) {
    source.payments ||= bookFairPayments(source.source);
    source.adjustmentTaxCates = [];
    source.payments.records.forEach((record, index) => {
      const account = PAYMENT_ACCOUNTS[record.method];
      if (!account || record.amount === 0) return;
      source.adjustmentTaxCates = [1];
      payments.push({
        source,
        index,
        method: record.method,
        account,
        amount: -record.amount,
      });
    });
  }
  payments.sort(
    (a, b) =>
      a.account.order - b.account.order ||
      comparePilotSources(a.source.source, b.source.source) ||
      a.index - b.index,
  );
  let exempt = masters.find((m) => Number(m.TAXCATE) === 1);
  if (payments.length && !exempt) {
    if (!customerMap['0002']) throw Error('找不到書展客戶 0002');
    exempt = adjustmentMaster(
      masters[0],
      customerMap['0002'],
      context,
      generateERI,
    );
    masters.push(exempt);
  }
  const vouchers = payments.map((payment, serial) => ({
    ERI: generateERI('pay'),
    SRCERI: exempt.ERI,
    SERIAL: serial,
    CODE: payment.account.code,
    SUBJNO: payment.account.subject,
    OP: 0,
    AMT: payment.amount,
    REMARK: '',
    APCODE: '',
    LASTUPD: exempt.LASTUPD,
  }));
  for (const master of masters) {
    master.PLUSSUB =
      master === exempt
        ? round(vouchers.reduce((sum, v) => sum + v.AMT, 0))
        : 0;
    master.TOTAL = round(
      Number(master.AMT) + Number(master.TAX) + master.PLUSSUB,
    );
  }
  result.rows.stkSale1 = rowsFor(Pilot.STKSALE1_HEADER, masters);
  result.rows.vchrplus = rowsFor(Pilot.VCHRPLUS_HEADER, vouchers);
  result.paymentSources = payments.map((p, i) => ({
    sourceId: p.source.sourceId,
    transactionId: p.source.identity,
    createdAt: p.source.source.createdAt || '',
    method: p.method,
    recordIndex: p.index,
    amount: p.amount,
    sourceERI: vouchers[i].ERI,
  }));
  result.audit = {
    ...result.audit,
    stkSale1Count: masters.length,
    voucherCount: vouchers.length,
    bookFairExemptPayments: {
      count: vouchers.length,
      total: round(vouchers.reduce((sum, v) => sum + v.AMT, 0)),
      methods: Object.keys(PAYMENT_ACCOUNTS).map((method) => ({
        method,
        amount: round(
          payments
            .filter((p) => p.method === method)
            .reduce((sum, p) => sum + p.amount, 0),
        ),
      })),
    },
  };
  validatePilotBalances(result.rows);
  return result;
}

export function validatePilotBalances(rows) {
  const masters = objects(rows.stkSale1);
  const details = objects(rows.stkSale2);
  const vouchers = objects(rows.vchrplus);
  const totals = new Map(
    masters.map((m) => [
      m.ERI,
      { amount: 0, qty: 0, adjustment: 0, serial: 0 },
    ]),
  );
  for (const detail of details) {
    const total = totals.get(detail.MASTERI);
    if (!total) throw Error('商品明細找不到主單');
    total.amount += Number(detail.AMT);
    total.qty += Number(detail.QTY);
  }
  for (const voucher of vouchers) {
    const total = totals.get(voucher.SRCERI);
    if (!total) throw Error('付款加減項找不到主單');
    if (Number(voucher.SERIAL) !== total.serial++)
      throw Error('付款加減項 SERIAL 必須從 0 連續編號');
    total.adjustment += Number(voucher.AMT);
  }
  for (const master of masters) {
    const total = totals.get(master.ERI);
    if (
      [master.AMT, master.TAX, master.QTY, master.PLUSSUB, master.TOTAL].some(
        (n) => !Number.isFinite(Number(n)),
      ) ||
      round(total.amount) !== round(master.AMT) ||
      round(total.qty) !== round(master.QTY) ||
      round(total.adjustment) !== round(master.PLUSSUB) ||
      round(
        Number(master.AMT) + Number(master.TAX) + Number(master.PLUSSUB),
      ) !== round(master.TOTAL)
    )
      throw Error('主單、商品明細與付款加減項金額／數量不平：' + master.CODE);
    if (Number(master.TAXCATE) === 1 && Number(master.TAX) !== 0)
      throw Error('免稅主單 TAX 必須為 0');
  }
  return true;
}
