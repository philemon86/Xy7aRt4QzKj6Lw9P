import { attachBridgeRuntime } from './bridge-runtime-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SESSION_TTL, shouldRenewSession, sessionCookie } from '../lib/session-policy.mjs';
import { canonicalRedirect, newsletterPaths, staticContentType } from '../lib/site-routing.mjs';
import { mergeChanges } from '../lib/state.mjs';

test('Canonical domain preserves church paths, query, and fragment without redirecting staging', () => {
  assert.equal(canonicalRedirect('http://philemon.com.tw/pos/aa01?event=one&view=checkout#cart'), 'https://www.philemon.com.tw/pos/aa01?event=one&view=checkout#cart');
  assert.equal(canonicalRedirect('http://www.philemon.com.tw/pos/'), 'https://www.philemon.com.tw/pos/');
  assert.equal(canonicalRedirect('https://www.philemon.com.tw/pos/'), null);
  assert.equal(canonicalRedirect('https://philemon-pos-v2-staging.ppss10103s.chatgpt.site/pos/'), null);
  assert.deepEqual(newsletterPaths('/2026-09/'), ['/2026-09/index.html']);
  assert.deepEqual(newsletterPaths('/first'), ['/first/index.html', '/first.html']);
  assert.deepEqual(newsletterPaths('/.git/config'), []);
  assert.equal(staticContentType('/newsletter-index.css'), 'text/css; charset=utf-8');
});

test('Active sessions renew, expired sessions never revive, portal cookies remain isolated and secure', () => {
  const now = 1790989200000;
  assert.equal(shouldRenewSession(now + SESSION_TTL, now), false);
  assert.equal(shouldRenewSession(now + SESSION_TTL - 3600001, now), true);
  assert.equal(shouldRenewSession(now, now), false);
  assert.equal(shouldRenewSession(now - 1, now), false);
  assert.equal(sessionCookie('aa01', 'test-token', true), 'pos_session_aa01=test-token; Path=/pos; HttpOnly; SameSite=Strict; Max-Age=28800; Secure');
  assert.match(sessionCookie('', 'test-token', false), /^pos_session_admin=/);
  assert.doesNotMatch(sessionCookie('aa01', 'test-token', true), /Domain=/);
});

const bridge = fs.readFileSync(new URL('../public/bridge.js', import.meta.url), 'utf8');
async function register(local, server, authorization) {
  const messages = [];
  const storage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) };
  const parent = { POSRegisterBootstrap: async () => ({ event: { id: 'fair', state: structuredClone(server.state), organizer: 'bookstore', status: 'open' }, catalog: {}, me: { role: 'admin', tenant: '' } }), postMessage: message => messages.push(message) };
  const context = vm.createContext({ window: { localStorage: storage, addEventListener() {} }, document: { getElementById: () => null, addEventListener() {} }, parent, location: { search: '?event=fair&portal=admin', origin: 'https://www.philemon.com.tw' }, URLSearchParams, crypto, structuredClone, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, fetch: async (url, options) => {
    if (!authorization.valid) return { ok: false, status: 401, json: async () => ({ error: '登入已到期' }) };
    if (url.endsWith('/sync')) server.state = mergeChanges(server.state, JSON.parse(options.body).changes);
    return { ok: true, status: 200, json: async () => ({ state: structuredClone(server.state), numbers: {}, ok: true }) };
  } });
  attachBridgeRuntime(context);
  vm.runInContext(bridge, context);
  return { cloud: await context.window.makeCloud(), messages };
}

test('Draft is saved immediately, survives 401 plus reload, and restores without duplicating orders', async () => {
  const local = new Map([['pos-device', 'device-one']]);
  const server = { state: { 'order:existing': { id: 'existing', amount: 20 } } };
  const authorization = { valid: true };
  const first = await register(local, server, authorization);
  const cart = JSON.stringify([{ code: 'C001', quantity: 2, price: 100, discount: 90 }]);
  const fields = JSON.stringify({ 'invoice-tax-id': '23101590', 'invoice-donate-carrier': '', 'paid-amount': '1000' });
  first.cloud.storage.setItem('cart', cart);
  first.cloud.storage.setItem('checkoutFields', fields);
  assert.ok(local.has('pos-recovery:fair:device-one'), 'Persist before debounce or network attempt');
  authorization.valid = false;
  first.cloud.sessionCheckedAt = 0;
  await assert.rejects(first.cloud.ensureSession(), /登入已到期/);
  await assert.rejects(first.cloud.flush(), /登入已到期/);
  assert.ok(first.messages.some(message => message.type === 'session-expired'));
  authorization.valid = true;
  const resumed = await register(local, server, authorization);
  assert.equal(resumed.cloud.storage.getItem('cart'), cart);
  assert.equal(resumed.cloud.storage.getItem('checkoutFields'), fields);
  assert.equal(Object.keys(server.state).filter(key => key.startsWith('order:')).length, 1);
  assert.equal(local.has('pos-recovery:fair:device-one'), false);
  assert.ok(Object.hasOwn(server.state, 'draft:device-one:checkoutFields'));
});
