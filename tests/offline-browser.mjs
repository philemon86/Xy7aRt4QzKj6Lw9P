// Isolated fixture: no production endpoints, accounts, or real transactions.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { REGISTER_FILE } from '../lib/release.mjs';
import { mergeChanges } from '../lib/state.mjs';
const { chromium } = await import(process.env.POS_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('dist/client');
const catalog = { products: [{ code: 'C001', name: '離線測試商品', price: 100, legacyPrice: 100, defaultDiscount: 100, ntaxFlag: '1', unitCode: '1' }], customers: [{ code: '0002', name: '書展' }, { code: '305', name: '個人' }, { code: 'AA01', name: '台北教會' }], units: { 1: '本' }, classes: {}, kinds: {}, pricingRules: { groups: [] } };
const events = new Map(['admin', 'aa01'].map((portal) => [portal, { id: 'fair-' + portal, name: '離線測試書展', date: '2026-10-09', tenant: portal === 'admin' ? '' : portal, organizer: portal === 'admin' ? 'bookstore' : 'church', status: 'open', state: {}, revision: 0, numbers: {} }]));
const html = (portal) => `<!doctype html><html><head><meta charset="utf-8"><title>Offline fixture</title></head><body style="margin:0"><script src="/pos/offline-runtime.js"></script><script>
window.runtime=POSOfflineModule.getOfflineRuntime();window.portal=${JSON.stringify(portal)};
localStorage.setItem('pos-device','fixture-device');
window.POSRegisterBootstrap=async()=>({event:await runtime.request(portal,'events/fair-'+portal),catalog:await runtime.request(portal,'catalog'),me:await runtime.request(portal,'me')});
window.boot=runtime.request(portal,'bootstrap').then(()=>{const frame=document.createElement('iframe');frame.id='register';frame.dataset.eventId='fair-'+portal;frame.dataset.portal=portal;frame.src='/pos${REGISTER_FILE}';frame.style='width:100%;height:1400px;border:0';document.body.append(frame);});
window.addEventListener('message',e=>{if(e.data.type==='height')document.querySelector('iframe').style.height=e.data.height+'px';});
</script></body></html>`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/pos/' || url.pathname === '/pos/aa01') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html(url.pathname === '/pos/' ? 'admin' : 'aa01')); return;
    }
    if (url.pathname === '/newsletter') { res.end('newsletter'); return; }
    if (url.pathname.startsWith('/pos/api/')) {
      res.setHeader('Content-Type', 'application/json');
      const portal = req.headers['x-pos-portal'], event = events.get(portal);
      const endpoint = url.pathname.slice('/pos/api/'.length);
      const me = { role: portal === 'admin' ? 'admin' : 'church', tenant: portal === 'admin' ? '' : portal };
      if (endpoint === 'bootstrap') res.end(JSON.stringify({ me, catalog, events: [{ ...event, state: undefined }] }));
      else if (endpoint === 'catalog') res.end(JSON.stringify(catalog));
      else if (endpoint === 'me') res.end(JSON.stringify(me));
      else if (endpoint.startsWith('church-stock/')) res.end(JSON.stringify({ quantities: { C001: 10 }, sold: {}, remaining: { C001: 10 } }));
      else if (endpoint.endsWith('/sync')) {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Real slow connection, not just offline flag.
        event.state = mergeChanges(event.state, body.changes); event.revision++;
        for (const p of body.changes) if (p.key.startsWith('order:') && p.after) event.numbers[p.after.id] ||= (portal === 'admin' ? 'PF' : 'AA01') + String(Object.keys(event.numbers).length + 1).padStart(4, '0');
        res.end(JSON.stringify(event));
      } else if (endpoint.startsWith('events/')) res.end(JSON.stringify(event));
      else res.end('{"ok":true}');
      return;
    }
    const relative = url.pathname.startsWith('/pos/_next/') ? url.pathname.slice(1) : decodeURIComponent(url.pathname.replace(/^\/pos\//, ''));
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) throw Error('invalid path');
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    res.setHeader('Content-Type', type); res.end(await fs.readFile(file));
  } catch (error) { res.statusCode = 404; res.end(String(error.message)); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const portal of ['admin', 'aa01']) {
    const context = await browser.newContext({ viewport: { width: portal === 'admin' ? 1440 : 390, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(origin + (portal === 'admin' ? '/pos/' : '/pos/aa01'));
    const frame = page.frameLocator('#register');
    await frame.locator('#product-code').waitFor();
    await page.evaluate(() => runtime.prepare(portal));
    await context.setOffline(true);
    const perform = async () => {
      await frame.locator('#product-code').fill('C001');
      await frame.locator('#product-code').press('Enter');
      await frame.locator('.cart-item').waitFor();
      const start = Date.now();
      await frame.locator('#btn-f10').click();
      await frame.locator('body[data-checkout="saved"]').waitFor();
      assert.ok(Date.now() - start < 1200, 'Checkout must not wait on the slow network');
    };
    await perform();
    assert.equal((await page.evaluate(() => runtime.summary(portal))).pending, 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await frame.locator('#product-code').waitFor();
    assert.equal((await page.evaluate(() => runtime.summary(portal))).pending, 1, 'IndexedDB survives an offline page reload');
    await perform();
    assert.equal((await page.evaluate(() => runtime.summary(portal))).pending, 2);
    // The decoder/worker/WASM must work without having opened the camera online.
    assert.equal(await page.evaluate(async () => (await fetch('/pos/barcode-decoder-v2.js?v=2')).ok), true);
    assert.equal(await page.evaluate(async () => (await fetch('/pos/barcode-reader-v3.wasm')).ok), true);
    assert.equal(await page.evaluate(async () => (await fetch('/pos/barcode-worker-v3.js')).ok), true);
    await assert.rejects(page.evaluate(async () => fetch('/pos/api/not-cached')), 'Service worker never caches APIs');
    await assert.rejects(page.evaluate(async () => fetch('/newsletter')), 'Service worker never intercepts the original website');
    await context.setOffline(false);
    await page.evaluate(() => runtime.syncAll(portal));
    const record = events.get(portal);
    assert.equal(Object.keys(record.state).filter((k) => k.startsWith('order:')).length, 2);
    assert.equal(Object.keys(record.numbers).length, 2);
    assert.equal((await page.evaluate(() => runtime.summary(portal))).pendingEvents, 0);
    await perform(); // Healthy network is intentionally slow: the register still acknowledges locally.
    await page.evaluate(() => runtime.syncAll(portal));
    assert.equal(Object.keys(record.numbers).length, 3);
    assert.deepEqual(errors, [], 'Register has no unhandled browser errors');
    console.log(`PASS ${portal}: offline checkout, reload, cached decoder, reconnect, slow online checkout`);
    await context.close();
  }
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
