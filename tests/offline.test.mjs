import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineEngine } from '../lib/offline-engine.mjs';
import { mergeChanges } from '../lib/state.mjs';

const order = (id = 'o1', amount = 100) => ({ id, transactionId: id, createdAt: '2026-10-09T01:00:00Z', items: [{ code: 'C001', name: '書籍', price: amount, quantity: 1, discount: 100 }], amount, isValid: true, paymentMethod: '現金', paymentRecords: [{ method: '現金', amount }] });
const patch = (id = 'o1', before = null, after = order(id)) => ({ key: 'order:' + id, before, after });
function setup() {
  const records = new Map(), server = { id: 'fair', status: 'open', organizer: 'bookstore', state: {}, revision: 0, numbers: {} };
  let connected = true, failWrite = false, lost = false, denial = 0, hold;
  const waits = new Map();
  const store = {
    get: async (k) => structuredClone(records.get(k)),
    put: async (k, v) => { if (failWrite) throw Error('disk full'); records.set(k, structuredClone(v)); },
    all: async () => structuredClone([...records.values()]),
  };
  const lock = async (k, fn) => {
    const next = (waits.get(k) || Promise.resolve()).catch(() => {}).then(fn);
    waits.set(k, next);
    return next;
  };
  let calls = 0;
  const network = async (portal, path, body) => {
    if (!connected) throw TypeError('offline');
    if (denial) throw Object.assign(Error('denied'), { status: denial });
    if (path.endsWith('/sync')) {
      calls++;
      if (hold) await hold;
      server.state = mergeChanges(server.state, body.changes);
      server.revision++;
      for (const p of body.changes) if (p.key.startsWith('order:') && p.after) server.numbers[p.after.id] ||= 'PF' + String(Object.keys(server.numbers).length + 1).padStart(4, '0');
      if (lost) { lost = false; throw TypeError('response lost'); }
      return structuredClone({ ...server });
    }
    if (path === 'bootstrap') return { me: { role: 'admin', tenant: '' }, events: [{ ...server, state: undefined }], catalog: { products: { C001: { price: 100 } } } };
    if (path === 'events/fair') return structuredClone(server);
    return { ok: true };
  };
  const create = () => new OfflineEngine({ store, network, lock, online: () => connected });
  return { store, server, create, set connected(v) { connected = v; }, set failWrite(v) { failWrite = v; }, set lost(v) { lost = v; }, set denial(v) { denial = v; }, set hold(v) { hold = v; }, get calls() { return calls; } };
}
async function prepared(s) {
  const e = s.create();
  await e.request('admin', 'bootstrap');
  await e.request('admin', 'events/fair');
  return e;
}
test('offline checkout survives closing the coordinator and restoring from the device; reconnect syncs once', async () => {
  const s = setup(), e = await prepared(s);
  s.connected = false;
  const result = await e.request('admin', 'events/fair/sync', { changes: [patch()], revision: 0 });
  assert.equal(result.localSaved, true);
  const reopened = s.create();
  const boot = await reopened.request('admin', 'bootstrap');
  assert.equal(boot.events[0].orders, 1);
  assert.equal(boot.events[0].revenue, 100);
  assert.equal((await reopened.request('admin', 'events/fair')).state['order:o1'].amount, 100);
  await reopened.request('admin', 'events/fair/sync', { changes: [patch('o2')], revision: 0 });
  assert.equal((await reopened.summary('admin')).pending, 2);
  s.connected = true;
  await reopened.syncAll('admin');
  await reopened.syncAll('admin');
  assert.equal(Object.keys(s.server.state).length, 2);
  assert.equal((await reopened.summary('admin')).pending, 0);
  assert.ok((await reopened.cached('admin', 'events/fair')).numbers.o1);
});
test('checkout acknowledges device commit while slow server transmission is still pending', async () => {
  const s = setup(), e = await prepared(s);
  let release;
  s.hold = new Promise((r) => { release = r; });
  const result = await e.request('admin', 'events/fair/sync', { changes: [patch()] });
  assert.equal(result.localSaved, true);
  assert.equal(Object.keys(s.server.state).length, 0);
  release();
  await e.syncAll('admin');
  assert.equal(Object.keys(s.server.state).length, 1);
});
test('lost response followed by an edit replays original identity before its later version', async () => {
  const s = setup(), e = await prepared(s);
  s.lost = true;
  await e.request('admin', 'events/fair/sync', { changes: [patch()] });
  // Wait until the persisted transmission has failed after the server accepted it.
  await e.lock('send:' + e.key('admin', 'fair'), async () => {});
  assert.equal(s.server.state['order:o1'].amount, 100);
  s.connected = false;
  await e.request('admin', 'events/fair/sync', { changes: [patch('o1', order(), order('o1', 80))] });
  s.connected = true;
  await e.syncAll('admin');
  assert.equal(s.server.state['order:o1'].amount, 80);
  assert.equal(Object.keys(s.server.numbers).length, 1);
  assert.equal((await e.summary('admin')).pending, 0);
});
test('cancellation during transmission remains queued and does not resurrect an order', async () => {
  const s = setup(), e = await prepared(s);
  let release;
  s.hold = new Promise((r) => { release = r; });
  await e.request('admin', 'events/fair/sync', { changes: [patch()] });
  // Wait for the send snapshot to be durably recorded, without waiting on HTTP.
  for (let i = 0; i < 20 && !(await s.store.get(e.key('admin', 'fair'))).inflight; i++) await new Promise((r) => setImmediate(r));
  await e.request('admin', 'events/fair/sync', { changes: [patch('o1', order(), null)] });
  release();
  await e.syncAll('admin');
  assert.equal(s.server.state['order:o1'], undefined);
  assert.equal((await e.summary('admin')).pending, 0);
});
test('a concurrent server edit returns a retained conflict, never silently overwrites', async () => {
  const s = setup(), e = await prepared(s);
  s.connected = false;
  await e.request('admin', 'events/fair/sync', { changes: [patch()] });
  s.server.state['order:o1'] = order('o1', 70);
  s.connected = true;
  await assert.rejects(e.syncAll('admin', true), (err) => err.status === 409);
  assert.equal(s.server.state['order:o1'].amount, 70);
  assert.equal((await e.summary('admin')).pending, 1);
  assert.match((await e.summary('admin')).error, /另一台/);
});
test('HTTP 401 revokes offline authority and retains orders until re-login', async () => {
  const s = setup(), e = await prepared(s);
  s.connected = false;
  await e.request('admin', 'events/fair/sync', { changes: [patch()] });
  s.connected = true; s.denial = 401;
  await assert.rejects(e.syncAll('admin'), (err) => err.status === 401);
  s.connected = false;
  await assert.rejects(e.request('admin', 'bootstrap'), (err) => err.status === 401);
  assert.equal((await e.summary('admin')).pending, 1);
  s.connected = true; s.denial = 0;
  await e.request('admin', 'login', { password: 'fresh-login' });
  await e.request('admin', 'bootstrap');
  await e.syncAll('admin', true);
  assert.equal((await e.summary('admin')).pending, 0);
});
test('portal isolation: church cannot read bookstore cache or another church', async () => {
  const s = setup(), e = await prepared(s);
  s.connected = false;
  await assert.rejects(e.request('aa01', 'events/fair'), (err) => err.status === 401);
  await e.authenticated('aa01', { role: 'church', tenant: 'aa01' });
  await assert.rejects(e.request('aa01', 'events/fair'), /尚未下載/);
  await assert.rejects(e.authenticated('aa02', { role: 'church', tenant: 'aa01' }), (err) => err.status === 403);
});
test('offline logout disables cached login even when stale server cookie returns online', async () => {
  const s = setup(), e = await prepared(s);
  s.connected = false;
  await e.request('admin', 'events/fair/sync', { changes: [patch()] });
  await e.request('admin', 'logout', {});
  s.connected = true;
  await assert.rejects(e.request('admin', 'bootstrap'), (err) => err.status === 401);
  assert.equal((await e.summary('admin')).pending, 1);
  await e.request('admin', 'login', { password: 'not-stored' });
  await e.request('admin', 'bootstrap');
  await e.syncAll('admin');
  assert.equal((await e.summary('admin')).pending, 0);
  assert.doesNotMatch(JSON.stringify(await s.store.all()), /not-stored/);
});
test('failed device storage never acknowledges checkout', async () => {
  const s = setup(), e = await prepared(s);
  s.failWrite = true;
  await assert.rejects(e.request('admin', 'events/fair/sync', { changes: [patch()] }), /disk full/);
  assert.equal(s.calls, 0);
});
test('offline uses existing accounting validation and church payment restrictions', async () => {
  const s = setup(), e = await prepared(s);
  s.connected = false;
  await assert.rejects(e.request('admin', 'events/fair/sync', { changes: [patch('o1', null, { ...order(), amount: 1 })] }), /金額/);
  await e.authenticated('aa01', { role: 'church', tenant: 'aa01' });
  await e.cacheEvent('aa01', { ...s.server, tenant: 'aa01', organizer: 'church' });
  const credit = { ...order(), paymentMethod: '信用卡', paymentRecords: [{ method: '信用卡', amount: 100 }] };
  await assert.rejects(e.request('aa01', 'events/fair/sync', { changes: [patch('o1', null, credit)] }), /未開放信用卡/);
  await e.request('aa01', 'events/fair/sync', { changes: [patch()] });
  assert.equal((await e.summary('aa01')).pending, 1);
});
test('formal export cannot proceed while any checkout still needs synchronization', async () => {
  const s = setup(), e = await prepared(s);
  s.connected = false;
  await e.request('admin', 'events/fair/sync', { changes: [patch()] });
  await assert.rejects(e.requireSynced('admin'));
  s.connected = true;
  await e.requireSynced('admin');
  assert.equal((await e.summary('admin')).pendingEvents, 0);
});
test('conflicts require an explicit decision and reject a changed review snapshot', async () => {
  const s = setup(), e = await prepared(s);
  s.connected = false;
  await e.request('admin', 'events/fair/sync', { changes: [patch()] });
  s.server.state['order:o1'] = order('o1', 70);
  s.connected = true;
  await assert.rejects(e.syncAll('admin', true));
  const review = await e.conflicts('admin');
  assert.equal(review.length, 1);
  await assert.rejects(e.resolveConflicts('admin', review, {}), /逐項/);
  s.server.state['order:o1'] = order('o1', 60);
  await assert.rejects(e.resolveConflicts('admin', review, { 'fair:order:o1': 'device' }), /再次變更/);
  await e.resolveConflicts('admin', await e.conflicts('admin'), { 'fair:order:o1': 'device' });
  assert.equal(s.server.state['order:o1'].amount, 100);
  assert.equal((await e.summary('admin')).pending, 0);
});
test('keeping the cloud conflict version preserves original completed transaction', async () => {
  const s = setup(), e = await prepared(s);
  s.connected = false;
  await e.request('admin', 'events/fair/sync', { changes: [patch()] });
  s.server.state['order:o1'] = order('o1', 70);
  s.connected = true;
  await assert.rejects(e.syncAll('admin', true));
  await e.resolveConflicts('admin', await e.conflicts('admin'), { 'fair:order:o1': 'server' });
  assert.equal((await e.cached('admin', 'events/fair')).state['order:o1'].amount, 70);
  assert.equal((await e.summary('admin')).pending, 0);
});
