import fs from 'node:fs';
import assert from 'node:assert/strict';
import { applyPromotions } from '../lib/promotions.mjs';
import { resolveProductPricing } from '../lib/pos-core.mjs';
const origin = 'http://localhost:3000',
  admin = fs.readFileSync('work/admin-cookie.txt', 'utf8');
async function call(path, body, cookie = admin) {
  const r = await fetch(origin + '/api/' + path, {
    headers: {
      Origin: origin,
      Cookie: cookie,
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
const ok = (v, label) => {
  assert.ok(v, label);
  checks++;
  console.log(label);
};
const tenant = 'aa02';
const password = 'Test-' + crypto.randomUUID();
await call('churches', { code: tenant, password });
const church = (await call('login', { tenant, password }, '')).cookie;
let inventory = (await call('church-stock/' + tenant)).data;
ok(
  (
    await call('church-stock/' + tenant, {
      mode: 'set',
      text: 'C175,20\nC188,20',
      revision: inventory.revision,
    })
  ).status === 200,
  'Bookstore seeds inventory before new fairs exist',
);
const a = (
  await call(
    'events',
    { name: '庫存與活動驗證A', date: '2026-09-13', pricing: 'website' },
    church,
  )
).data.id;
const b = (
  await call(
    'events',
    { name: '庫存與活動驗證B', date: '2026-09-13', pricing: 'website' },
    church,
  )
).data.id;
inventory = (await call('church-stock/' + tenant, undefined, church)).data;
ok(
  inventory.rows.find((r) => r.code === 'C175').available === 20,
  'Newly created church fairs can read preconfigured inventory',
);
ok(
  (await call('church-stock/aa01', undefined, church)).status === 404,
  'Other church stock is private',
);
ok(
  (
    await call(
      'church-stock/' + tenant,
      { mode: 'add', text: 'C175,1', revision: inventory.revision },
      church,
    )
  ).status === 403,
  'Church cannot edit shared inventory',
);
let catalog = (await call('catalog', undefined, church)).data;
ok(
  catalog.pricingRules.groups.filter((g) => g.id.startsWith('website-bogo-'))
    .length === 7,
  'All seven official promotions reach churches',
);
const raw = {
  ...resolveProductPricing(catalog.products.find((p) => p.code === 'C175')),
  quantity: 1,
  discount: 100,
  promotionGiftCode: 'C188',
};
const lines = applyPromotions(
  [
    raw,
    {
      ...resolveProductPricing(catalog.products.find((p) => p.code === 'C188')),
      quantity: 1,
      discount: 100,
    },
  ],
  catalog.products,
  catalog.pricingRules.groups,
);
ok(
  lines.length === 2 && lines[1].code === 'C188' && lines[1].discount === 0,
  'Scanned product resolves a selectable official gift at zero price',
);
const order = (id) => ({
  id,
  transactionId: id,
  createdAt: new Date().toISOString(),
  isValid: true,
  items: lines,
  amount: 250,
  paymentMethod: 'LINE PAY',
  paymentRecords: [{ method: 'LINE PAY', amount: 250 }],
  invoiceInfo: {},
  accountingCustomer: { code: '0002', name: '書展' },
  bookFairCustomerCode: '',
});
for (const [event, id] of [
  [a, 'gift-a'],
  [b, 'gift-b'],
])
  ok(
    (
      await call(
        'events/' + event + '/sync',
        { changes: [{ key: 'order:' + id, before: null, after: order(id) }] },
        church,
      )
    ).status === 200,
    'BOGO paid and gift lines persist with exact payment',
  );
inventory = (await call('church-stock/' + tenant, undefined, church)).data;
ok(
  inventory.rows.find((r) => r.code === 'C175').available === 18 &&
    inventory.rows.find((r) => r.code === 'C188').available === 18,
  'Two fairs share stock and deduct sold books plus free gifts',
);
const saved = (await call('events/' + a)).data.state['order:gift-a'];
await call(
  'events/' + a + '/sync',
  { changes: [{ key: 'order:gift-a', before: saved, after: null }] },
  church,
);
ok(
  (await call('church-stock/' + tenant)).data.rows.find(
    (r) => r.code === 'C188',
  ).available === 19,
  'Deleting a sale restores its gift inventory',
);
const preview = await call('events/' + b + '/pilot-preview', {
  date: '2026/09/13',
  firstCode: '1152990',
  firstInvoice: 'FR13224901',
});
ok(
  preview.status === 200,
  'Legacy PILOT accepts paid and zero-price gift lines',
);
ok(
  (await call('events/' + b + '/pilot-confirm', { id: preview.data.id }))
    .status === 200,
  'PILOT finalization validates the gift shipment',
);
catalog = (await call('catalog')).data;
const group = {
  id: 'api-promotion-test',
  name: '測試階梯',
  type: 'tiers',
  codes: ['C175', 'C188'],
  priority: -1,
  tiers: [
    { quantity: 1, mode: 'discount', value: 79 },
    { quantity: 3, mode: 'discount', value: 75 },
    { quantity: 6, mode: 'discount', value: 69 },
  ],
};
ok(
  (await call('catalog/group', { revision: catalog.pricingRevision, group }))
    .status === 200,
  'Global quantity group can be saved',
);
ok(
  (await call('catalog/group', { revision: catalog.pricingRevision, group }))
    .status === 409,
  'Concurrent activity changes reject stale revisions',
);
catalog = (await call('catalog', undefined, church)).data;
const discounted = applyPromotions(
  [{ ...raw, quantity: 3 }],
  catalog.products,
  catalog.pricingRules.groups,
);
ok(
  discounted.length === 1 && discounted[0].discount === 75,
  'Higher priority group applies once without adding a conflicting gift',
);
await call('catalog/group', {
  revision: catalog.pricingRevision,
  group: { ...group, disabled: true },
});
await call('events/' + a + '/archive', {}, church);
await call('events/' + b + '/archive', {}, church);
console.log(checks + ' promotion and shared-stock integration checks passed');
