const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = 'http://localhost:3000';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext();
const cookie = fs.readFileSync('work/admin-cookie.txt', 'utf8').trim(),
  sep = cookie.indexOf('=');
await context.addCookies([
  { name: cookie.slice(0, sep), value: cookie.slice(sep + 1), url: origin },
]);
const api = async (path, body) => {
  const r = await context.request.fetch(origin + '/api/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Origin: origin },
    ...(body ? { data: body } : {}),
  });
  assert.equal(r.status(), 200, await r.text());
  return r.json();
};
const old = await api('church-stock/aa01');
const eventName = '庫存與快速結帳瀏覽器驗證 ' + crypto.randomUUID();
const event = await api('events', {
  name: eventName,
  date: '2026-09-13',
  pricing: 'website',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) =>
  d.accept(d.type() === 'prompt' ? d.defaultValue() : undefined),
);
try {
  await page.goto(origin);
  await page.getByRole('button', { name: '教會入口', exact: true }).click();
  await page.locator('#church-code').fill('AA01');
  await page.getByRole('button', { name: '為下方教會先建立庫存' }).click();
  const panel = page.locator('.church-stock-panel');
  assert.equal(await panel.locator('select').count(), 0);
  assert.equal(await panel.locator('input[type=file]').count(), 0);
  await panel.locator('textarea').fill('c001,10\nc002;8');
  await panel.getByRole('button', { name: '匯入庫存' }).click();
  await panel.getByText('教會庫存已儲存', { exact: true }).waitFor();
  let stock = await api('church-stock/aa01');
  assert.equal(stock.rows.find((r) => r.code === 'C001').available, 10);
  assert.equal(stock.rows.find((r) => r.code === 'C002').available, 8);
  await panel
    .getByRole('button', { name: '修改 C001 庫存 10', exact: true })
    .dblclick();
  await panel.getByRole('spinbutton', { name: 'C001 庫存數量' }).fill('8');
  await panel.getByRole('button', { name: '儲存', exact: true }).click();
  await panel.getByText('C001 庫存已更新', { exact: true }).waitFor();
  stock = await api('church-stock/aa01');
  assert.equal(stock.rows.find((r) => r.code === 'C001').available, 8);
  console.log(
    'Text import and double-click quantity edits persist with catalog names',
  );
  await page.reload();
  await page.getByRole('button', { name: '書房書展列表', exact: true }).click();
  await page.locator('.event-row').filter({ hasText: eventName }).click();
  await page.getByRole('tab', { name: '結帳', exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('tab', { name: '結帳', exact: true })
      .getAttribute('aria-selected'),
    'true',
  );
  const frame = page.frameLocator('iframe[title="書展收銀台"]');
  await frame.locator('#product-code').waitFor();
  console.log('Opening a bookstore fair defaults to checkout');
  const timings = [];
  for (const id of ['btn-f7', 'btn-f8', 'btn-f9', 'btn-f10']) {
    await frame.locator('#product-code').fill('C296');
    await frame.locator('#product-code').press('Enter');
    const began = Date.now();
    await frame.locator('#' + id).click();
    await frame.locator('body[data-checkout=saved]').waitFor();
    timings.push({ payment: id, ms: Date.now() - began });
  }
  const saved = await api('events/' + event.id);
  const orders = Object.entries(saved.state)
    .filter(([k]) => k.startsWith('order:'))
    .map(([, v]) => v);
  assert.equal(orders.length, 4);
  assert.equal(new Set(Object.values(saved.numbers)).size, 4);
  assert.deepEqual(errors, []);
  console.log(
    'All four payment buttons save exactly once with separate numbers:',
    JSON.stringify(timings),
  );
} finally {
  const current = await api('church-stock/aa01');
  const text = ['C001', 'C002']
    .map(
      (code) =>
        code + ',' + (old.rows.find((r) => r.code === code)?.available || 0),
    )
    .join('\n');
  await api('church-stock/aa01', {
    mode: 'set',
    text,
    revision: current.revision,
  });
  await api('events/' + event.id + '/archive', {});
  await browser.close();
}
