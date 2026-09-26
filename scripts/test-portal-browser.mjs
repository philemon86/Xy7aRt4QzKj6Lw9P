const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = 'http://localhost:3000',
  admin = fs.readFileSync('work/admin-cookie.txt', 'utf8').trim();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext();
const split = admin.indexOf('=');
await ctx.addCookies([
  { name: admin.slice(0, split), value: admin.slice(split + 1), url: origin },
]);
const call = async (path, portal, body) =>
  ctx.request.fetch(origin + '/api/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Origin: origin, 'X-POS-Portal': portal },
    ...(body ? { data: body } : {}),
  });
const api = async (path, portal, body) => {
  const r = await call(path, portal, body);
  assert.equal(r.status(), 200, await r.text());
  return r.json();
};
const passwords = {};
const tag = crypto.randomUUID(),
  pages = {},
  events = {};
const failures = [];
try {
  const main = await ctx.newPage();
  pages.admin = main;
  await main.goto(origin);
  await main
    .getByRole('button', { name: '書房書展列表', exact: true })
    .waitFor();
  for (const code of ['aa01', 'aa02']) {
    const password = crypto.randomUUID();
    passwords[code] = password;
    await api('churches', 'admin', { code, password });
    const page = await ctx.newPage();
    pages[code] = page;
    page.on('pageerror', (e) => failures.push(e.message));
    await page.goto(origin + '/' + code);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: '登入工作台' }).click();
    await page
      .getByRole('button', { name: '我的書展列表', exact: true })
      .waitFor();
    events[code] = await api('events', code, {
      name: code + tag,
      date: '2026-09-20',
      pricing: 'website',
    });
  }
  events.admin = await api('events', 'admin', {
    name: 'admin' + tag,
    date: '2026-09-20',
    pricing: 'website',
  });
  for (const code of ['admin', 'aa01', 'aa02']) {
    const me = await api('me', code);
    assert.equal(me.role, code === 'admin' ? 'admin' : 'church');
    if (code !== 'admin') assert.equal(me.tenant, code);
  }
  await main.reload();
  await main
    .getByRole('button', { name: '書房書展列表', exact: true })
    .waitFor();
  await main.getByRole('button', { name: '教會自辦書展', exact: true }).click();
  await main
    .locator('.event-row')
    .filter({ hasText: 'aa01' + tag })
    .waitFor();
  await main
    .locator('.event-row')
    .filter({ hasText: 'aa02' + tag })
    .waitFor();
  await main.getByRole('button', { name: '書房書展列表', exact: true }).click();
  console.log(
    'Same browser keeps bookstore and two church logins independent; main lists both churches',
  );
  for (const code of ['admin', 'aa01']) {
    const page = pages[code];
    await page.reload();
    await page
      .locator('.event-row')
      .filter({ hasText: code + tag })
      .click();
    await page
      .locator('[data-slot=sidebar][data-state=collapsed]')
      .waitFor({ state: 'attached' });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-slot=sidebar-gap]')
          ?.getBoundingClientRect().width === 0,
    );
    const trigger = page.getByRole('button', { name: '展開或收合選單' });
    await trigger.click();
    await page
      .locator('[data-slot=sidebar][data-state=expanded]')
      .waitFor({ state: 'attached' });
    await page.getByRole('tab', { name: '交易與營收', exact: true }).click();
    await page.getByRole('tab', { name: '結帳', exact: true }).click();
    await page
      .locator('[data-slot=sidebar][data-state=collapsed]')
      .waitFor({ state: 'attached' });
    const frame = page.frameLocator('iframe');
    await frame.locator('#product-code').fill('C296');
    await frame.locator('#product-code').press('Enter');
    await frame.locator('#btn-f10').click();
    await frame.locator('body[data-checkout=saved]').waitFor();
    const saved = await api('events/' + events[code].id, code);
    assert.equal(
      Object.keys(saved.state).filter((k) => k.startsWith('order:')).length,
      1,
    );
  }
  console.log(
    'Bookstore and church checkout remain scoped with all cookies present; sidebar collapses and reopens',
  );
  assert.equal((await call('events/' + events.aa02.id, 'aa01')).status(), 404);
  assert.equal((await call('shipments', 'aa01')).status(), 403);
  const churchOnly = await browser.newContext();
  await churchOnly.addCookies(
    (await ctx.cookies()).filter((c) => c.name === 'pos_session_aa02'),
  );
  const isolated = await churchOnly.newPage();
  await isolated.goto(origin);
  await isolated.locator('#password').waitFor();
  assert.equal(
    (
      await churchOnly.request.get(origin + '/api/bootstrap', {
        headers: { 'X-POS-Portal': 'admin' },
      })
    ).status(),
    401,
  );
  await churchOnly.close();
  console.log('Church-only browser cannot enter main or access another church');
  for (const code of ['admin', 'aa01', 'aa02'])
    await api('events/' + events[code].id + '/archive', code, {});
  const oldChurchCookie = (await ctx.cookies()).find(
    (c) => c.name === 'pos_session_aa01',
  );
  await ctx.addCookies([
    { name: 'pos_session', value: oldChurchCookie.value, url: origin },
  ]);
  await api('login', 'aa01', { tenant: 'aa01', password: passwords.aa01 });
  await api('logout', 'aa01', {});
  assert.equal((await call('me', 'aa01')).status(), 401);
  assert.equal((await api('me', 'admin')).role, 'admin');
  assert.equal((await api('me', 'aa02')).tenant, 'aa02');
  await api('logout', 'admin', {});
  assert.equal((await call('me', 'admin')).status(), 401);
  assert.equal((await api('me', 'aa02')).tenant, 'aa02');
  assert.deepEqual(failures, []);
  console.log('Logout only revokes the selected portal');
} finally {
  await browser.close();
}
