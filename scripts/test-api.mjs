import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = process.env.TEST_ORIGIN || 'http://localhost:3000';
let admin = fs.readFileSync('work/admin-cookie.txt', 'utf8');
async function call(path, body, cookie = admin) {
  const r = await fetch(origin + '/api/' + path, {
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined
      ? {}
      : { method: 'POST', body: JSON.stringify(body) }),
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get('set-cookie')?.split(';')[0],
  };
}
let checks = 0;
const ok = (truth, label) => {
  assert.ok(truth, label);
  checks++;
  console.log(label);
};
ok(
  (await call('events', undefined, '')).status === 401,
  'Anonymous operational data denied',
);
const cat = await call('catalog');
ok(
  cat.data.products.length === 2130 && cat.data.customers.length === 515,
  'Catalog and customer seed counts',
);
const b = (
  await call('events', {
    name: '驗證用書展 B',
    date: '2026-09-06',
    tenant: '',
    pricing: 'legacy',
  })
).data.id;
const pw = 'Test-' + crypto.randomUUID();
await call('churches', { code: 'AA01', password: pw });
const church = (await call('login', { tenant: 'aa01', password: pw }, ''))
  .cookie;
const a = (
  await call(
    'events',
    { name: '驗證用教會書展 A', date: '2026-09-06', pricing: 'website' },
    church,
  )
).data.id;
ok(
  (await call('events/' + b, undefined, church)).status === 404,
  'Church cannot read another fair',
);
ok(
  (await call('events/' + b + '/sync', { changes: [] }, church)).status === 404,
  'Church cannot write another fair',
);
ok(
  (await call('churches', undefined, church)).status === 403,
  'Church cannot administer passwords',
);
ok(
  (await call('catalog', undefined, church)).data.customers.every((c) =>
    ['AA01', '0002', '305'].includes(c.code),
  ),
  'Church customer catalog is scoped',
);
const order = (id) => ({
  id,
  transactionId: id,
  createdAt: '2026-09-06T12:00:00+08:00',
  isValid: true,
  items: [
    { code: 'C296', name: '見證集', price: 899, quantity: 1, discount: 100 },
  ],
  amount: 899,
  paymentMethod: 'LINE PAY',
  paymentRecords: [{ method: 'LINE PAY', amount: 899 }],
  invoiceInfo: {},
  accountingCustomer: { code: '0002', name: '書展' },
  bookFairCustomerCode: '',
});
const patches = ['a', 'b'].map((id) => ({
  key: 'order:' + id,
  before: null,
  after: order(id),
}));
const results = await Promise.all(
  patches.map((p) => call('events/' + a + '/sync', { changes: [p] }, church)),
);
ok(
  results.every((r) => r.status === 200),
  'Concurrent independent checkouts both commit',
);
ok(
  (await call('events/' + a)).data.state['order:b']?.amount === 899,
  'New session reads durable orders',
);
ok(
  (await call('events/' + a + '/sync', { changes: [patches[0]] }, church))
    .status === 200,
  'Repeated checkout is idempotent',
);
const current = (await call('events/' + a)).data;
const edit = { ...order('a'), note: '修訂' };
await call(
  'events/' + a + '/sync',
  { changes: [{ key: 'order:a', before: order('a'), after: edit }] },
  church,
);
ok(
  (
    await call(
      'events/' + a + '/sync',
      {
        changes: [
          {
            key: 'order:a',
            before: order('a'),
            after: { ...order('a'), note: '衝突' },
          },
        ],
      },
      church,
    )
  ).status === 409,
  'Conflicting update is rejected',
);
ok(
  (
    await call(
      'events/' + a + '/sync',
      { changes: [{ key: 'stock:C296', before: null, after: -100 }] },
      admin,
    )
  ).status === 200,
  'Negative reference inventory accepted',
);
ok(
  (
    await call(
      'events/' + a + '/sync',
      {
        changes: [
          {
            key: 'order:bad',
            before: null,
            after: { ...order('bad'), amount: 1 },
          },
        ],
      },
      church,
    )
  ).status === 400,
  'Incorrect order total rejected',
);
const eri = await Promise.all([
  call('events/' + a + '/eri', { count: 100 }),
  call('events/' + b + '/eri', { count: 100 }),
]);
ok(
  eri[0].data.end <= eri[1].data.start || eri[1].data.end <= eri[0].data.start,
  'Pilot ERI allocation is globally disjoint',
);
const closing = await call('events/' + a + '/close', {
  day: '2026-09-06',
  counts: { drawer: 1798, initial: 0 },
  expenses: 0,
  notes: '驗證',
});
ok(
  closing.data.snapshot.totals.revenue === 1798,
  'Daily closing preserves exact revenue',
);
const backup = await call('events/' + a + '/backup');
ok(
  backup.data.audit.length >= 3 && backup.data.closings.length === 1,
  'Persistent audit and closing included in backup',
);
const favoriteCodes = JSON.stringify(['C296', 'C291']);
await call(
  'events/' + a + '/sync',
  {
    changes: [{ key: 'shared:favorites', before: null, after: favoriteCodes }],
  },
  church,
);
ok(
  (await call('events/' + a)).data.state['shared:favorites'] ===
    favoriteCodes &&
    !(await call('events/' + b)).data.state['shared:favorites'],
  'Favorites persist across sessions and remain scoped to the fair',
);
const voucher = {
  ...order('voucher'),
  items: [{ code: 'R', name: '折抵', price: -50, quantity: 1, discount: 100 }],
  amount: -50,
  paymentMethod: 'LINE PAY退款',
  paymentRecords: [{ method: 'LINE PAY', amount: -50 }],
};
ok(
  (
    await call(
      'events/' + a + '/sync',
      { changes: [{ key: 'order:voucher', before: null, after: voucher }] },
      church,
    )
  ).status === 200 &&
    (await call('events/' + a)).data.state['order:voucher'].amount === -50,
  'Negative unit-price adjustment persists with exact refund amount',
);
const boot = await call('bootstrap', undefined, church);
ok(
  boot.status === 200 &&
    boot.data.me.role === 'church' &&
    boot.data.events.every((e) => e.tenant === 'aa01') &&
    boot.data.catalog.customers.length <= 3,
  'Single bootstrap keeps the church scope',
);
const numbered = (await call('events/' + a)).data;
const numberA = numbered.numbers.a,
  numberB = numbered.numbers.b;
ok(
  /^AA0120260906\d{4,}$/.test(numberA) &&
    Math.abs(Number(numberA.slice(12)) - Number(numberB.slice(12))) === 1,
  'Concurrent checkouts allocate consecutive human-readable numbers',
);
await call('events/' + a + '/sync', { changes: [patches[1]] }, church);
ok(
  (await call('events/' + a)).data.numbers.b === numberB,
  'Retry preserves shipment number',
);
ok(
  (
    await call(
      'events/' + a + '/sync',
      { changes: [{ key: 'stock:C296', before: -100, after: 20 }] },
      church,
    )
  ).status === 403,
  'Church cannot change inventory through the API',
);
for (const method of ['現金', '信用卡']) {
  const bad = {
    ...order('forbidden-' + method),
    paymentMethod: method,
    paymentRecords: [{ method, amount: 899 }],
  };
  ok(
    (
      await call(
        'events/' + a + '/sync',
        { changes: [{ key: 'order:' + bad.id, before: null, after: bad }] },
        church,
      )
    ).status === 403,
    'Church cannot submit ' + method + ' payments',
  );
}
ok(
  (await call('shipments', undefined, church)).status === 403 &&
    (await call('events/' + a + '/backup', undefined, church)).status === 403 &&
    (await call('events/' + a + '/eri', { count: 100 }, church)).status === 403,
  'Church cannot use cross-church shipment, backup or accounting export endpoints',
);
const beforeEdit = (await call('events/' + a)).data.state['order:a'];
const afterEdit = {
  ...beforeEdit,
  items: [
    { code: 'C291', name: '替換商品', price: 200, quantity: 3, discount: 80 },
  ],
  amount: 480,
  paymentMethod: '文化幣(100) + LINE PAY(380)',
  paymentRecords: [
    { method: '文化幣', amount: 100 },
    { method: 'LINE PAY', amount: 380 },
  ],
};
ok(
  (
    await call(
      'events/' + a + '/sync',
      { changes: [{ key: 'order:a', before: beforeEdit, after: afterEdit }] },
      church,
    )
  ).status === 200,
  'Existing shipment contents and supported split payments can be revised',
);
const afterRecord = (await call('events/' + a)).data;
ok(
  afterRecord.numbers.a === numberA &&
    afterRecord.state['order:a'].items[0].code === 'C291' &&
    afterRecord.state['order:a'].amount === 480,
  'Edited order retains its number and persists replacement items',
);
ok(
  (
    await call(
      'events/' + a + '/sync',
      {
        changes: [
          {
            key: 'order:a',
            before: beforeEdit,
            after: { ...afterEdit, note: 'outdated' },
          },
        ],
      },
      church,
    )
  ).status === 409,
  'Stale shipment editor cannot overwrite another change',
);
await call('events/' + b + '/sync', {
  changes: [{ key: 'order:store', before: null, after: order('store') }],
});
ok(
  /^PF20260906\d{4,}$/.test((await call('events/' + b)).data.numbers.store),
  'Bookstore-created fairs use PF prefix',
);
const hub = await call('shipments?tenant=aa01');
ok(
  hub.status === 200 &&
    hub.data.every((o) => o.tenant === 'aa01') &&
    hub.data.some((o) => o.number === numberA),
  'Bookstore can filter all church shipment records',
);
await call(
  'events/' + a + '/sync',
  { changes: [{ key: 'order:b', before: order('b'), after: null }] },
  church,
);
await call(
  'events/' + a + '/sync',
  { changes: [{ key: 'order:next', before: null, after: order('next') }] },
  church,
);
ok(
  Number((await call('events/' + a)).data.numbers.next.slice(12)) >
    Math.max(Number(numberA.slice(12)), Number(numberB.slice(12))),
  'Deleting a shipment never reuses its sequence',
);
const selfFair = (
  await call(
    'events',
    {
      name: '教會自行建立驗證',
      date: '2026-09-08',
      tenant: 'aa02',
      pricing: 'website',
    },
    church,
  )
).data.id;
await call(
  'events/' + selfFair + '/sync',
  { changes: [{ key: 'order:self', before: null, after: order('self') }] },
  church,
);
const selfRecord = (await call('events/' + selfFair)).data;
ok(
  selfRecord.organizer === 'church' &&
    selfRecord.tenant === 'aa01' &&
    /^AA0120260906\d{4,}$/.test(selfRecord.numbers.self),
  'Church-created fairs have their own organizer and independent church sequence',
);
const allFairs = (await call('events')).data;
ok(
  allFairs.find((e) => e.id === b).organizer === 'bookstore' &&
    allFairs.find((e) => e.id === selfFair).organizer === 'church',
  'Fair lists can distinguish the creator rather than the assigned tenant',
);
const beforeExport = (await call('events/' + a)).data.state;
const context = {
  date: '2026/09/08',
  firstCode: '1152778',
  firstInvoice: 'FR13223935',
};
ok(
  (await call('events/' + a + '/pilot-preview', context, church)).status ===
    403,
  'Only bookstore can prepare a formal PILOT export',
);
const export1 = await call('events/' + a + '/pilot-preview', context);
ok(
  export1.status === 200 && export1.data.preview.length > 0,
  'Formal export builds a persisted preview before allowing CSV download',
);
const csv1 = await call('events/' + a + '/pilot-confirm', {
  id: export1.data.id,
});
ok(
  csv1.status === 200 &&
    csv1.data.rows.stkSale1.length === export1.data.counts.masters + 1,
  'Confirmed export retrieves all three validated CSV tables',
);
const masterHeaders = csv1.data.rows.stkSale1[0];
ok(
  csv1.data.rows.stkSale1
    .slice(1)
    .every(
      (row) =>
        row[masterHeaders.indexOf('PAYCASH')] === 1 &&
        row[masterHeaders.indexOf('EINVFLAG')] === 1 &&
        row[masterHeaders.indexOf('INVCATE')] === 2,
    ),
  'Formal CSV checks POS cash sale and electronic invoice using the reference schema',
);
const historicalEris = new Set(
  JSON.parse(fs.readFileSync('data/pilot-eri-history.json', 'utf8')).eris,
);
ok(
  Object.values(csv1.data.rows).every((rows) =>
    rows.slice(1).every((row) => !historicalEris.has(row[0])),
  ),
  'Formal ERIs avoid the supplied historical church shipment CSVs',
);
const export2 = await call('events/' + a + '/pilot-preview', context);
const csv2 = await call('events/' + a + '/pilot-confirm', {
  id: export2.data.id,
});
const eris1 = new Set(
  Object.values(csv1.data.rows).flatMap((rows) =>
    rows.slice(1).map((row) => row[0]),
  ),
);
ok(
  csv2.status === 200 &&
    Object.values(csv2.data.rows).every((rows) =>
      rows.slice(1).every((row) => !eris1.has(row[0])),
    ),
  'Repeated exports allocate fully disjoint ERIs from the persistent ledger',
);
ok(
  JSON.stringify((await call('events/' + a)).data.state) ===
    JSON.stringify(beforeExport),
  'Formal CODE, invoice and ERI never overwrite original POS state',
);
const editSource = beforeExport['order:a'];
await call(
  'events/' + a + '/sync',
  {
    changes: [
      {
        key: 'order:a',
        before: editSource,
        after: { ...editSource, note: 'changed after preview' },
      },
    ],
  },
  church,
);
ok(
  (await call('events/' + a + '/pilot-confirm', { id: export2.data.id }))
    .status === 409,
  'A stale preview is rejected after the source transaction changes',
);
const parallelExports = await Promise.all([
  call('events/' + b + '/pilot-preview', context),
  call('events/' + b + '/pilot-preview', context),
]);
const parallelRows = await Promise.all(
  parallelExports.map((p) =>
    call('events/' + b + '/pilot-confirm', { id: p.data.id }),
  ),
);
const parallelEris = parallelRows.flatMap((p) =>
  Object.values(p.data.rows).flatMap((rows) =>
    rows.slice(1).map((row) => row[0]),
  ),
);
ok(
  new Set(parallelEris).size === parallelEris.length,
  'Concurrent formal exports cannot reuse an ERI',
);
const groupedFair = (
  await call('events', {
    name: '合併現銷匯出驗證',
    date: '2026-09-08',
    tenant: '',
    pricing: 'legacy',
  })
).data.id;
const groupedOrders = [
  order('blank'),
  { ...order('donation'), invoiceInfo: { donationCode: '2995' } },
  { ...order('carrier1'), invoiceInfo: { carrier: '/ABC1234' } },
  { ...order('carrier2'), invoiceInfo: { carrier: '/ABC1234' } },
];
await call('events/' + groupedFair + '/sync', {
  changes: groupedOrders.map((after) => ({
    key: 'order:' + after.id,
    before: null,
    after,
  })),
});
const groupedPreview = (
  await call('events/' + groupedFair + '/pilot-preview', context)
).data;
ok(
  groupedPreview.counts.masters === 3 &&
    groupedPreview.preview[0].sourceIds.length === 2,
  'Preview merges blank and default donation invoices while showing both source orders',
);
const groupedExport = (
  await call('events/' + groupedFair + '/pilot-confirm', {
    id: groupedPreview.id,
  })
).data;
const groupedMappings = new Map(
  groupedExport.mappings.map((m) => [m.transactionId, m]),
);
ok(
  groupedMappings.get('blank').baseCode ===
    groupedMappings.get('donation').baseCode &&
    groupedMappings.get('carrier1').baseCode !==
      groupedMappings.get('carrier2').baseCode,
  'Persisted final mapping shares one base for general sales and preserves separate carrier orders',
);
const groupedState = (await call('events/' + groupedFair)).data.state;
ok(
  groupedOrders.every(
    (o) => JSON.stringify(groupedState['order:' + o.id]) === JSON.stringify(o),
  ),
  'Consolidated accounting export leaves all original POS orders separate and unchanged',
);
await call('events/' + groupedFair + '/archive', {});
await call('events/' + selfFair + '/archive', {}, church);
await call('events/' + a + '/archive', {}, church);
ok(
  (await call('events/' + a + '/sync', { changes: [] }, church)).status === 409,
  'Archived fair blocks operational writes',
);
await call('events/' + b + '/archive', {});
fs.writeFileSync('work/test-events.json', JSON.stringify({ a, b }));
fs.writeFileSync(
  'work/api-results.json',
  JSON.stringify({ checks, at: new Date().toISOString() }),
);
console.log(`${checks} integration checks passed`);
