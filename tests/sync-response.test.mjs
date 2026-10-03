import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { syncStateResponse } from '../lib/sync-response.mjs';
import { mergeChanges } from '../lib/state.mjs';
const bridge = fs.readFileSync('public/bridge.js', 'utf8');
test('Matching revisions send only changed keys; stale and old clients always receive complete state', () => {
  const state = Object.fromEntries(
    Array.from({ length: 2000 }, (_, i) => [
      'order:' + i,
      { id: String(i), amount: 100, items: [{ name: '歷史商品', price: 100 }] },
    ]),
  );
  const changes = [
    { key: 'draft:device:cart', before: '[]', after: '[1]' },
    { key: 'shared:removed', after: null },
  ];
  state['draft:device:cart'] = '[1]';
  const reply = syncStateResponse(state, changes, 8, 8);
  assert.deepEqual(reply, {
    patches: [
      { key: 'draft:device:cart', after: '[1]' },
      { key: 'shared:removed', after: null },
    ],
  });
  assert.ok(JSON.stringify(reply).length < JSON.stringify(state).length / 100);
  for (const known of [7, null, undefined, '8'])
    assert.equal(syncStateResponse(state, changes, 8, known).state, state);
});
async function make() {
  const local = new Map([['pos-device', 'device']]);
  const requests = [],
    timers = [],
    messages = [];
  const server = {
    state: { 'order:old': { id: 'old', amount: 100 } },
    revision: 8,
  };
  let clock = 100000,
    delay = null;
  const updates = [];
  const context = vm.createContext({
    URLSearchParams,
    crypto,
    structuredClone,
    Date: class extends Date {
      static now() {
        return clock;
      }
    },
    location: { search: '?event=fair', origin: 'http://local' },
    parent: {
      POSRegisterBootstrap: async () => ({
        event: {
          id: 'fair',
          organizer: 'bookstore',
          status: 'open',
          ...structuredClone(server),
        },
        catalog: {},
        me: { role: 'admin' },
      }),
      postMessage: (m) => messages.push(m),
    },
    document: { getElementById: () => null, addEventListener() {} },
    window: {
      localStorage: {
        getItem: (k) => local.get(k) ?? null,
        setItem: (k, v) => local.set(k, v),
        removeItem: (k) => local.delete(k),
      },
      addEventListener() {},
    },
    clearTimeout() {},
    setInterval() {},
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    fetch: async (url, options) => {
      requests.push(url);
      if (delay) await delay;
      const body = options?.body ? JSON.parse(options.body) : {};
      if (!url.endsWith('/sync'))
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      server.state = mergeChanges(server.state, body.changes);
      const result = {
        ...syncStateResponse(
          server.state,
          body.changes,
          server.revision,
          body.revision,
        ),
        revision: ++server.revision,
        numbers: {},
      };
      return { ok: true, status: 200, json: async () => result };
    },
  });
  vm.runInContext(bridge, context);
  const cloud = await context.window.makeCloud();
  cloud.onUpdate = (update) => updates.push(update);
  return {
    cloud,
    local,
    requests,
    timers,
    messages,
    server,
    updates,
    setClock: (value) => (clock = value),
    pause: (promise) => (delay = promise),
  };
}
test('Fast checkout combines draft and order in one request and keeps immediate recovery', async () => {
  const x = await make();
  x.cloud.storage.setItem('cart', '[{"code":"P6"}]');
  assert.equal(x.timers.at(-1).ms, 900);
  assert.ok(x.local.has('pos-recovery:fair:device'));
  x.cloud.storage.getItem('clients');
  x.cloud.storage.setItem(
    'clients',
    JSON.stringify({
      old: { id: 'old', amount: 100 },
      new: { id: 'new', amount: 20 },
    }),
  );
  x.cloud.storage.setItem('cart', '[]');
  await x.cloud.flush();
  assert.equal(x.requests.length, 1);
  assert.equal(x.server.state['order:new'].amount, 20);
  assert.equal(x.cloud.snapshot()['order:old'].amount, 100);
  assert.equal(x.local.has('pos-recovery:fair:device'), false);
  assert.ok(x.updates[0].keys.includes('order:new'));
});
test('A successful authenticated save prevents a redundant renewal before the next payment', async () => {
  const x = await make();
  x.setClock(170000);
  x.cloud.storage.setItem('cart', '[]');
  await x.cloud.flush();
  await x.cloud.ensureSession();
  assert.equal(x.requests.length, 1);
  x.setClock(240000);
  await x.cloud.ensureSession();
  assert.ok(x.requests.at(-1).endsWith('/session-renew'));
});
test('Stale revision includes other cashiers, and a delayed partial reply preserves scans entered while saving', async () => {
  const x = await make();
  x.server.state['order:remote'] = { id: 'remote', amount: 50 };
  x.server.revision++;
  x.cloud.storage.setItem('cart', '[1]');
  await x.cloud.flush();
  assert.equal(x.cloud.snapshot()['order:remote'].amount, 50);
  let release;
  const delayed = new Promise((resolve) => (release = resolve));
  x.pause(delayed);
  x.cloud.storage.setItem('cart', '[2]');
  const saving = x.cloud.flush();
  await Promise.resolve();
  await Promise.resolve();
  x.cloud.storage.setItem('cart', '[3]');
  release();
  await saving;
  assert.equal(x.cloud.storage.getItem('cart'), '[3]');
  assert.ok(x.local.has('pos-recovery:fair:device'));
  x.pause(null);
  await x.cloud.flush();
  assert.equal(x.server.state['draft:device:cart'], '[3]');
  assert.equal(x.cloud.snapshot()['order:remote'].amount, 50);
});
