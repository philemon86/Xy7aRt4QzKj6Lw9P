import fs from 'node:fs';
import assert from 'node:assert/strict';
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
const password = 'Test-' + crypto.randomUUID();
await call('churches', { code: 'AA02', password });
const church = (await call('login', { tenant: 'aa02', password }, '')).cookie;
ok(
  (
    await call('events', {
      name: '不應建立',
      tenant: 'aa02',
      date: '2026-09-12',
      pricing: 'website',
    })
  ).status === 403,
  'Bookstore cannot create a church checkout fair',
);
const fair = await call(
  'events',
  { name: '', date: '2026-09-12', pricing: 'website' },
  church,
);
ok(fair.status === 200, 'Church creates its own fair without entering a name');
let record = (await call('events/' + fair.data.id, undefined, church)).data;
const expected =
  'AA02' +
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replaceAll('-', '');
ok(
  record.name === expected && record.organizer === 'church',
  'Default name uses church code and Taiwan creation date',
);
ok(
  (
    await call('events/' + record.id + '/rename', {
      name: '自行改名',
      before: record.name,
    })
  ).status === 403,
  'Bookstore cannot rename church fairs',
);
ok(
  (
    await call(
      'events/' + record.id + '/rename',
      { name: '自行改名', before: record.name },
      church,
    )
  ).status === 200,
  'Church can rename its own fair',
);
ok(
  (
    await call(
      'events/' + record.id + '/rename',
      { name: '過期', before: record.name },
      church,
    )
  ).status === 409,
  'Concurrent rename rejects stale names',
);
ok(
  (
    await call('events/' + record.id + '/sync', {
      changes: [{ key: 'stock:C291', before: null, after: 15 }],
    })
  ).status === 200,
  'Bookstore can import stock into church-created fairs',
);
ok(
  (await call('events/' + record.id, undefined, church)).data.state[
    'stock:C291'
  ] === 15,
  'Church sees the inventory supplied by bookstore',
);
ok(
  (
    await call('events/' + record.id + '/sync', {
      changes: [{ key: 'order:bad', before: null, after: {} }],
    })
  ).status === 403,
  'Bookstore cannot create or modify church transactions',
);
ok(
  (
    await call(
      'catalog/pricing',
      { scope: 'products', code: 'C291', rule: { mode: 'price', value: 15 } },
      church,
    )
  ).status === 403,
  'Church cannot change global prices',
);
ok(
  (await call('catalog/import', { text: '' }, church)).status === 403,
  'Church cannot upload product master data',
);
let cat = (await call('catalog')).data;
const oldRule = cat.pricingRules.products.C291;
const ruleBody = {
  scope: 'products',
  code: 'C291',
  revision: cat.pricingRevision,
  rule: { mode: 'price', value: 123 },
};
ok(
  (await call('catalog/pricing', ruleBody)).status === 200,
  'Bookstore can persist a permanent individual price',
);
ok(
  (await call('catalog/pricing', ruleBody)).status === 409,
  'Global pricing rejects stale writes',
);
cat = (await call('catalog', undefined, church)).data;
ok(
  resolveProductPricing(cat.products.find((p) => p.code === 'C291')).price ===
    123,
  'Church reads the shared individual price above website prices',
);
await call('catalog/pricing', {
  scope: 'products',
  code: 'C291',
  revision: cat.pricingRevision,
  rule: oldRule || { disabled: true },
});
cat = (await call('catalog')).data;
const original = cat.products.find((p) => p.code === 'C291');
const csv =
  'CODE,CNAME,PRICE1,CLAS,NTAXFLAG,BARCODE,UNIT,CCOST\nC291,CSV更新搜尋名稱,500,02-1,1,978TEST,本,0';
ok(
  (await call('catalog/import', { text: csv, revision: cat.catalogRevision }))
    .status === 200,
  'PRODUCT CSV import persists validated master data',
);
ok(
  (await call('catalog/import', { text: csv, revision: cat.catalogRevision }))
    .status === 409,
  'CSV import rejects stale revisions',
);
cat = (await call('catalog', undefined, church)).data;
const imported = cat.products.find((p) => p.code === 'C291');
ok(
  imported.name === 'CSV更新搜尋名稱' &&
    imported.csvName === imported.name &&
    imported.websitePrice === original.websitePrice,
  'CSV names reach church catalogs without losing website price cache',
);
const all = JSON.parse(fs.readFileSync('data/catalog.json', 'utf8')).products;
const quote = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
const restore =
  'CODE,CNAME,PRICE1,CLAS,NTAXFLAG,BARCODE,UNIT,CCOST\n' +
  all
    .map((p) =>
      [p.code, p.name, p.price, p.class, p.ntaxFlag, p.barcode, p.unit, p.cost]
        .map(quote)
        .join(','),
    )
    .join('\n');
ok(
  (
    await call('catalog/import', {
      text: restore,
      revision: cat.catalogRevision,
    })
  ).status === 200,
  'Full supplied product catalog fits durable storage and restores test prices',
);
ok(
  typeof (await call('catalog/version', undefined, church)).data.version ===
    'string',
  'Open registers can check a lightweight catalog revision',
);
await call('events/' + record.id + '/archive', {}, church);
console.log(checks + ' catalog/ownership integration checks passed');
