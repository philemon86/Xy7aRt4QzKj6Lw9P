import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(
  'CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE events(id TEXT PRIMARY KEY,state TEXT); CREATE TABLE audit(id TEXT PRIMARY KEY,state TEXT);',
);
for (const file of [
  'drizzle/0002_puzzling_sauron.sql',
  'drizzle/0003_cute_the_professor.sql',
])
  sqlite.exec(fs.readFileSync(file, 'utf8'));
const db = {
  prepare(sql) {
    let values = [];
    const query = {
      bind(...args) {
        values = args;
        return query;
      },
      async first() {
        return sqlite.prepare(sql).get(...values) || null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
      async run() {
        return sqlite.prepare(sql).run(...values);
      },
    };
    return query;
  },
  async batch(queries) {
    sqlite.exec('BEGIN');
    try {
      const result = [];
      for (const query of queries) result.push(await query.run());
      sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};
globalThis.__pilotServiceTestEnv = { DB: db };
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers')
      return {
        url: 'data:text/javascript,export const env = globalThis.__pilotServiceTestEnv;',
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { previewPilot, confirmPilot } = await import('../lib/pilot-service.ts');
hooks.deregister();
const context = {
  date: '2026-10-08',
  firstCode: '999000001',
  firstInvoice: 'ZZ00100001',
};
const catalog = {
  products: [
    { code: 'T', name: '應稅', ntaxFlag: '0', cost: 15, unitCode: '1' },
  ],
  customers: [
    { code: '0002', name: '書展', invoiceName: '書展' },
    { code: '305', name: '個人', invoiceName: '個人' },
  ],
  units: { 1: '本' },
};
const order = {
  id: 'source-a',
  transactionId: 'source-a',
  createdAt: '2026-10-08T01:00:00Z',
  isValid: true,
  amount: 500,
  paymentRecords: [{ method: 'LINE PAY', amount: 500 }],
  items: [{ code: 'T', price: 500, discount: 100, quantity: 1 }],
  invoiceInfo: {},
};
const event = (id, source = order) => ({
  id,
  state: JSON.stringify({ 'order:source-a': source }),
});
const eriColumn = (rows) =>
  Object.values(rows).flatMap((table) => table.slice(1).map((row) => row[0]));

test('Formal preview/confirm saves a matched CP950 snapshot; repeat download is identical and new previews get new ERIs', async () => {
  const source = event('service-test');
  const original = source.state;
  const first = await previewPilot(source, catalog, context, {
    'source-a': 'PF-SOURCE',
  });
  assert.deepEqual(first.counts, { masters: 2, details: 1, vouchers: 1 });
  assert.equal(first.preview[1].total, -500);
  const confirmed = await confirmPilot(source, first.id);
  const repeat = await confirmPilot(source, first.id);
  assert.deepEqual(repeat.files, confirmed.files);
  assert.equal(confirmed.encoding, 'CP950');
  const masterBytes = Buffer.from(confirmed.files.stkSale1, 'base64');
  assert.equal(masterBytes[0], 34);
  assert.match(new TextDecoder('big5').decode(masterBytes), /書展/);
  assert.equal(confirmed.rows.stkSale2[1][26], '');
  const second = await previewPilot(source, catalog, context, {});
  const secondConfirmed = await confirmPilot(source, second.id);
  const firstEris = new Set(eriColumn(confirmed.rows));
  assert.ok(
    eriColumn(secondConfirmed.rows).every((eri) => !firstEris.has(eri)),
  );
  assert.equal(source.state, original);
  source.state = JSON.stringify({
    'order:source-a': { ...order, note: '已修改' },
  });
  await assert.rejects(() => confirmPilot(source, first.id), /交易內容已變更/);
});

test('Tax ID alone can be confirmed; optional export titles do not overwrite orders', async () => {
  const source = event('title-test', {
    ...order,
    invoiceInfo: { taxId: '23101590' },
  });
  const before = source.state;
  const preview = await previewPilot(source, catalog, context, {});
  assert.equal(preview.invoiceTitles[0].pending, false);
  const noTitle = await confirmPilot(source, preview.id);
  const h = noTitle.rows.stkSale1[0];
  assert.equal(noTitle.rows.stkSale1[1][h.indexOf('INVNAME')], '個人');
  assert.equal(noTitle.rows.stkSale1[1][h.indexOf('CMPID')], '23101590');
  assert.equal(noTitle.rows.stkSale1[1][h.indexOf('CUST')], '305');
  assert.match(
    new TextDecoder('big5').decode(
      Buffer.from(noTitle.files.stkSale1, 'base64'),
    ),
    /23101590/,
  );
  // An otherwise valid V35 preview remains downloadable despite its obsolete title flag.
  const parts = sqlite
    .prepare(
      'SELECT data FROM pilot_export_parts WHERE export_id=? ORDER BY part',
    )
    .all(preview.id);
  const oldSnapshot = JSON.parse(parts.map((p) => p.data).join(''));
  oldSnapshot.invoiceTitles[0].pending = true;
  sqlite
    .prepare('DELETE FROM pilot_export_parts WHERE export_id=?')
    .run(preview.id);
  sqlite
    .prepare(
      'INSERT INTO pilot_export_parts(export_id,part,data) VALUES(?,?,?)',
    )
    .run(preview.id, 0, JSON.stringify(oldSnapshot));
  sqlite
    .prepare('UPDATE pilot_exports SET snapshot=? WHERE id=?')
    .run(JSON.stringify({ parts: 1 }), preview.id);
  assert.deepEqual(
    (await confirmPilot(source, preview.id)).files,
    noTitle.files,
  );
  const updated = await previewPilot(
    source,
    catalog,
    { ...context, invoiceNames: { 'source-a': '實際公司抬頭' } },
    {},
  );
  const confirmed = await confirmPilot(source, updated.id);
  const header = confirmed.rows.stkSale1[0],
    master = confirmed.rows.stkSale1[1];
  assert.equal(master[header.indexOf('INVNAME')], '實際公司抬頭');
  assert.equal(master[header.indexOf('CMPID')], '23101590');
  assert.equal(master[header.indexOf('CUST')], '305');
  assert.equal(source.state, before);
});

test('Unencodable text cannot save a partly downloadable preview; legacy previews require regeneration', async () => {
  const source = event('encoding-test', { ...order, note: '附註😀' });
  const before = sqlite
    .prepare('SELECT count(*) AS n FROM pilot_exports')
    .get().n;
  await assert.rejects(
    () => previewPilot(source, catalog, context, {}),
    /STKSALE1.csv.*REMARK.*附註😀/,
  );
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM pilot_exports').get().n,
    before,
  );
  const good = event('legacy-test');
  const preview = await previewPilot(good, catalog, context, {});
  const parts = sqlite
    .prepare(
      'SELECT part,data FROM pilot_export_parts WHERE export_id=? ORDER BY part',
    )
    .all(preview.id);
  const snapshot = JSON.parse(parts.map((part) => part.data).join(''));
  delete snapshot.formatVersion;
  sqlite
    .prepare('DELETE FROM pilot_export_parts WHERE export_id=?')
    .run(preview.id);
  sqlite
    .prepare(
      'INSERT INTO pilot_export_parts(export_id,part,data) VALUES(?,?,?)',
    )
    .run(preview.id, 0, JSON.stringify(snapshot));
  sqlite
    .prepare('UPDATE pilot_exports SET snapshot=? WHERE id=?')
    .run(JSON.stringify({ parts: 1 }), preview.id);
  await assert.rejects(() => confirmPilot(good, preview.id), /規則已更新/);
});
