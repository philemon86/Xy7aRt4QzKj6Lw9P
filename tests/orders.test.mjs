import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  formatOrderNumber,
  taipeiDay,
  makePayments,
  paymentLabel,
  validateRoleChange,
  orderTotal,
} from '../lib/orders.mjs';
import { validateOrder, mergeChanges, stats } from '../lib/state.mjs';
test('Shipment numbers use PF or church prefix, Taiwan full date and independent sequences', () => {
  const day = taipeiDay('2026-09-06T16:10:00Z');
  assert.equal(day, '2026-09-07');
  assert.equal(formatOrderNumber('aa01', day, 1), 'AA01202609070001');
  assert.equal(formatOrderNumber('', day, 12, 'bookstore'), 'PF202609070012');
  assert.equal(
    formatOrderNumber('aa01', day, 1000, 'bookstore'),
    'PF202609071000',
  );
});
test('Church stock and payment permissions are enforced independent of the visible controls', () => {
  assert.throws(
    () =>
      validateRoleChange('church', 'aa01', { key: 'stock:C296', after: 10 }),
    /書房/,
  );
  validateRoleChange('admin', '', { key: 'stock:C296', after: 10 });
  for (const method of ['現金', '信用卡'])
    assert.throws(
      () =>
        validateRoleChange('church', 'aa01', {
          key: 'order:a',
          after: { paymentRecords: [{ method, amount: 10 }] },
        }),
      /LINE PAY/,
    );
  validateRoleChange('church', 'aa01', {
    key: 'order:a',
    after: {
      paymentRecords: [
        { method: '文化幣', amount: 10 },
        { method: 'LINE PAY', amount: 20 },
      ],
    },
  });
});
test('Editing replaces items, preserves identity and updates payment and stock totals together', () => {
  const before = {
    id: 'one',
    transactionId: 'one',
    createdAt: '2026-09-07T03:00:00Z',
    isValid: true,
    items: [
      { code: 'A', name: '舊品', price: 100, quantity: 1, discount: 100 },
    ],
    amount: 100,
    paymentMethod: 'LINE PAY',
    paymentRecords: [{ method: 'LINE PAY', amount: 100 }],
  };
  const items = [
      { code: 'B', name: '新品', price: 150, quantity: 3, discount: 80 },
    ],
    amount = orderTotal(items);
  const payments = makePayments(amount, '文化幣 + LINE PAY', 100);
  const after = {
    ...before,
    items,
    amount,
    paymentRecords: payments,
    paymentMethod: paymentLabel(payments, amount),
  };
  validateOrder(after);
  validateRoleChange('church', 'aa01', { key: 'order:one', after }, before);
  const state = mergeChanges({ 'order:one': before }, [
    { key: 'order:one', before, after },
  ]);
  assert.equal(stats(state).revenue, 360);
  assert.equal(stats(state).quantity, 3);
  assert.equal(stats(state).payments['LINE PAY'], 260);
  assert.equal(after.id, before.id);
  assert.throws(() =>
    validateRoleChange(
      'admin',
      '',
      { key: 'order:one', after: { ...after, createdAt: '2027-01-01' } },
      before,
    ),
  );
  assert.throws(
    () =>
      mergeChanges(state, [
        { key: 'order:one', before, after: { ...after, amount: 300 } },
      ]),
    /另一台/,
  );
});
test('Church splits, zero orders and refunds produce exact supported payment records', () => {
  assert.deepEqual(makePayments(100, '文化幣 + LINE PAY', 30), [
    { method: '文化幣', amount: 30 },
    { method: 'LINE PAY', amount: 70 },
  ]);
  assert.deepEqual(makePayments(-100, '文化幣 + LINE PAY', 30), [
    { method: '文化幣', amount: -30 },
    { method: 'LINE PAY', amount: -70 },
  ]);
  assert.deepEqual(makePayments(0, 'LINE PAY'), []);
  assert.equal(
    paymentLabel(makePayments(-100, 'LINE PAY'), -100),
    'LINE PAY退款',
  );
  assert.throws(() => makePayments(100, '文化幣 + LINE PAY', 100.5));
  assert.throws(() => makePayments(100, '文化幣 + LINE PAY', 30.5));
});
test('Register reuses parent preload and performs no duplicate catalog or event downloads', async () => {
  let requests = 0,
    bootstraps = 0;
  const context = {
    URLSearchParams,
    location: { search: '?event=event1', origin: 'http://local' },
    crypto,
    structuredClone,
    fetch: () => {
      requests++;
      throw Error('Duplicate request');
    },
    setInterval() {},
    setTimeout() {},
    clearTimeout() {},
    parent: {
      POSRegisterBootstrap: async (id) => {
        assert.equal(id, 'event1');
        bootstraps++;
        return {
          event: { id, state: {}, numbers: { a: 'AA010907-001' } },
          catalog: { products: [] },
          me: { role: 'church' },
        };
      },
      postMessage() {},
    },
    document: { getElementById: () => null, addEventListener() {} },
    window: {
      localStorage: {
        getItem: (key) => (key === 'pos-device' ? 'device1' : null),
      },
      addEventListener() {},
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/bridge.js', 'utf8'), context);
  const cloud = await context.window.makeCloud();
  assert.equal(bootstraps, 1);
  assert.equal(requests, 0);
  assert.equal(cloud.numbers.a, 'AA010907-001');
  assert.equal(cloud.me.role, 'church');
});

async function bridgeHarness(state, fetch, recovery) {
  const local = new Map([['pos-device', 'device1']]);
  if (recovery)
    local.set('pos-recovery:event1:device1', JSON.stringify(recovery));
  const context = {
    URLSearchParams,
    location: { search: '?event=event1', origin: 'http://local' },
    crypto,
    structuredClone,
    fetch,
    setInterval() {},
    setTimeout() {},
    clearTimeout() {},
    confirm: () => true,
    parent: {
      POSRegisterBootstrap: async () => ({
        event: { id: 'event1', state, numbers: {} },
        catalog: { products: [] },
        me: { role: 'church' },
      }),
      postMessage() {},
    },
    document: { getElementById: () => null, addEventListener() {} },
    window: {
      localStorage: {
        getItem: (key) => local.get(key),
        setItem: (key, value) => local.set(key, value),
        removeItem: (key) => local.delete(key),
      },
      addEventListener() {},
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/bridge.js', 'utf8'), context);
  return { cloud: await context.window.makeCloud(), local };
}
const response = (value, ok = true) => ({ ok, json: async () => value });

test('Refresh retains items scanned during an in-flight read and serializes their save', async () => {
  let releaseRead,
    startedRead,
    saves = 0;
  const started = new Promise((resolve) => {
    startedRead = resolve;
  });
  const { cloud } = await bridgeHarness({}, async (path, options) => {
    if (!options.method) {
      startedRead();
      return new Promise((resolve) => {
        releaseRead = () =>
          resolve(
            response({
              state: { 'order:remote': { id: 'remote' } },
              numbers: { remote: 'AA010907-001' },
            }),
          );
      });
    }
    saves++;
    const changes = JSON.parse(options.body).changes;
    assert.equal(changes.length, 1);
    assert.equal(changes[0].key, 'draft:device1:cart');
    return response({
      state: mergeChanges({ 'order:remote': { id: 'remote' } }, changes),
      numbers: { remote: 'AA010907-001' },
    });
  });
  const refreshing = cloud.refresh();
  await started;
  cloud.storage.setItem(
    'cart',
    JSON.stringify([{ code: 'C296', quantity: 1 }]),
  );
  const saving = cloud.flush();
  assert.equal(saves, 0);
  releaseRead();
  await refreshing;
  await saving;
  assert.equal(saves, 1);
  assert.equal(JSON.parse(cloud.storage.getItem('cart'))[0].code, 'C296');
  assert.equal(cloud.snapshot()['order:remote'].id, 'remote');
});

test('Refresh keeps the original conflict baseline when the same order changes during the read', async () => {
  let releaseRead, startedRead;
  const started = new Promise((resolve) => {
    startedRead = resolve;
  });
  const before = { id: 'one', note: 'original' };
  const { cloud, local } = await bridgeHarness(
    { 'order:one': before },
    async (path, options) => {
      if (!options.method) {
        startedRead();
        return new Promise((resolve) => {
          releaseRead = () =>
            resolve(
              response({
                state: { 'order:one': { ...before, note: 'remote edit' } },
                numbers: {},
              }),
            );
        });
      }
      const change = JSON.parse(options.body).changes[0];
      assert.equal(change.before.note, 'original');
      assert.equal(change.after.note, 'local edit');
      return response({ error: '另一台裝置已修改' }, false);
    },
  );
  cloud.storage.getItem('clients');
  const refreshing = cloud.refresh();
  await started;
  cloud.storage.setItem(
    'clients',
    JSON.stringify({ one: { ...before, note: 'local edit' } }),
  );
  releaseRead();
  await refreshing;
  await assert.rejects(cloud.flush(), /另一台/);
  assert.equal(cloud.snapshot()['order:one'].note, 'local edit');
  assert.ok(local.has('pos-recovery:event1:device1'));
});

test('Startup restores a pending order after cloud initialization and keeps its assigned number', async () => {
  const order = { id: 'recovered', note: 'retained' };
  const { cloud, local } = await bridgeHarness(
    {},
    async (path, options) => {
      const changes = JSON.parse(options.body).changes;
      return response({
        state: mergeChanges({}, changes),
        numbers: { recovered: 'AA010907-002' },
      });
    },
    { base: {}, desired: { 'order:recovered': order } },
  );
  assert.equal(cloud.snapshot()['order:recovered'].note, 'retained');
  assert.equal(cloud.numbers.recovered, 'AA010907-002');
  assert.equal(local.has('pos-recovery:event1:device1'), false);
});

test('A blocked legacy payment does not blank the register and can be explicitly corrected without losing its identity', async () => {
  const order = {
    id: 'held',
    amount: 100,
    paymentMethod: '現金',
    paymentRecords: [{ method: '現金', amount: 100 }],
  };
  const { cloud, local } = await bridgeHarness(
    {},
    async (path, options) => {
      const changes = JSON.parse(options.body).changes;
      if (
        changes.some((p) =>
          p.after?.paymentRecords?.some((x) => x.method === '現金'),
        )
      )
        return response({ error: '教會僅開放文化幣與 LINE PAY' }, false);
      return response({
        state: mergeChanges({}, changes),
        numbers: { held: 'PF202609080001' },
      });
    },
    { base: {}, desired: { 'order:held': order } },
  );
  assert.match(cloud.recoveryError, /LINE PAY/);
  assert.equal(cloud.recoveryOrders()[0].id, 'held');
  assert.ok(local.has('pos-recovery:event1:device1'));
  await cloud.resolveRecovery({ held: [{ method: 'LINE PAY', amount: 100 }] });
  assert.equal(cloud.recoveryError, '');
  assert.equal(cloud.snapshot()['order:held'].id, 'held');
  assert.equal(
    JSON.parse(local.get('pos-recovery-original:event1:device1')).desired[
      'order:held'
    ].paymentMethod,
    '現金',
  );
});

test('Churches can preserve a previously saved historical payment while editing a note', () => {
  const before = {
    createdAt: '2026-09-01',
    transactionId: 'old',
    paymentRecords: [{ method: '現金', amount: 100 }],
  };
  validateRoleChange(
    'church',
    'aa01',
    { key: 'order:old', after: { ...before, note: 'checked' } },
    before,
  );
  assert.throws(
    () =>
      validateRoleChange(
        'church',
        'aa01',
        {
          key: 'order:old',
          after: {
            ...before,
            paymentRecords: [{ method: '現金', amount: 101 }],
          },
        },
        before,
      ),
    /LINE PAY/,
  );
});
