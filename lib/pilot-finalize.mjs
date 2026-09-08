import Pilot from './pilot-core.mjs';

export const DATE_FIELDS = {
  stkSale1: ['SDATE', 'INVDATE', 'BILDATE', 'RADVDATE'],
  stkSale2: ['SDATE'],
  vchrplus: [],
};
// Checked POS cash sale + electronic invoice, matching the supplied PILOT CSV schema.
export const FORMAL_INVOICE_FLAGS = Object.freeze({
  PAYCASH: 1,
  EINVFLAG: 1,
  INVCATE: 2,
});
const HEADERS = {
  stkSale1: Pilot.STKSALE1_HEADER,
  stkSale2: Pilot.STKSALE2_HEADER,
  vchrplus: Pilot.VCHRPLUS_HEADER,
};
const PREFIX = { master: '0H5', detail: '0H8', pay: '01E' };
const objects = (rows) =>
  rows
    .slice(1)
    .map((row) =>
      Object.fromEntries(rows[0].map((key, index) => [key, row[index]])),
    );
const rowsFor = (key, items) => [
  HEADERS[key],
  ...items.map((item) => HEADERS[key].map((field) => item[field] ?? '')),
];
export function exportContext(input) {
  const date = String(input?.date || '').replaceAll('-', '/');
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(date))
    throw Error('出貨日期格式須為 YYYY/MM/DD');
  const [year, month, day] = date.split('/').map(Number);
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (
    checked.getUTCFullYear() !== year ||
    checked.getUTCMonth() !== month - 1 ||
    checked.getUTCDate() !== day
  )
    throw Error('出貨日期不存在');
  const firstCode = String(input?.firstCode || '').trim();
  if (!/^\d{1,20}$/.test(firstCode))
    throw Error('第一筆正式出貨單號須為 1–20 碼數字');
  const firstInvoice = String(input?.firstInvoice || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}\d{8}$/.test(firstInvoice))
    throw Error('發票號碼須為兩碼英文字母加 8 碼數字');
  return { date, firstCode, firstInvoice };
}
export function collectEris(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return new Set(
    [...text.matchAll(/"((?:0H5|0H8|01E)[A-Za-z0-9]{13})"/g)].map(
      (match) => match[1],
    ),
  );
}

// Keep the legacy grouping: blank/default donation invoices share a book-fair
// group; carriers, tax IDs and other donation codes remain separate transactions.
export function preparePilotSources({
  clients,
  products,
  customerMap,
  unitMap,
  context,
}) {
  const ctx = exportContext(context);
  let temp = 0;
  const generateERI = (type) =>
    PREFIX[type] + 'TMPPOS0' + String(++temp).padStart(6, '0');
  const identities = new Set();
  const general = [],
    separate = [],
    batches = [];
  for (const [key, client] of Object.entries(clients)
    .filter(([, c]) => c?.isValid)
    .sort(([, a], [, b]) =>
      String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id)),
    )) {
    const identity = String(client.transactionId || client.id || key).trim();
    if (identities.has(identity))
      throw Error('來源 transaction id 重複：' + identity);
    identities.add(identity);
    const invoice = client.invoiceInfo || {};
    const donation = String(invoice.donationCode || '').trim();
    const source = {
      key,
      identity,
      sourceId: client.id || key,
      source: client,
      taxCates: [
        ...new Set(
          (client.items || []).map((item) => {
            const code = String(item?.code || '').trim();
            const product = products[code || item?.barcode];
            return String(product?.ntaxFlag).trim() === '1' ? 1 : 0;
          }),
        ),
      ],
    };
    if (
      !String(invoice.taxId || '').trim() &&
      !String(invoice.carrier || '').trim() &&
      (!donation || donation === '2995')
    )
      general.push(source);
    else separate.push([source]);
  }
  for (const sources of [...(general.length ? [general] : []), ...separate]) {
    const result = Pilot.buildPilotExport({
      clients: Object.fromEntries(
        sources.map((s) => [s.key, structuredClone(s.source)]),
      ),
      products,
      customerMap,
      unitMap,
      generateERI,
      now: new Date(ctx.date.replaceAll('/', '-') + 'T00:00:00Z'),
    });
    if (!result.ok)
      throw Error(
        '來源交易 ' +
          sources.map((s) => s.identity).join('、') +
          '：' +
          result.validationErrors.join('；'),
      );
    batches.push({
      sources,
      result,
    });
  }
  if (!batches.some((b) => b.result.rows.stkSale1.length > 1))
    throw Error('沒有可正式匯出的交易');
  return { context: ctx, batches };
}

export function finalizePilotExport(
  prepared,
  { generateERI, usedEris = new Set(), numbers = {} },
) {
  const context = exportContext(prepared.context);
  const used = new Set(usedEris);
  for (const batch of prepared.batches)
    for (const eri of collectEris([batch.sources, batch.result])) used.add(eri);
  const forbidden = new Set(used),
    newEris = [];
  const allocate = (type) => {
    for (let n = 0; n < 10000; n++) {
      const eri = String(generateERI(type));
      if (
        new RegExp('^' + PREFIX[type] + '[A-Za-z0-9]{13}$').test(eri) &&
        !used.has(eri)
      ) {
        used.add(eri);
        newEris.push(eri);
        return eri;
      }
    }
    throw Error('無法分配不重複的正式 ERI');
  };
  const output = { stkSale1: [], stkSale2: [], vchrplus: [] };
  const mappings = [],
    preview = [];
  let invoice = Number(context.firstInvoice.slice(2));
  let code = BigInt(context.firstCode);
  for (const batch of prepared.batches) {
    const sourceMasters = objects(batch.result.rows.stkSale1);
    const baseCode = String(code).padStart(context.firstCode.length, '0');
    if (!sourceMasters.length) {
      for (const source of batch.sources)
        mappings.push({
          sourceId: source.sourceId,
          transactionId: source.identity,
          baseCode: null,
          masters: [],
          skipped: true,
        });
      continue;
    }
    code += BigInt(1); // One base per legacy group, regardless of source count or tax slices.
    if (
      sourceMasters.length > 2 ||
      new Set(sourceMasters.map((m) => Number(m.TAXCATE))).size !==
        sourceMasters.length
    )
      throw Error('來源交易的稅別主單不符合一應稅、一免稅規則');
    const mixed =
      sourceMasters.some((m) => Number(m.TAXCATE) === 0) &&
      sourceMasters.some((m) => Number(m.TAXCATE) === 1);
    const masterMap = new Map(),
      groupMasters = [];
    for (const original of sourceMasters) {
      if (invoice > 99999999)
        throw Error('發票號碼已超出 8 碼範圍，請調整第一張發票號碼');
      const master = {
        ...original,
        ...FORMAL_INVOICE_FLAGS,
        ERI: allocate('master'),
        CODE: baseCode + (mixed && Number(original.TAXCATE) === 1 ? '1' : ''),
        INVNO:
          context.firstInvoice.slice(0, 2) + String(invoice++).padStart(8, '0'),
      };
      for (const field of DATE_FIELDS.stkSale1) master[field] = context.date;
      masterMap.set(original.ERI, master);
      output.stkSale1.push(master);
      groupMasters.push({
        sourceERI: original.ERI,
        eri: master.ERI,
        code: master.CODE,
        invoice: master.INVNO,
        taxCate: master.TAXCATE,
      });
      const sources = batch.sources.filter((s) =>
        s.taxCates.includes(Number(master.TAXCATE)),
      );
      const sourceNumbers = sources.map(
        (s) => numbers[s.sourceId] || s.sourceId,
      );
      preview.push({
        sourceId: sources[0]?.sourceId,
        transactionId: sources[0]?.identity,
        sourceIds: sources.map((s) => s.sourceId),
        transactionIds: sources.map((s) => s.identity),
        sourceNumbers,
        consolidated: batch.sources.length > 1,
        sourceNumber:
          sourceNumbers.length > 1
            ? '合併 ' + sourceNumbers.length + ' 筆交易'
            : sourceNumbers[0],
        customer: master.INVNAME || master.CUST,
        customerCode: master.CUST,
        carrier:
          sources.length === 1
            ? sources[0].source.invoiceInfo?.carrier || ''
            : '',
        taxCate: master.TAXCATE,
        code: master.CODE,
        invoice: master.INVNO,
        date: context.date,
      });
    }
    for (const original of objects(batch.result.rows.stkSale2)) {
      const master = masterMap.get(original.MASTERI);
      if (!master) throw Error('明細找不到來源主單');
      const detail = {
        ...original,
        ERI: allocate('detail'),
        MASTERI: master.ERI,
        CODE: master.CODE,
        INVNO: master.INVNO,
      };
      for (const field of DATE_FIELDS.stkSale2) detail[field] = context.date;
      output.stkSale2.push(detail);
    }
    for (const original of objects(batch.result.rows.vchrplus)) {
      const master = masterMap.get(original.SRCERI);
      if (!master) throw Error('付款加減項找不到來源主單');
      output.vchrplus.push({
        ...original,
        ERI: allocate('pay'),
        SRCERI: master.ERI,
      });
    }
    for (const source of batch.sources) {
      const masters = groupMasters.filter((m) =>
        source.taxCates.includes(Number(m.taxCate)),
      );
      mappings.push({
        sourceId: source.sourceId,
        transactionId: source.identity,
        baseCode: masters.length ? baseCode : null,
        masters,
        ...(masters.length ? {} : { skipped: true }),
      });
    }
  }
  const rows = Object.fromEntries(
    Object.entries(output).map(([key, items]) => [key, rowsFor(key, items)]),
  );
  const snapshot = {
    context,
    rows,
    mappings,
    preview,
    newEris,
    sourceAudits: prepared.batches.map((b) => ({
      transactionIds: b.sources.map((s) => s.identity),
      audit: b.result.audit,
    })),
  };
  validateFinalExport(snapshot, prepared, forbidden);
  return snapshot;
}

export function validateFinalExport(snapshot, prepared, forbidden = new Set()) {
  const output = Object.fromEntries(
    Object.entries(snapshot.rows).map(([key, rows]) => [key, objects(rows)]),
  );
  const seen = new Set(),
    codes = new Set(),
    invoices = new Set();
  for (const [key, rows] of Object.entries(snapshot.rows)) {
    if (
      JSON.stringify(rows[0]) !== JSON.stringify(HEADERS[key]) ||
      rows.some((row) => row.length !== HEADERS[key].length)
    )
      throw Error('正式 CSV 欄位順序或數量錯誤');
    for (const row of output[key]) {
      if (seen.has(row.ERI) || forbidden.has(row.ERI))
        throw Error('正式 ERI 重複或沿用來源／歷史 ERI');
      seen.add(row.ERI);
      for (const field of DATE_FIELDS[key])
        if (row[field] !== snapshot.context.date)
          throw Error('正式匯出日期不一致');
    }
  }
  for (const master of output.stkSale1) {
    for (const [field, value] of Object.entries(FORMAL_INVOICE_FLAGS))
      if (master[field] !== value)
        throw Error('正式匯出須勾選 POS 現銷與電子發票：' + field);
    if (codes.has(master.CODE) || invoices.has(master.INVNO))
      throw Error('正式單號或發票號碼重複，請調整起號');
    if (!/^[A-Z]{2}\d{8}$/.test(master.INVNO)) throw Error('正式發票格式錯誤');
    codes.add(master.CODE);
    invoices.add(master.INVNO);
  }
  const masters = new Map(output.stkSale1.map((m) => [m.ERI, m]));
  for (const detail of output.stkSale2) {
    const master = masters.get(detail.MASTERI);
    if (
      !master ||
      detail.CODE !== master.CODE ||
      detail.INVNO !== master.INVNO ||
      detail.SDATE !== master.SDATE
    )
      throw Error('正式明細與主單關聯不一致');
  }
  for (const voucher of output.vchrplus)
    if (!masters.has(voucher.SRCERI))
      throw Error('正式付款加減項找不到新主單 ERI');
  // Permit only final identifiers/dates and the explicitly requested invoice flags.
  const allowed = {
    stkSale1: new Set([
      'ERI',
      'CODE',
      'INVNO',
      ...DATE_FIELDS.stkSale1,
      ...Object.keys(FORMAL_INVOICE_FLAGS),
    ]),
    stkSale2: new Set([
      'ERI',
      'MASTERI',
      'CODE',
      'INVNO',
      ...DATE_FIELDS.stkSale2,
    ]),
    vchrplus: new Set(['ERI', 'SRCERI']),
  };
  for (const key of Object.keys(HEADERS)) {
    const source = prepared.batches.flatMap((b) => objects(b.result.rows[key]));
    if (source.length !== output[key].length)
      throw Error('正式匯出變更了原業務資料筆數');
    source.forEach((row, i) => {
      for (const field of HEADERS[key])
        if (
          !allowed[key].has(field) &&
          JSON.stringify(row[field]) !== JSON.stringify(output[key][i][field])
        )
          throw Error('正式匯出不可更動 ' + key + '.' + field);
    });
  }
  return true;
}
