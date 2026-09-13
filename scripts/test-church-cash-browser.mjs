const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = 'http://localhost:3000',
  admin = fs.readFileSync('work/admin-cookie.txt', 'utf8');
const api = async (path, body, cookie = admin) => {
  const r = await fetch(origin + '/api/' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return {
    data: await r.json(),
    cookie: r.headers.get('set-cookie')?.split(';')[0],
  };
};
const password = crypto.randomUUID();
await api('churches', { code: 'aa02', password });
const cookie = (await api('login', { tenant: 'aa02', password }, '')).cookie;
const event = (
  await api(
    'events',
    { name: '教會現金與版面驗證', date: '2026-09-14', pricing: 'website' },
    cookie,
  )
).data;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [390, 820, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      hasTouch: width < 1000,
    });
    const n = cookie.indexOf('=');
    await context.addCookies([
      { name: cookie.slice(0, n), value: cookie.slice(n + 1), url: origin },
    ]);
    const page = await context.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(origin + '/register.html?event=' + event.id);
    await page
      .locator('#db-status')
      .filter({ hasText: '件商品' })
      .waitFor({ state: 'attached' });
    const cash = page.locator('#btn-f10'),
      line = page.locator('#btn-f8'),
      coin = page.locator('#btn-f9');
    const [a, b, c] = await Promise.all([
      cash.boundingBox(),
      line.boundingBox(),
      coin.boundingBox(),
    ]);
    assert.ok(a.y >= b.y + b.height);
    assert.ok(Math.abs(a.x - b.x) < 1);
    assert.ok(Math.abs(a.x + a.width - (c.x + c.width)) < 1);
    assert.ok(Math.abs(a.height - b.height) < 1);
    assert.equal(await page.locator('#btn-f7').isVisible(), false);
    await page.locator('#product-code').fill('C296');
    await page.locator('#product-code').press('Enter');
    if (width === 1280) {
      await page.evaluate(() => (document.body.dataset.view = 'checkout'));
      await page.keyboard.press('F10');
    } else await cash.click();
    await page.locator('body[data-checkout=saved]').waitFor();
    console.log('Church cash saves and spans two columns at width', width);
    await context.close();
  }
  const state = (await api('events/' + event.id, undefined, cookie)).data;
  const orders = Object.entries(state.state)
    .filter(([k]) => k.startsWith('order:'))
    .map(([, v]) => v);
  assert.equal(orders.length, 3);
  assert.ok(orders.every((o) => o.paymentRecords[0].method === '現金'));
  console.log('Cash payment records survive fresh API read');
} finally {
  await browser.close();
  await api('events/' + event.id + '/archive', {}, cookie);
}
