const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = 'http://localhost:3000';
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const context = await browser.newContext();
const cookie = fs.readFileSync('work/admin-cookie.txt', 'utf8').trim();
const sep = cookie.indexOf('=');
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
const initial = await api('catalog');
const old = initial.pricingRules.products.C296;
const event = await api('events', {
  name: '瀏覽器掃描與小數折扣驗證',
  date: '2026-09-13',
  pricing: 'website',
});
const errors = [];
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
try {
  await page.goto(origin);
  await page.getByRole('button', { name: '商品資料', exact: true }).click();
  await page
    .getByPlaceholder('搜尋 CSV 書名、官網名稱、代碼或條碼')
    .fill('C296');
  const row = page.locator('#price-row-products-C296');
  await row.getByRole('button', { name: '修改', exact: true }).click();
  await row.locator('input[type=number]').fill('79.5');
  await row.getByRole('button', { name: '確認價格', exact: true }).click();
  await page.getByText('設定已儲存，全教會同步', { exact: true }).waitFor();
  assert.match(await row.innerText(), /79.5 折/);
  assert.equal((await api('catalog')).pricingRules.products.C296.value, 79.5);
  console.log('Browser: click modify and save persists 79.5 discount');
  await page
    .getByPlaceholder('搜尋 CSV 書名、官網名稱、代碼或條碼')
    .fill('C175');
  await page
    .locator('#price-row-products-C175 .price-pill.group')
    .first()
    .click();
  const groupForm = page.locator('#group-editor');
  await groupForm.waitFor();
  await groupForm
    .getByRole('button', { name: '確認儲存', exact: true })
    .click();
  await page.getByText('活動已儲存', { exact: true }).waitFor();
  console.log('Browser: promotion capsule opens editor and submit saves');
  await page.goto(origin + '/register.html?event=' + event.id);
  await page.locator('#db-status').filter({ hasText: '件商品' }).waitFor();
  const scan = async (code) => {
    await page.locator('#product-code').fill(code);
    await page.locator('#product-code').press('Enter');
  };
  await scan('C175');
  assert.equal(await page.locator('.cart-item').count(), 1);
  await scan('C188');
  assert.equal(await page.locator('.cart-item').count(), 2);
  assert.match(await page.locator('.cart-item').last().innerText(), /免費/);
  assert.equal(await page.locator('#total-amount').innerText(), '250');
  await page
    .locator('.cart-item')
    .first()
    .getByRole('button', { name: '增加一件' })
    .click();
  assert.equal(
    await page
      .locator('.cart-item')
      .first()
      .locator('.quantity-value')
      .innerText(),
    '2',
  );
  await page
    .locator('.cart-item')
    .first()
    .getByRole('button', { name: '減少一件' })
    .click();
  await page.locator('#print-enabled').uncheck();
  await page.locator('#btn-f8').click();
  await page.waitForFunction(() => document.body.dataset.checkout === 'saved');
  let saved = await api('events/' + event.id);
  let orders = Object.entries(saved.state)
    .filter(([k]) => k.startsWith('order:'))
    .map(([, v]) => v);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].amount, 250);
  assert.deepEqual(
    orders[0].items.map((i) => i.discount),
    [100, 0],
  );
  console.log(
    'Browser: two scans render paid/free, quantity controls work, checkout saves exact lines and 250',
  );
  await scan('C296');
  assert.equal(await page.locator('#total-amount').innerText(), '715');
  await page
    .locator('.cart-item')
    .first()
    .getByRole('button', { name: '編輯', exact: true })
    .click();
  await page.locator('#edit-discount').fill('88.5');
  await page.getByRole('button', { name: '套用變更', exact: true }).click();
  assert.match(await page.locator('.cart-item').innerText(), /88.5 折/);
  assert.equal(await page.locator('#total-amount').innerText(), '796');
  await page.locator('#btn-f8').click();
  await page.waitForFunction(() => document.body.dataset.checkout === 'saved');
  saved = await api('events/' + event.id);
  orders = Object.entries(saved.state)
    .filter(([k]) => k.startsWith('order:'))
    .map(([, v]) => v);
  assert.ok(
    orders.some((o) => o.amount === 796 && o.items[0].discount === 88.5),
  );
  assert.deepEqual(errors, []);
  console.log(
    'Browser: manual decimal edit persists rounded shipment amount, no page errors',
  );
} finally {
  const cat = await api('catalog');
  await api('catalog/pricing', {
    scope: 'products',
    code: 'C296',
    revision: cat.pricingRevision,
    rule: old || { disabled: true },
  });
  await api('events/' + event.id + '/archive', {});
  await browser.close();
}
