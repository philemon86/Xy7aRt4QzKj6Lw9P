import { env } from 'cloudflare:workers';
import catalog from '../data/catalog.json';
import initialShop from '../data/shop-cache.json';
import { mergeChanges, validateOrder, stats } from './state.mjs';
import { parseShop } from './shop.mjs';
import { formatOrderNumber, orderDay, validateRoleChange } from './orders.mjs';
import { previewPilot, confirmPilot } from './pilot-service';
type Session = { role: string; tenant: string; token: string };
const db = () => env.DB;
const enc = new TextEncoder();
export const error = (message: string, status = 400) =>
  Object.assign(new Error(message), { status });
const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join(
    '',
  );
const sha = async (s: string) =>
  hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
export async function passwordHash(p: string, salt = crypto.randomUUID()) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(p),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return (
    salt +
    ':' +
    hex(
      await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          hash: 'SHA-256',
          salt: enc.encode(salt),
          iterations: 100000,
        },
        key,
        256,
      ),
    )
  );
}
export async function session(req: Request): Promise<Session> {
  const token = req.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)pos_session=([^;]+)/)?.[1];
  if (!token) throw error('請先登入', 401);
  const s = await db()
    .prepare('SELECT * FROM sessions WHERE token=? AND expires>?')
    .bind(await sha(token), Date.now())
    .first<Session>();
  if (!s) throw error('登入已到期，請重新登入', 401);
  return s;
}
export function guard(req: Request) {
  if (
    req.method !== 'GET' &&
    req.headers.get('origin') !== new URL(req.url).origin
  )
    throw error('來源驗證失敗', 403);
}
export function json(
  x: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(x, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}
const isAdmin = (s: Session) => {
  if (s.role !== 'admin') throw error('僅書房可以操作', 403);
};
let organizerMigration: Promise<any> | undefined;
async function ensureOrganizers() {
  // The first audit snapshot retains the actor that created an existing fair.
  organizerMigration ??= db()
    .prepare(
      "UPDATE events SET organizer=CASE WHEN COALESCE((SELECT actor FROM audit WHERE audit.event=events.id ORDER BY revision LIMIT 1),actor)='admin' THEN 'bookstore' ELSE 'church' END WHERE organizer=''",
    )
    .run()
    .catch((e: any) => {
      organizerMigration = undefined;
      throw e;
    });
  await organizerMigration;
}
async function event(id: string, s: Session) {
  await ensureOrganizers();
  const e: any = await db()
    .prepare('SELECT * FROM events WHERE id=?')
    .bind(id)
    .first();
  if (!e || (s.role !== 'admin' && e.tenant !== s.tenant))
    throw error('找不到書展', 404);
  return e;
}
function userInfo(s: Session) {
  return {
    role: s.role,
    tenant: s.tenant,
    name:
      s.role === 'admin'
        ? '腓利門書房'
        : catalog.customers.find((c) => c.code.toLowerCase() === s.tenant)
            ?.name,
  };
}
async function listEvents(s: Session) {
  await ensureOrganizers();
  const rows = await (
    s.role === 'admin'
      ? db().prepare('SELECT * FROM events ORDER BY date DESC,updated DESC')
      : db()
          .prepare(
            'SELECT * FROM events WHERE tenant=? ORDER BY date DESC,updated DESC',
          )
          .bind(s.tenant)
  ).all<any>();
  return rows.results.map(({ state, ...meta }) => ({
    ...meta,
    ...stats(JSON.parse(state)),
  }));
}
async function numbersFor(e: any, state: Record<string, any>) {
  const existing = await db()
    .prepare('SELECT order_id,day,sequence FROM shipment_numbers WHERE event=?')
    .bind(e.id)
    .all<any>();
  const known = new Set(existing.results.map((r) => r.order_id));
  const missing = Object.entries(state)
    .filter(([k, v]) => k.startsWith('order:') && v && !known.has(v.id))
    .map(([, v]) => v)
    .sort((a, b) =>
      String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id)),
    );
  return {
    ...Object.fromEntries(
      existing.results.map((r) => [
        r.order_id,
        formatOrderNumber(e.tenant, r.day, r.sequence, e.organizer),
      ]),
    ),
    ...(await assignNumbers(e, missing)),
  };
}
async function assignNumbers(e: any, orders: any[]) {
  const result: Record<string, string> = {};
  for (let offset = 0; offset < orders.length; offset += 80) {
    const rows = await db().batch(
      orders.slice(offset, offset + 80).map((order) => {
        const day = orderDay(order),
          scope = e.organizer === 'bookstore' ? 'PF' : 'church:' + e.tenant;
        return db()
          .prepare(
            'INSERT INTO shipment_numbers(event,order_id,scope,day,sequence) SELECT ?,?,?,?,COALESCE(MAX(sequence),0)+1 FROM shipment_numbers WHERE scope=? AND day=? ON CONFLICT(event,order_id) DO UPDATE SET order_id=excluded.order_id RETURNING order_id,day,sequence',
          )
          .bind(e.id, order.id, scope, day, scope, day);
      }),
    );
    for (const batch of rows)
      for (const row of batch.results as any[])
        result[row.order_id] = formatOrderNumber(
          e.tenant,
          row.day,
          row.sequence,
          e.organizer,
        );
  }
  return result;
}
async function getCatalog(s: Session) {
  const rows = await db().prepare('SELECT code,data FROM shop').all<any>();
  const web = {
    ...initialShop,
    ...Object.fromEntries(
      rows.results.map((r) => [r.code, JSON.parse(r.data)]),
    ),
  };
  return {
    ...catalog,
    customers:
      s.role === 'admin'
        ? catalog.customers
        : catalog.customers.filter((c) =>
            [s.tenant.toUpperCase(), '0002', '305'].includes(c.code),
          ),
    products: catalog.products.map((p) => ({ ...p, ...(web as any)[p.code] })),
  };
}
async function limited(key: string) {
  const bucket = Math.floor(Date.now() / 600000);
  const r: any = await db()
    .prepare(
      'INSERT INTO limits(key,n,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET n=n+1 RETURNING n',
    )
    .bind(key + ':' + bucket, Date.now() + 600000)
    .first();
  if (r.n > 12) throw error('登入嘗試過多，請稍後再試', 429);
}
export async function handle(req: Request, parts: string[]) {
  guard(req);
  const [route, id, action] = parts;
  const b = req.method === 'GET' ? {} : ((await req.json()) as any);
  if (route === 'login') {
    const tenant = String(b.tenant || '').toLowerCase();
    if (tenant && !/^[a-z0-9_-]{1,24}$/.test(tenant))
      throw error('入口代碼錯誤');
    await limited(
      'login:' +
        (await sha(
          (req.headers.get('cf-connecting-ip') || 'local') + ':' + tenant,
        )),
    );
    const c: any = tenant
      ? await db()
          .prepare('SELECT * FROM churches WHERE code=? AND enabled=1')
          .bind(tenant)
          .first()
      : null;
    const expected = tenant
      ? c?.password
      : (env as any).ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD_HASH;
    if (!expected)
      throw error(tenant ? '此教會入口尚未啟用' : '書房登入尚未設定', 401);
    const actual = await passwordHash(
      String(b.password || '').slice(0, 256),
      expected.split(':')[0],
    );
    let diff = actual.length ^ expected.length;
    for (let i = 0; i < Math.max(actual.length, expected.length); i++)
      diff |= (actual.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
    if (diff) throw error('密碼不正確', 401);
    const token = crypto.randomUUID() + crypto.randomUUID();
    await db()
      .prepare(
        'INSERT INTO sessions(token,role,tenant,expires) VALUES(?,?,?,?)',
      )
      .bind(
        await sha(token),
        tenant ? 'church' : 'admin',
        tenant,
        Date.now() + 8 * 3600000,
      )
      .run();
    return json({ ok: true }, 200, {
      'Set-Cookie': `pos_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`,
    });
  }
  const s = await session(req);
  if (route === 'bootstrap') {
    const [events, catalog] = await Promise.all([listEvents(s), getCatalog(s)]);
    return json({ me: userInfo(s), events, catalog });
  }
  if (route === 'shipments') {
    isAdmin(s);
    await ensureOrganizers();
    const tenant = new URL(req.url).searchParams.get('tenant');
    const rows = await (
      tenant && tenant !== 'all'
        ? db()
            .prepare('SELECT * FROM events WHERE tenant=? ORDER BY date DESC')
            .bind(tenant === 'mon' ? '' : tenant.toLowerCase())
        : db().prepare('SELECT * FROM events ORDER BY date DESC')
    ).all<any>();
    const shipments = [];
    for (const e of rows.results) {
      const state = JSON.parse(e.state),
        numbers = await numbersFor(e, state);
      for (const [key, o] of Object.entries(state) as any)
        if (key.startsWith('order:'))
          shipments.push({
            id: o.id,
            event: e.id,
            eventName: e.name,
            tenant: e.tenant,
            number: numbers[o.id],
            createdAt: o.createdAt,
            day: orderDay(o),
            amount: o.amount,
            paymentMethod: o.paymentMethod,
            isValid: o.isValid,
            summary: o.items
              .map((i: any) => i.name)
              .slice(0, 3)
              .join('、'),
            quantity: o.items.reduce((n: number, i: any) => n + i.quantity, 0),
          });
    }
    return json(
      shipments.sort(
        (a, b) =>
          String(b.createdAt || b.day).localeCompare(
            String(a.createdAt || a.day),
          ) || b.number.localeCompare(a.number),
      ),
    );
  }
  if (route === 'me')
    return json({
      role: s.role,
      tenant: s.tenant,
      name:
        s.role === 'admin'
          ? '腓利門書房'
          : catalog.customers.find((c) => c.code.toLowerCase() === s.tenant)
              ?.name,
    });
  if (route === 'logout') {
    await db()
      .prepare('DELETE FROM sessions WHERE token=?')
      .bind(s.token)
      .run();
    return json({ ok: true }, 200, {
      'Set-Cookie':
        'pos_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    });
  }
  if (route === 'catalog') return json(await getCatalog(s));
  if (route === 'churches') {
    isAdmin(s);
    if (req.method === 'GET') {
      const all = await db().prepare('SELECT code,enabled FROM churches').all();
      return json(all.results);
    }
    const code = String(b.code || '').toLowerCase();
    if (
      !catalog.customers.some((c) => c.code.toLowerCase() === code) ||
      ['0002', '305'].includes(code)
    )
      throw error('找不到有效的教會客戶代碼');
    if (String(b.password).length < 10) throw error('密碼至少 10 個字元');
    await db().batch([
      db()
        .prepare(
          'INSERT INTO churches(code,password,enabled) VALUES(?,?,1) ON CONFLICT(code) DO UPDATE SET password=excluded.password,enabled=1',
        )
        .bind(code, await passwordHash(b.password)),
      db().prepare('DELETE FROM sessions WHERE tenant=?').bind(code),
    ]);
    return json({ ok: true });
  }
  if (route === 'events' && !id) {
    if (req.method === 'GET') {
      return json(await listEvents(s));
    }
    const tenant =
      s.role === 'admin' ? String(b.tenant || '').toLowerCase() : s.tenant;
    if (
      tenant &&
      !catalog.customers.some((c) => c.code.toLowerCase() === tenant)
    )
      throw error('教會代碼錯誤');
    if (
      !b.name?.trim() ||
      b.name.length > 100 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
      !['website', 'legacy'].includes(b.pricing)
    )
      throw error('請填寫有效的書展名稱與日期');
    const eid = crypto.randomUUID();
    await db()
      .prepare(
        'INSERT INTO events(id,name,tenant,date,pricing,updated,actor,organizer) VALUES(?,?,?,?,?,?,?,?)',
      )
      .bind(
        eid,
        b.name.trim(),
        tenant,
        b.date,
        b.pricing,
        new Date().toISOString(),
        s.tenant || 'admin',
        s.role === 'admin' ? 'bookstore' : 'church',
      )
      .run();
    return json({ id: eid });
  }
  if (route === 'events' && id) {
    const e = await event(id, s);
    if (action === 'pilot-preview' || action === 'pilot-confirm') {
      isAdmin(s);
      if (req.method !== 'POST') throw error('請使用 POST', 405);
      if (action === 'pilot-confirm')
        return json(await confirmPilot(e, String(b.id || '')));
      const [catalog, numbers] = await Promise.all([
        getCatalog(s),
        numbersFor(e, JSON.parse(e.state)),
      ]);
      return json(await previewPilot(e, catalog, b, numbers));
    }
    if (req.method === 'GET' && !action) {
      const state = JSON.parse(e.state);
      return json({
        ...e,
        state,
        numbers: await numbersFor(e, state),
        permissions: {
          manageStock: s.role === 'admin',
          export: s.role === 'admin',
          role: s.role,
        },
      });
    }
    if (action === 'sync') {
      if (e.status !== 'open')
        throw error('此書展已封存，請由書房重新開啟', 409);
      if (!Array.isArray(b.changes) || b.changes.length > 1000)
        throw error('更新格式錯誤');
      const originalState = JSON.parse(e.state);
      for (const p of b.changes) {
        if (!/^(order:|draft:|stock:|shared:)/.test(p.key))
          throw error('無效欄位');
        validateRoleChange(s.role, s.tenant, p, originalState[p.key]);
        if (p.key.startsWith('order:') && p.after != null) {
          validateOrder(p.after);
          if (p.key !== 'order:' + p.after.id) throw error('訂單編號不符');
          if (
            s.role !== 'admin' &&
            p.after.bookFairCustomerCode &&
            !['0002', '305', s.tenant.toUpperCase()].includes(
              p.after.bookFairCustomerCode,
            )
          )
            throw error('無法使用其他教會的客戶代碼', 403);
        }
        if (
          p.key.startsWith('stock:') &&
          p.after != null &&
          (!Number.isSafeInteger(p.after) || Math.abs(p.after) > 10000000)
        )
          throw error('數量須為整數');
      }
      for (let attempt = 0; attempt < 6; attempt++) {
        const current = attempt === 0 ? e : await event(id, s);
        if (current.status !== 'open') throw error('書展已封存', 409);
        const next = mergeChanges(JSON.parse(current.state), b.changes);
        const data = JSON.stringify(next);
        if (data.length > 5000000) throw error('此場資料量過大，請建立新場次');
        const r = await db()
          .prepare(
            "UPDATE events SET state=?,revision=revision+1,updated=?,actor=? WHERE id=? AND revision=? AND status='open'",
          )
          .bind(
            data,
            new Date().toISOString(),
            s.tenant || 'admin',
            id,
            current.revision,
          )
          .run();
        if (r.meta.changes)
          return json({
            revision: current.revision + 1,
            state: next,
            numbers: await assignNumbers(
              current,
              b.changes
                .filter((p: any) => p.key.startsWith('order:') && p.after)
                .map((p: any) => p.after),
            ),
          });
      }
      throw error('資料忙碌，請重試', 409);
    }
    if (action === 'archive') {
      isAdmin(s);
      if (req.method !== 'POST') throw error('請使用 POST', 405);
      await db()
        .prepare('UPDATE events SET status=?,updated=? WHERE id=?')
        .bind(b.open ? 'open' : 'archived', new Date().toISOString(), id)
        .run();
      return json({ ok: true });
    }
    if (action === 'close') {
      isAdmin(s);
      if (req.method === 'GET')
        return json(
          (
            await db()
              .prepare(
                'SELECT * FROM closings WHERE event=? ORDER BY created DESC',
              )
              .bind(id)
              .all()
          ).results,
        );
      if (e.status !== 'open') throw error('書展已封存');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.day)) throw error('日結日期錯誤');
      const state = JSON.parse(e.state);
      const dayState = Object.fromEntries(
        Object.entries(state).filter(
          ([k, v]: any) =>
            !k.startsWith('order:') ||
            (v.createdAt
              ? new Date(v.createdAt)
                  .toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
                  .replaceAll('/', '-')
              : String(v.id)
                  .slice(0, 8)
                  .replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')) === b.day,
        ),
      );
      const snap = {
        revision: e.revision,
        totals: stats(dayState),
        counts: b.counts,
        expenses: b.expenses,
        notes: b.notes,
        orders: Object.fromEntries(
          Object.entries(dayState).filter(([k]) => k.startsWith('order:')),
        ),
      };
      await db()
        .prepare(
          'INSERT INTO closings(id,event,day,snapshot,created) VALUES(?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          id,
          b.day,
          JSON.stringify(snap),
          new Date().toISOString(),
        )
        .run();
      return json({ ok: true, snapshot: snap });
    }
    if (action === 'backup') {
      isAdmin(s);
      return json({
        version: 2,
        event: e,
        numbers: await numbersFor(e, JSON.parse(e.state)),
        closings: (
          await db()
            .prepare('SELECT * FROM closings WHERE event=?')
            .bind(id)
            .all()
        ).results,
        audit: (
          await db()
            .prepare('SELECT * FROM audit WHERE event=? ORDER BY revision')
            .bind(id)
            .all()
        ).results,
      });
    }
    if (action === 'eri') {
      isAdmin(s);
      if (!Number.isSafeInteger(b.count) || b.count < 1 || b.count > 100000)
        throw error('ERI 申請數量不合法');
      const count = Math.max(100, b.count);
      await db()
        .prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('eri','0')")
        .run();
      const row: any = await db()
        .prepare(
          "UPDATE settings SET value=CAST(value AS INTEGER)+? WHERE key='eri' AND CAST(value AS INTEGER)+? < 2176782336 RETURNING value",
        )
        .bind(count, count)
        .first();
      if (!row) throw error('ERI 序號已用完');
      return json({ start: Number(row.value) - count, end: Number(row.value) });
    }
  }
  if (route === 'sync-shop') {
    isAdmin(s);
    if (req.method === 'GET') {
      const row: any = await db()
        .prepare("SELECT value FROM settings WHERE key='sync'")
        .first();
      return json(row ? JSON.parse(row.value) : { cursor: 0, total: 0 });
    }
    const last: any = await db()
      .prepare("SELECT value FROM settings WHERE key='sync'")
      .first();
    let job = last ? JSON.parse(last.value) : null;
    if (b.restart || !job || !job.urls?.length) {
      const res = await fetch('https://www.pbooks.com.tw/sitemap.xml');
      if (!res.ok) throw error('官網暫時無法同步，既有快取仍可使用', 502);
      const xml = await res.text();
      job = {
        urls: [
          ...xml.matchAll(
            /<loc>(https:\/\/www\.pbooks\.com\.tw\/products\/[^<]+)<\/loc>/g,
          ),
        ].map((m) => m[1]),
        cursor: 0,
        matched: 0,
        failed: 0,
        started: new Date().toISOString(),
      };
    }
    for (const url of job.urls.slice(job.cursor, job.cursor + 5)) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw Error();
        for (const p of parseShop(await res.text(), url)) {
          if (catalog.products.some((x) => x.code === p.code)) {
            await db()
              .prepare(
                'INSERT INTO shop(code,data) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data',
              )
              .bind(p.code, JSON.stringify(p))
              .run();
            job.matched++;
          }
        }
      } catch {
        job.failed++;
      }
      job.cursor++;
    }
    job.total = job.urls.length;
    job.finished = job.cursor >= job.total ? new Date().toISOString() : null;
    await db()
      .prepare(
        "INSERT INTO settings(key,value) VALUES('sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .bind(JSON.stringify(job))
      .run();
    const { urls, ...status } = job;
    return json(status);
  }
  throw error('找不到功能', 404);
}
