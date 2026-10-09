import { mergeChanges, validateOrder, stats } from './state.mjs';
import { validateRoleChange } from './orders.mjs';

const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const copy = (v) => structuredClone(v);
const grantDays = 7 * 86400000;
const apply = (state, patches) => {
  const next = { ...state };
  for (const p of patches) {
    if (p.after == null) delete next[p.key]; else next[p.key] = p.after;
  }
  return next;
};
export class OfflineEngine {
  constructor({ store, network, lock, notify = () => {}, now = Date.now, online = () => true }) {
    Object.assign(this, { store, network, lock, notify, now, online });
    this.disconnected = false;
  }
  key(portal, id) { return `event:${portal}:${id}`; }
  async grant(portal) {
    const auth = await this.store.get('auth:' + portal);
    if (!auth || auth.blocked || this.now() - auth.checked > grantDays)
      throw Object.assign(Error('此裝置需先連線登入，才能使用離線資料；待同步訂單仍保留。'), { status: 401 });
    return auth.me;
  }
  async authenticated(portal, me) {
    if (!me || (portal === 'admin' ? me.role !== 'admin' : me.role !== 'church' || me.tenant?.toLowerCase() !== portal))
      throw Object.assign(Error('入口與登入身分不符'), { status: 403 });
    await this.store.put('auth:' + portal, { kind: 'auth', portal, me, checked: this.now(), blocked: false });
  }
  async revoke(portal, signedOut = false) {
    const auth = await this.store.get('auth:' + portal);
    if (auth) await this.store.put('auth:' + portal, { ...auth, blocked: true, signedOut });
    this.notify(portal);
  }
  async remote(portal, path, body) {
    try {
      if (!this.online()) throw Object.assign(Error('目前未連線'), { network: true });
      const result = await this.network(portal, path, body);
      this.disconnected = false;
      return result;
    } catch (error) {
      if (error.status === 401 || error.status === 403) await this.revoke(portal);
      if (!error.status || [408, 429, 502, 503, 504].includes(error.status)) {
        this.disconnected = true;
        error.network = true;
      }
      throw error;
    } finally { this.notify(portal); }
  }
  async cacheEvent(portal, event) {
    const key = this.key(portal, event.id);
    return this.lock(key, async () => {
      const existing = await this.store.get(key);
      const record = { kind: 'event', portal, event: copy(event), patches: existing?.patches || [], inflight: existing?.inflight || null, error: existing?.error || '', errorStatus: existing?.errorStatus || 0 };
      await this.store.put(key, record);
      return this.eventValue(record);
    });
  }
  eventValue(record) { return { ...copy(record.event), state: apply(record.event.state, record.patches) }; }
  async cached(portal, path) {
    const me = await this.grant(portal);
    if (path === 'me') return me;
    if (path === 'session-renew') return { ok: true, offline: true };
    const match = path.match(/^events\/([^/]+)$/);
    if (match) {
      const record = await this.store.get(this.key(portal, match[1]));
      if (record) return this.eventValue(record);
    }
    const value = await this.store.get(`cache:${portal}:${path}`);
    if (value) {
      if (path === 'bootstrap' || path === 'events') {
        const records = (await this.store.all('event', portal)).filter((r) => r.kind === 'event' && r.portal === portal);
        const list = path === 'bootstrap' ? value.events : value;
        const downloadedOnly = records.filter((r) => !list.some((e) => e.id === r.event.id)).map((r) => {
          const { state, numbers, ...meta } = r.event;
          return meta;
        });
        const events = [...list, ...downloadedOnly].map((e) => {
          const record = records.find((r) => r.event.id === e.id);
          return record ? { ...e, ...stats(this.eventValue(record).state), offlineAvailable: true } : { ...e, offlineAvailable: false };
        });
        return path === 'bootstrap' ? { ...value, me, events, catalog: await this.store.get(`cache:${portal}:catalog`) || value.catalog } : events;
      }
      return copy(value);
    }
    throw Error('尚未下載這份資料。請連線後開啟書展，或按「下載離線資料」。');
  }
  async cache(portal, path, result) {
    if (path === 'bootstrap') {
      await this.authenticated(portal, result.me);
      await this.store.put(`cache:${portal}:catalog`, result.catalog);
      await this.store.put(`cache:${portal}:events`, result.events);
    } else if (path === 'me') await this.authenticated(portal, result);
    else if (path === 'session-renew') {
      const auth = await this.store.get('auth:' + portal);
      if (auth) await this.authenticated(portal, auth.me);
    }
    if (/^(bootstrap|catalog|catalog\/version|events|me|church-stock\/[^/]+)$/.test(path))
      await this.store.put(`cache:${portal}:${path}`, result);
    if (/^events\/[^/]+$/.test(path) && result.id && result.state)
      return this.cacheEvent(portal, result);
    return result;
  }
  async request(portal, path, body) {
    portal = (portal || 'admin').toLowerCase();
    const auth = await this.store.get('auth:' + portal);
    if (auth?.signedOut && !['login', 'logout'].includes(path))
      throw Object.assign(Error('此入口已登出，請連線重新登入。'), { status: 401 });
    const sync = path.match(/^events\/([^/]+)\/sync$/);
    if (sync && body) return this.enqueue(portal, sync[1], body);
    if (path === 'logout') {
      await this.revoke(portal, true);
      try { return await this.remote(portal, path, body); }
      catch (error) { if (error.network) return { ok: true }; throw error; }
    }
    if (path === 'session-renew' && (this.disconnected || !this.online())) return this.cached(portal, path);
    if (body === undefined && this.disconnected) {
      try { return await this.cached(portal, path); }
      catch (error) { if (error.status) throw error; /* An uncached online operation may still succeed. */ }
    }
    // Cache fallback is restricted to network failures. An HTTP denial never
    // becomes an offline login, and no password or session token is stored here.
    try {
      const result = await this.remote(portal, path, body);
      if (path === 'login') {
        // Bootstrap performs the authenticated role/tenant check immediately after login.
        if (auth) await this.store.put('auth:' + portal, { ...auth, signedOut: false });
        this.notify(portal);
        return result;
      }
      if (path === 'events' && body !== undefined && result.event?.id && result.event.state) {
        await this.cacheEvent(portal, result.event);
        return result;
      }
      return body === undefined || path === 'session-renew' ? await this.cache(portal, path, result) : result;
    } catch (error) {
      if (!error.network) throw error;
      if (body === undefined || path === 'session-renew') return this.cached(portal, path);
      throw Error('這個操作需要連線。離線時可以在已下載的書展搜尋商品與結帳。');
    }
  }
  async enqueue(portal, id, body) {
    const me = await this.grant(portal);
    const key = this.key(portal, id);
    const value = await this.lock(key, async () => {
      const record = await this.store.get(key);
      if (!record) throw Error('尚未下載書展，請先連線開啟一次。');
      if (record.error) throw Error('待同步資料需處理：' + record.error);
      if (record.event.status !== 'open') throw Error('書展已封存，無法離線修改。');
      if (me.role === 'admin' && record.event.organizer === 'church' && body.changes.some((p) => !p.key.startsWith('stock:')))
        throw Error('書房可查看教會交易，由教會自行結帳。');
      const local = this.eventValue(record).state;
      for (const p of body.changes) {
        if (!/^(order:|draft:|stock:|shared:)/.test(p.key)) throw Error('無效欄位');
        validateRoleChange(me.role, me.tenant || '', p, local[p.key]);
        if (p.key.startsWith('order:') && p.after) {
          validateOrder(p.after);
          if (p.key !== 'order:' + p.after.id) throw Error('交易識別不符');
        }
      }
      mergeChanges(local, body.changes);
      const patches = new Map(record.patches.map((p) => [p.key, p]));
      for (const p of body.changes) {
        const old = patches.get(p.key);
        const merged = { key: p.key, before: old ? old.before : p.before ?? null, after: p.after ?? null };
        // Keep an undo while a previous attempt may already have reached the server.
        if (equal(merged.before, merged.after) && !record.inflight?.changes.some((s) => s.key === p.key)) patches.delete(p.key);
        else patches.set(p.key, merged);
      }
      record.patches = [...patches.values()];
      await this.store.put(key, record); // Wait for transaction commit before acknowledging checkout.
      return this.eventValue(record);
    });
    this.notify(portal);
    // Never make a cashier wait for an HTTP round trip after a durable local commit.
    void this.syncEvent(portal, id).catch(() => {});
    return { localSaved: true, offline: true, state: value.state, revision: value.revision, numbers: value.numbers || {} };
  }
  async syncEvent(portal, id, retry = false) {
    const key = this.key(portal, id);
    return this.lock('send:' + key, async () => {
      await this.grant(portal);
      let record;
      const flight = await this.lock(key, async () => {
        record = await this.store.get(key);
        if (!record?.patches.length || (record.error && !retry)) return null;
        // Persist the exact request before transmission. If its response is lost,
        // replay it unchanged before sending any later edits or cancellations.
        record.inflight ||= { revision: record.event.revision, changes: copy(record.patches.slice(0, 500)) };
        await this.store.put(key, record);
        return copy(record.inflight);
      });
      if (!flight) return;
      const sent = flight.changes;
      try {
        const result = await this.remote(portal, `events/${id}/sync`, flight);
        await this.lock(key, async () => {
          record = await this.store.get(key);
          const state = result.state || apply(record.event.state, result.patches || sent);
          const pending = new Map(record.patches.map((p) => [p.key, p]));
          for (const p of sent) {
            const current = pending.get(p.key);
            if (!current) continue;
            if (equal(current.after, p.after)) pending.delete(p.key);
            else pending.set(p.key, { ...current, before: p.after });
          }
          record.event = { ...record.event, state, revision: result.revision, numbers: { ...record.event.numbers, ...result.numbers } };
          record.patches = [...pending.values()];
          record.inflight = null;
          record.error = '';
          record.errorStatus = 0;
          await this.store.put(key, record);
        });
      } catch (error) {
        if (!error.network) await this.lock(key, async () => {
          const current = await this.store.get(key);
          await this.store.put(key, { ...current, error: error.message, errorStatus: error.status || 400 });
        });
        throw error;
      } finally { this.notify(portal); }
    });
  }
  async syncAll(portal, retry = false) {
    const records = (await this.store.all('event', portal)).filter((r) => r.kind === 'event' && r.portal === portal && r.patches.length);
    for (const r of records) {
      // A large fair may need several bounded batches, including edits made in flight.
      for (let i = 0; i < 50; i++) {
        await this.syncEvent(portal, r.event.id, retry || r.errorStatus === 401);
        const current = await this.store.get(this.key(portal, r.event.id));
        if (!current.patches.length || (current.error && !retry)) break;
      }
    }
  }
  async summary(portal) {
    const records = (await this.store.all('event', portal)).filter((r) => r.kind === 'event' && r.portal === portal);
    return {
      offline: !this.online() || this.disconnected,
      pending: records.reduce((n, r) => n + r.patches.filter((p) => p.key.startsWith('order:')).length, 0),
      pendingEvents: records.filter((r) => r.patches.length).length,
      downloaded: records.length,
      error: records.find((r) => r.error)?.error || '',
      ready: !!(await this.store.get('ready:' + portal)),
    };
  }
  async requireSynced(portal) {
    await this.syncAll(portal, true);
    const summary = await this.summary(portal);
    if (summary.pendingEvents) throw Error('尚有資料待同步，請連線並完成同步後再正式匯出。');
  }
  async conflicts(portal) {
    await this.grant(portal);
    const records = (await this.store.all('event', portal)).filter((r) => r.kind === 'event' && r.portal === portal && r.errorStatus === 409);
    const review = [];
    for (const r of records) {
      const latest = await this.remote(portal, 'events/' + r.event.id);
      for (const p of r.patches) {
        const server = latest.state[p.key] ?? null;
        if (!equal(server, p.before) && !equal(server, p.after))
          review.push({ event: r.event.id, name: r.event.name || '書展', key: p.key, device: p.after, server });
      }
    }
    return review;
  }
  async resolveConflicts(portal, review, choices) {
    // User reviews explicit cloud/device values. Never silently rebase a conflict.
    await this.grant(portal);
    for (const id of new Set(review.map((r) => r.event))) {
      const latest = await this.remote(portal, 'events/' + id);
      await this.lock(this.key(portal, id), async () => {
        const record = await this.store.get(this.key(portal, id));
        const patches = new Map(record.patches.map((p) => [p.key, p]));
        for (const item of review.filter((r) => r.event === id)) {
          const choice = choices[id + ':' + item.key];
          if (!['server', 'device'].includes(choice)) throw Error('請逐項選擇保留雲端或裝置資料。');
          if (!equal(latest.state[item.key], item.server) || !equal(patches.get(item.key)?.after, item.device))
            throw Error('資料已再次變更，請重新檢查差異。');
          if (choice === 'server') patches.delete(item.key);
          else patches.set(item.key, { key: item.key, before: item.server, after: item.device });
        }
        record.event = latest;
        record.patches = [...patches.values()];
        record.inflight = null;
        record.error = ''; record.errorStatus = 0;
        await this.store.put(this.key(portal, id), record);
      });
    }
    this.notify(portal);
    await this.syncAll(portal);
  }
}
