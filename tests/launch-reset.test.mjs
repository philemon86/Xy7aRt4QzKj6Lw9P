import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

test('launch reset removes operational records and old accounts while retaining catalog, pricing and cache', () => {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0000_cooing_makkari', '0001_modern_white_tiger', '0002_puzzling_sauron', '0003_cute_the_professor']) {
    db.exec(fs.readFileSync(new URL('../drizzle/' + file + '.sql', import.meta.url), 'utf8'));
  }
  const cleared = ['pilot_export_parts', 'pilot_eris', 'pilot_exports', 'closings', 'audit', 'order_numbers', 'shipment_numbers', 'events', 'sessions', 'limits', 'churches'];
  for (const table of cleared) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    const values = columns.map(c => c.type.toLowerCase() === 'integer' ? 1 : 'old-value');
    db.prepare(`INSERT INTO ${table} (${columns.map(c => c.name).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...values);
  }
  const retained = ['catalog-products', 'global-pricing', 'sync', 'eri'];
  for (const key of [...retained, 'church-stock:aa01']) db.prepare('INSERT INTO settings VALUES (?,?)').run(key, 'original-value');
  db.prepare('INSERT INTO shop VALUES (?,?)').run('C001', 'cached-price');
  db.exec(fs.readFileSync(new URL('../drizzle/0004_launch_reset.sql', import.meta.url), 'utf8'));
  for (const table of cleared.filter(t => t !== 'churches')) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, table);
  const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  const expected = new Set(catalog.customers.map(c => c.code.toLowerCase()).filter(code => !['0002', '305'].includes(code) && /^[a-z0-9_-]{1,24}$/.test(code)));
  const accounts = db.prepare('SELECT * FROM churches').all();
  assert.equal(accounts.length, expected.size);
  for (const account of accounts) {
    assert.ok(expected.has(account.code));
    assert.equal(account.password, '@default');
    assert.equal(account.enabled, 1);
  }
  assert.ok(accounts.some(a => a.code === 'aa01'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM churches WHERE code='old-value'").get().n, 0);
  for (const key of retained) assert.equal(db.prepare('SELECT value FROM settings WHERE key=?').get(key).value, 'original-value');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM settings WHERE key LIKE 'church-stock:%'").get().n, 0);
  assert.equal(db.prepare('SELECT data FROM shop').get().data, 'cached-price');
  db.close();
});
