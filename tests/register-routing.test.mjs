import { attachBridgeRuntime } from './bridge-runtime-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadRegisterBootstrap } from '../lib/register-bootstrap.mjs';

async function createBridge({ search = '', frameEvent, portal, role }) {
  let bootstrapId;
  const calls = [];
  const record = {
    id: frameEvent || 'url-event',
    state: {},
    numbers: {},
    organizer: role === 'church' ? 'church' : 'bookstore',
  };
  const catalog = { products: [] };
  const me = { role, tenant: role === 'church' ? portal : '' };
  const context = {
    URLSearchParams,
    crypto,
    structuredClone,
    location: { search, origin: 'http://localhost' },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => record };
    },
    setInterval() {},
    setTimeout() {},
    clearTimeout() {},
    parent: {
      POSRegisterBootstrap: async (id) => {
        bootstrapId = id;
        return loadRegisterBootstrap(
          id,
          { id: record.id, record: Promise.resolve(record) },
          { catalog, me },
          () => {
            throw Error('Duplicate bootstrap request');
          },
        );
      },
      postMessage() {},
    },
    document: {
      getElementById() {
        return null;
      },
      addEventListener() {},
    },
    window: {
      frameElement: frameEvent
        ? {
            getAttribute: (name) =>
              ({ 'data-event-id': frameEvent, 'data-portal': portal })[name] ??
              null,
          }
        : null,
      localStorage: {
        getItem: (key) => (key === 'pos-device' ? 'device' : null),
      },
      addEventListener() {},
    },
  };
  vm.createContext(context);
  attachBridgeRuntime(context);
  vm.runInContext(fs.readFileSync('public/bridge.js', 'utf8'), context);
  const cloud = await context.window.makeCloud();
  return { cloud, bootstrapId, calls };
}

test('Production redirect dropping every URL parameter preserves fair and portal for bookroom and church', async () => {
  for (const [portal, role] of [
    ['admin', 'admin'],
    ['aa01', 'church'],
  ]) {
    const { cloud, bootstrapId, calls } = await createBridge({
      frameEvent: 'created-' + portal,
      portal,
      role,
    });
    assert.equal(bootstrapId, 'created-' + portal);
    assert.equal(cloud.event.id, bootstrapId);
    assert.equal(cloud.me.role, role);
    assert.equal(calls.length, 0, 'No duplicate initialization reads');
    await cloud.refresh();
    assert.equal(calls[0].url, '/pos/api/events/' + bootstrapId);
    assert.equal(calls[0].options.headers['X-POS-Portal'], portal);
  }
});

test('Host frame identity takes precedence over stale redirected query parameters', async () => {
  const { cloud, bootstrapId } = await createBridge({
    search: '?event=old&portal=admin',
    frameEvent: 'new',
    portal: 'aa01',
    role: 'church',
  });
  assert.equal(bootstrapId, 'new');
  assert.equal(cloud.event.id, 'new');
});

test('Direct register URL still supports query parameters without a host frame', async () => {
  const { bootstrapId } = await createBridge({
    search: '?event=url-event&portal=admin',
    role: 'admin',
  });
  assert.equal(bootstrapId, 'url-event');
});
