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
  cat.data.products.length === 2126 && cat.data.customers.length === 515,
  'Catalog and customer seed counts',
);
const a = (
  await call('events', {
    name: '驗證用書展 A',
    date: '2026-09-06',
    tenant: 'aa01',
    pricing: 'website',
  })
).data.id;
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
  paymentMethod: '現金',
  paymentRecords: [{ method: '現金', amount: 899 }],
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
      church,
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
  paymentMethod: '現金退款',
  paymentRecords: [{ method: '現金', amount: -50 }],
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
await call('events/' + a + '/archive', {});
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
