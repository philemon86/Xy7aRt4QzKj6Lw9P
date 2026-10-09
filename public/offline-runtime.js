"use strict";
var POSOfflineModule = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // lib/offline.mjs
  var offline_exports = {};
  __export(offline_exports, {
    getOfflineRuntime: () => getOfflineRuntime,
    registerOfflineWorker: () => registerOfflineWorker
  });

  // lib/state.mjs
  function mergeChanges(current, changes) {
    const next = { ...current };
    for (const p of changes) {
      if (!p || typeof p.key !== "string" || p.key.length > 160 || ["__proto__", "constructor", "prototype"].includes(p.key))
        throw Error("\u7121\u6548\u6B04\u4F4D");
      const existing = current[p.key] ?? null;
      if (JSON.stringify(existing) !== JSON.stringify(p.before ?? null) && JSON.stringify(existing) !== JSON.stringify(p.after ?? null)) {
        const error = Error("\u9019\u7B46\u8CC7\u6599\u5DF2\u88AB\u53E6\u4E00\u53F0\u88DD\u7F6E\u4FEE\u6539\uFF0C\u8ACB\u91CD\u65B0\u8F09\u5165\u5F8C\u518D\u64CD\u4F5C\u3002");
        error.status = 409;
        throw error;
      }
      if (p.after == null) delete next[p.key];
      else next[p.key] = p.after;
    }
    return next;
  }
  function validateOrder(o) {
    if (!o || typeof o.id !== "string" || !Array.isArray(o.items) || o.items.length > 1e3)
      throw Error("\u8A02\u55AE\u683C\u5F0F\u932F\u8AA4");
    let sum = 0;
    for (const i of o.items) {
      if (!i.code || typeof i.name !== "string" || /[<>]/.test(i.code) || /[<>]/.test(i.name.replace(/<[\u3400-\u9fff-]+>/g, "")) || ![i.price, i.quantity, i.discount].every(Number.isFinite) || Math.abs(i.price) > 9999999 || Math.abs(i.quantity) > 1e5 || i.discount < 0 || i.discount > 100)
        throw Error("\u5546\u54C1\u6578\u91CF\u6216\u91D1\u984D\u932F\u8AA4");
      sum += i.price * i.quantity * i.discount / 100;
    }
    if (!Number.isFinite(o.amount) || Math.round(sum) !== o.amount)
      throw Error("\u8A02\u55AE\u91D1\u984D\u8207\u660E\u7D30\u4E0D\u7B26");
    if (!Array.isArray(o.paymentRecords) || o.paymentRecords.some(
      (p) => !["\u73FE\u91D1", "\u4FE1\u7528\u5361", "LINE PAY", "\u6587\u5316\u5E63"].includes(p.method) || !Number.isFinite(p.amount)
    ) || Math.round(o.paymentRecords.reduce((s, p) => s + p.amount, 0)) !== o.amount)
      throw Error("\u4ED8\u6B3E\u91D1\u984D\u4E0D\u7B26");
    if (/[<>]/.test(o.id + o.paymentMethod)) throw Error("\u8A02\u55AE\u683C\u5F0F\u932F\u8AA4");
    return o;
  }
  function stats(state) {
    const orders = Object.entries(state).filter(([k]) => k.startsWith("order:")).map(([, v]) => v).filter((o) => o && o.isValid);
    return {
      orders: orders.length,
      revenue: orders.reduce((s, o) => s + o.amount, 0),
      payments: orders.flatMap((o) => o.paymentRecords || []).reduce(
        (s, p) => ({ ...s, [p.method]: (s[p.method] || 0) + p.amount }),
        {}
      ),
      quantity: orders.reduce(
        (s, o) => s + o.items.reduce((a, i) => a + i.quantity, 0),
        0
      )
    };
  }

  // lib/orders.mjs
  var CHURCH_PAYMENTS = ["\u6587\u5316\u5E63", "LINE PAY", "\u73FE\u91D1"];
  function validateRoleChange(role, tenant, patch, current) {
    if (role !== "admin" && patch.key.startsWith("stock:"))
      throw Object.assign(Error("\u5EAB\u5B58\u7531\u66F8\u623F\u532F\u5165\u8207\u8ABF\u6574"), { status: 403 });
    if (!patch.key.startsWith("order:") || patch.after == null) return;
    const order = patch.after;
    if (role !== "admin" && JSON.stringify(order.paymentRecords) !== JSON.stringify(current?.paymentRecords) && (order.paymentRecords || []).some(
      (p) => !CHURCH_PAYMENTS.includes(p.method)
    ))
      throw Object.assign(Error("\u6559\u6703\u53EF\u4F7F\u7528\u73FE\u91D1\u3001\u6587\u5316\u5E63\u8207 LINE PAY\uFF0C\u672A\u958B\u653E\u4FE1\u7528\u5361"), { status: 403 });
    if (role !== "admin" && order.bookFairCustomerCode && !["0002", "305", tenant.toUpperCase()].includes(order.bookFairCustomerCode))
      throw Object.assign(Error("\u7121\u6CD5\u4F7F\u7528\u5176\u4ED6\u6559\u6703\u7684\u5BA2\u6236\u4EE3\u78BC"), { status: 403 });
    if (current && (order.createdAt !== current.createdAt || order.transactionId !== current.transactionId))
      throw Error("\u539F\u51FA\u8CA8\u65E5\u671F\u8207\u8B58\u5225\u8CC7\u6599\u4E0D\u53EF\u8B8A\u66F4");
  }

  // lib/offline-engine.mjs
  var equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  var copy = (v) => structuredClone(v);
  var grantDays = 7 * 864e5;
  var apply = (state, patches) => {
    const next = { ...state };
    for (const p of patches) {
      if (p.after == null) delete next[p.key];
      else next[p.key] = p.after;
    }
    return next;
  };
  var OfflineEngine = class {
    constructor({ store, network, lock, notify = () => {
    }, now = Date.now, online = () => true }) {
      Object.assign(this, { store, network, lock, notify, now, online });
      this.disconnected = false;
    }
    key(portal, id) {
      return `event:${portal}:${id}`;
    }
    async grant(portal) {
      const auth = await this.store.get("auth:" + portal);
      if (!auth || auth.blocked || this.now() - auth.checked > grantDays)
        throw Object.assign(Error("\u6B64\u88DD\u7F6E\u9700\u5148\u9023\u7DDA\u767B\u5165\uFF0C\u624D\u80FD\u4F7F\u7528\u96E2\u7DDA\u8CC7\u6599\uFF1B\u5F85\u540C\u6B65\u8A02\u55AE\u4ECD\u4FDD\u7559\u3002"), { status: 401 });
      return auth.me;
    }
    async authenticated(portal, me) {
      if (!me || (portal === "admin" ? me.role !== "admin" : me.role !== "church" || me.tenant?.toLowerCase() !== portal))
        throw Object.assign(Error("\u5165\u53E3\u8207\u767B\u5165\u8EAB\u5206\u4E0D\u7B26"), { status: 403 });
      await this.store.put("auth:" + portal, { kind: "auth", portal, me, checked: this.now(), blocked: false });
    }
    async revoke(portal, signedOut = false) {
      const auth = await this.store.get("auth:" + portal);
      if (auth) await this.store.put("auth:" + portal, { ...auth, blocked: true, signedOut });
      this.notify(portal);
    }
    async remote(portal, path, body) {
      try {
        if (!this.online()) throw Object.assign(Error("\u76EE\u524D\u672A\u9023\u7DDA"), { network: true });
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
      } finally {
        this.notify(portal);
      }
    }
    async cacheEvent(portal, event) {
      const key = this.key(portal, event.id);
      return this.lock(key, async () => {
        const existing = await this.store.get(key);
        const record = { kind: "event", portal, event: copy(event), patches: existing?.patches || [], inflight: existing?.inflight || null, conflictKeys: existing?.conflictKeys || [], error: existing?.error || "", errorStatus: existing?.errorStatus || 0 };
        await this.store.put(key, record);
        return this.eventValue(record);
      });
    }
    eventValue(record) {
      return { ...copy(record.event), state: apply(record.event.state, record.patches) };
    }
    async cached(portal, path) {
      const me = await this.grant(portal);
      if (path === "me") return me;
      if (path === "session-renew") return { ok: true, offline: true };
      const match = path.match(/^events\/([^/]+)$/);
      if (match) {
        const record = await this.store.get(this.key(portal, match[1]));
        if (record) return this.eventValue(record);
      }
      const value = await this.store.get(`cache:${portal}:${path}`);
      if (value) {
        if (path === "bootstrap" || path === "events") {
          const records = (await this.store.all("event", portal)).filter((r) => r.kind === "event" && r.portal === portal);
          const list = path === "bootstrap" ? value.events : value;
          const downloadedOnly = records.filter((r) => !list.some((e) => e.id === r.event.id)).map((r) => {
            const { state, numbers, ...meta } = r.event;
            return meta;
          });
          const events = [...list, ...downloadedOnly].map((e) => {
            const record = records.find((r) => r.event.id === e.id);
            return record ? { ...e, ...stats(this.eventValue(record).state), offlineAvailable: true } : { ...e, offlineAvailable: false };
          });
          return path === "bootstrap" ? { ...value, me, events, catalog: await this.store.get(`cache:${portal}:catalog`) || value.catalog } : events;
        }
        return copy(value);
      }
      throw Error("\u5C1A\u672A\u4E0B\u8F09\u9019\u4EFD\u8CC7\u6599\u3002\u8ACB\u9023\u7DDA\u5F8C\u958B\u555F\u66F8\u5C55\uFF0C\u6216\u6309\u300C\u4E0B\u8F09\u96E2\u7DDA\u8CC7\u6599\u300D\u3002");
    }
    async cache(portal, path, result) {
      if (path === "bootstrap") {
        await this.authenticated(portal, result.me);
        await this.store.put(`cache:${portal}:catalog`, result.catalog);
        await this.store.put(`cache:${portal}:events`, result.events);
      } else if (path === "me") await this.authenticated(portal, result);
      else if (path === "session-renew") {
        const auth = await this.store.get("auth:" + portal);
        if (auth) await this.authenticated(portal, auth.me);
      }
      if (/^(bootstrap|catalog|catalog\/version|events|me|church-stock\/[^/]+)$/.test(path))
        await this.store.put(`cache:${portal}:${path}`, result);
      if (/^events\/[^/]+$/.test(path) && result.id && result.state)
        return this.cacheEvent(portal, result);
      return result;
    }
    async request(portal, path, body) {
      portal = (portal || "admin").toLowerCase();
      const auth = await this.store.get("auth:" + portal);
      if (auth?.signedOut && !["login", "logout"].includes(path))
        throw Object.assign(Error("\u6B64\u5165\u53E3\u5DF2\u767B\u51FA\uFF0C\u8ACB\u9023\u7DDA\u91CD\u65B0\u767B\u5165\u3002"), { status: 401 });
      const sync = path.match(/^events\/([^/]+)\/sync$/);
      if (sync && body) return this.enqueue(portal, sync[1], body);
      if (path === "logout") {
        await this.revoke(portal, true);
        try {
          return await this.remote(portal, path, body);
        } catch (error) {
          if (error.network) return { ok: true };
          throw error;
        }
      }
      if (path === "session-renew" && (this.disconnected || !this.online())) return this.cached(portal, path);
      if (body === void 0 && this.disconnected) {
        try {
          return await this.cached(portal, path);
        } catch (error) {
          if (error.status) throw error;
        }
      }
      try {
        const result = await this.remote(portal, path, body);
        if (path === "login") {
          if (auth) await this.store.put("auth:" + portal, { ...auth, signedOut: false });
          this.notify(portal);
          return result;
        }
        if (path === "events" && body !== void 0 && result.event?.id && result.event.state) {
          await this.cacheEvent(portal, result.event);
          return result;
        }
        return body === void 0 || path === "session-renew" ? await this.cache(portal, path, result) : result;
      } catch (error) {
        if (!error.network) throw error;
        if (body === void 0 || path === "session-renew") return this.cached(portal, path);
        throw Error("\u9019\u500B\u64CD\u4F5C\u9700\u8981\u9023\u7DDA\u3002\u96E2\u7DDA\u6642\u53EF\u4EE5\u5728\u5DF2\u4E0B\u8F09\u7684\u66F8\u5C55\u641C\u5C0B\u5546\u54C1\u8207\u7D50\u5E33\u3002");
      }
    }
    async enqueue(portal, id, body) {
      const me = await this.grant(portal);
      const key = this.key(portal, id);
      const value = await this.lock(key, async () => {
        const record = await this.store.get(key);
        if (!record) throw Error("\u5C1A\u672A\u4E0B\u8F09\u66F8\u5C55\uFF0C\u8ACB\u5148\u9023\u7DDA\u958B\u555F\u4E00\u6B21\u3002");
        if (record.event.status !== "open") throw Error("\u66F8\u5C55\u5DF2\u5C01\u5B58\uFF0C\u7121\u6CD5\u96E2\u7DDA\u4FEE\u6539\u3002");
        if (me.role === "admin" && record.event.organizer === "church" && body.changes.some((p) => !p.key.startsWith("stock:")))
          throw Error("\u66F8\u623F\u53EF\u67E5\u770B\u6559\u6703\u4EA4\u6613\uFF0C\u7531\u6559\u6703\u81EA\u884C\u7D50\u5E33\u3002");
        const local = this.eventValue(record).state;
        for (const p of body.changes) {
          if (!/^(order:|draft:|stock:|shared:)/.test(p.key)) throw Error("\u7121\u6548\u6B04\u4F4D");
          validateRoleChange(me.role, me.tenant || "", p, local[p.key]);
          if (p.key.startsWith("order:") && p.after) {
            validateOrder(p.after);
            if (p.key !== "order:" + p.after.id) throw Error("\u4EA4\u6613\u8B58\u5225\u4E0D\u7B26");
          }
        }
        mergeChanges(local, body.changes);
        const patches = new Map(record.patches.map((p) => [p.key, p]));
        for (const p of body.changes) {
          const old = patches.get(p.key);
          const merged = { key: p.key, before: old ? old.before : p.before ?? null, after: p.after ?? null };
          if (equal(merged.before, merged.after) && !record.inflight?.changes.some((s) => s.key === p.key)) patches.delete(p.key);
          else patches.set(p.key, merged);
        }
        record.patches = [...patches.values()];
        await this.store.put(key, record);
        return this.eventValue(record);
      });
      this.notify(portal);
      void this.syncEvent(portal, id).then(() => this.syncEvent(portal, id)).catch(() => {
      });
      return { localSaved: true, offline: true, state: value.state, revision: value.revision, numbers: value.numbers || {} };
    }
    async syncEvent(portal, id, retry = false) {
      const key = this.key(portal, id);
      return this.lock("send:" + key, async () => {
        await this.grant(portal);
        let record;
        const flight = await this.lock(key, async () => {
          record = await this.store.get(key);
          if (!record?.patches.length || record.error && record.errorStatus !== 409 && !retry) return null;
          const sendable = record.patches.filter((p) => !(record.conflictKeys || []).includes(p.key));
          if (!record.inflight && !sendable.length) return null;
          record.inflight ||= { revision: record.event.revision, changes: copy(sendable.slice(0, 500)) };
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
            if (!(record.conflictKeys || []).length) {
              record.error = "";
              record.errorStatus = 0;
            }
            await this.store.put(key, record);
          });
        } catch (error) {
          if (error.status === 409) {
            const latest = await this.remote(portal, "events/" + id);
            await this.lock(key, async () => {
              const current = await this.store.get(key);
              const sentByKey = new Map(sent.map((p) => [p.key, p]));
              const conflicts = [];
              const patches = [];
              for (const p of current.patches) {
                const server = latest.state[p.key] ?? null;
                const attempted = sentByKey.get(p.key);
                if (equal(server, p.after)) continue;
                if (attempted && equal(server, attempted.after))
                  patches.push({ ...p, before: server });
                else if (equal(server, p.before)) patches.push(p);
                else {
                  patches.push(p);
                  conflicts.push(p.key);
                }
              }
              current.event = latest;
              current.patches = patches;
              current.inflight = null;
              current.conflictKeys = conflicts;
              current.error = conflicts.length ? error.message : latest.status !== "open" ? "\u66F8\u5C55\u5DF2\u5C01\u5B58\uFF0C\u5F85\u540C\u6B65\u8CC7\u6599\u4ECD\u4FDD\u7559\u3002" : "";
              current.errorStatus = current.error ? 409 : 0;
              await this.store.put(key, current);
            });
            return;
          }
          if (!error.network) await this.lock(key, async () => {
            const current = await this.store.get(key);
            await this.store.put(key, { ...current, error: error.message, errorStatus: error.status || 400 });
          });
          throw error;
        } finally {
          this.notify(portal);
        }
      });
    }
    async syncAll(portal, retry = false) {
      const records = (await this.store.all("event", portal)).filter((r) => r.kind === "event" && r.portal === portal && r.patches.length);
      for (const r of records) {
        for (let i = 0; i < 50; i++) {
          await this.syncEvent(portal, r.event.id, retry || r.errorStatus === 401);
          const current = await this.store.get(this.key(portal, r.event.id));
          if (!current.patches.length || !current.patches.some((p) => !(current.conflictKeys || []).includes(p.key)) || current.error && current.errorStatus !== 409 && !retry) break;
        }
      }
    }
    async summary(portal) {
      const records = (await this.store.all("event", portal)).filter((r) => r.kind === "event" && r.portal === portal);
      return {
        offline: !this.online() || this.disconnected,
        pending: records.reduce((n, r) => n + r.patches.filter((p) => p.key.startsWith("order:")).length, 0),
        pendingEvents: records.filter((r) => r.patches.length).length,
        downloaded: records.length,
        error: records.find((r) => r.error)?.error || "",
        ready: !!await this.store.get("ready:" + portal)
      };
    }
    async requireSynced(portal) {
      await this.syncAll(portal, true);
      const summary = await this.summary(portal);
      if (summary.pendingEvents) throw Error("\u5C1A\u6709\u8CC7\u6599\u5F85\u540C\u6B65\uFF0C\u8ACB\u9023\u7DDA\u4E26\u5B8C\u6210\u540C\u6B65\u5F8C\u518D\u6B63\u5F0F\u532F\u51FA\u3002");
    }
    async conflicts(portal) {
      await this.grant(portal);
      const records = (await this.store.all("event", portal)).filter((r) => r.kind === "event" && r.portal === portal && r.errorStatus === 409);
      const review = [];
      for (const r of records) {
        const latest = await this.remote(portal, "events/" + r.event.id);
        for (const p of r.patches) {
          const server = latest.state[p.key] ?? null;
          if (!equal(server, p.before) && !equal(server, p.after))
            review.push({ event: r.event.id, name: r.event.name || "\u66F8\u5C55", key: p.key, device: p.after, server });
        }
      }
      return review;
    }
    async resolveConflicts(portal, review, choices) {
      await this.grant(portal);
      for (const id of new Set(review.map((r) => r.event))) {
        const latest = await this.remote(portal, "events/" + id);
        await this.lock(this.key(portal, id), async () => {
          const record = await this.store.get(this.key(portal, id));
          const patches = new Map(record.patches.map((p) => [p.key, p]));
          for (const item of review.filter((r) => r.event === id)) {
            const choice = choices[id + ":" + item.key];
            if (!["server", "device"].includes(choice)) throw Error("\u8ACB\u9010\u9805\u9078\u64C7\u4FDD\u7559\u96F2\u7AEF\u6216\u88DD\u7F6E\u8CC7\u6599\u3002");
            if (!equal(latest.state[item.key], item.server) || !equal(patches.get(item.key)?.after, item.device))
              throw Error("\u8CC7\u6599\u5DF2\u518D\u6B21\u8B8A\u66F4\uFF0C\u8ACB\u91CD\u65B0\u6AA2\u67E5\u5DEE\u7570\u3002");
            if (choice === "server") patches.delete(item.key);
            else patches.set(item.key, { key: item.key, before: item.server, after: item.device });
          }
          record.event = latest;
          record.patches = [...patches.values()];
          record.inflight = null;
          record.error = "";
          record.errorStatus = 0;
          record.conflictKeys = [];
          await this.store.put(this.key(portal, id), record);
        });
      }
      this.notify(portal);
      await this.syncAll(portal);
    }
  };

  // lib/offline-store.mjs
  function indexedStore() {
    let opened;
    function db() {
      return opened ||= new Promise((resolve, reject) => {
        const request = indexedDB.open("philemon-pos-offline", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("records").createIndex("kindPortal", ["kind", "portal"]);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(Error("\u88DD\u7F6E\u8CC7\u6599\u5EAB\u7121\u6CD5\u958B\u555F\uFF1B\u8ACB\u52FF\u6E05\u9664\u8CFC\u7269\u8ECA\uFF0C\u6AA2\u67E5\u700F\u89BD\u5668\u5132\u5B58\u6B0A\u9650\u3002"));
        request.onblocked = () => reject(Error("\u88DD\u7F6E\u8CC7\u6599\u5EAB\u88AB\u5176\u4ED6\u5206\u9801\u5360\u7528\uFF0C\u8ACB\u95DC\u9589\u820A\u5206\u9801\u5F8C\u91CD\u8A66\u3002"));
      });
    }
    async function operation(mode, action) {
      const database = await db();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction("records", mode, { durability: "strict" });
        let value;
        action(transaction.objectStore("records"), (result) => {
          value = result;
        });
        transaction.oncomplete = () => resolve(value);
        transaction.onerror = transaction.onabort = () => reject(Error("\u7121\u6CD5\u4FDD\u5B58\u5230\u88DD\u7F6E\uFF1B\u8ACB\u4FDD\u7559\u756B\u9762\u4E26\u6AA2\u67E5\u5132\u5B58\u7A7A\u9593\u3002"));
      });
    }
    return {
      get: (key) => operation("readonly", (s, done) => {
        s.get(key).onsuccess = (e) => done(e.target.result);
      }),
      put: (key, value) => operation("readwrite", (s) => s.put(value, key)),
      all: (kind, portal) => operation("readonly", (s, done) => {
        const request = kind ? s.index("kindPortal").getAll(IDBKeyRange.only([kind, portal])) : s.getAll();
        request.onsuccess = (e) => done(e.target.result);
      })
    };
  }

  // lib/offline.mjs
  function getOfflineRuntime() {
    if (window.POSOffline) return window.POSOffline;
    if (window.parent !== window && window.parent.POSOffline) return window.parent.POSOffline;
    const serial = /* @__PURE__ */ new Map();
    const lock = (key, fn) => {
      if (navigator.locks) return navigator.locks.request("pos-offline:" + key, fn);
      const pending = (serial.get(key) || Promise.resolve()).catch(() => {
      }).then(fn);
      serial.set(key, pending);
      return pending;
    };
    const portals = /* @__PURE__ */ new Set();
    const runtime = new OfflineEngine({
      store: indexedStore(),
      lock,
      online: () => navigator.onLine,
      notify: (portal) => {
        portals.add(portal);
        window.dispatchEvent(new CustomEvent("pos-offline-status", { detail: { portal } }));
      },
      network: async (portal, path, body) => {
        const response = await fetch("/pos/api/" + path, {
          method: body === void 0 ? "GET" : "POST",
          headers: { "X-POS-Portal": portal, ...body === void 0 ? {} : { "Content-Type": "application/json" } },
          ...body === void 0 ? {} : { body: JSON.stringify(body) },
          cache: "no-store",
          signal: AbortSignal.timeout(body === void 0 || path === "session-renew" ? 2500 : 12e3)
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          if (response.status === 401 && path !== "login") window.dispatchEvent(new Event("pos-session-expired"));
          throw Object.assign(Error(error.error || "\u96F2\u7AEF\u9023\u7DDA\u5931\u6557"), { status: response.status });
        }
        return response.json();
      }
    });
    const nativeRequest = runtime.request.bind(runtime);
    runtime.request = async (portal, path, body) => {
      portals.add(portal);
      if (body !== void 0 && /pilot|export|\/archive$/.test(path)) await runtime.requireSynced(portal);
      const result = await nativeRequest(portal, path, body);
      if (path === "bootstrap" && !runtime.disconnected) void runtime.syncAll(portal).catch(() => {
      });
      return result;
    };
    const sync = () => {
      for (const portal of portals) void (async () => {
        if (runtime.disconnected && navigator.onLine) {
          await runtime.grant(portal);
          const result = await runtime.remote(portal, "session-renew", {});
          await runtime.cache(portal, "session-renew", result);
        }
        await runtime.syncAll(portal);
      })().catch(() => {
      });
    };
    window.addEventListener("online", sync);
    window.addEventListener("offline", () => {
      for (const p of portals) runtime.notify(p);
    });
    setInterval(sync, 1e4);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) sync();
    });
    runtime.prepare = async (portal, progress = () => {
    }) => {
      progress("\u4E0B\u8F09\u5546\u54C1\u8207\u66F8\u5C55\u2026");
      const boot = await runtime.remote(portal, "bootstrap");
      await runtime.cache(portal, "bootstrap", boot);
      if (boot.me.role === "church") await runtime.request(portal, "church-stock/" + portal);
      const events = boot.events.filter((e) => e.status === "open");
      for (let i = 0; i < events.length; i++) {
        progress(`\u4E0B\u8F09\u66F8\u5C55 ${i + 1}/${events.length}\u2026`);
        await runtime.request(portal, "events/" + events[i].id);
        if (runtime.disconnected) throw Error("\u4E0B\u8F09\u4E2D\u65B7\uFF1B\u5DF2\u4E0B\u8F09\u7684\u8CC7\u6599\u4FDD\u7559\uFF0C\u9023\u7DDA\u5F8C\u53EF\u91CD\u8A66\u3002");
      }
      progress("\u4E0B\u8F09\u7D50\u5E33\u8207\u6383\u78BC\u7A0B\u5F0F\u2026");
      if (!navigator.serviceWorker) throw Error("\u6B64\u700F\u89BD\u5668\u4E0D\u652F\u63F4\u96E2\u7DDA\u958B\u555F\uFF0C\u8ACB\u4F7F\u7528\u6700\u65B0\u7248 Chrome\u3001Edge \u6216 Safari\u3002");
      const registration = await registerOfflineWorker();
      const worker = registration.active;
      if (!worker) throw Error("\u96E2\u7DDA\u7A0B\u5F0F\u5C1A\u672A\u5C31\u7DD2\uFF0C\u8ACB\u7A0D\u5F8C\u91CD\u8A66\u3002");
      await new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => reject(Error("\u96E2\u7DDA\u7A0B\u5F0F\u4E0B\u8F09\u903E\u6642\uFF0C\u8ACB\u91CD\u8A66\u3002")), 6e4);
        channel.port1.onmessage = ({ data }) => {
          clearTimeout(timer);
          channel.port1.close();
          if (data.error) reject(Error(data.error));
          else resolve(data);
        };
        worker.postMessage({ type: "PREPARE", route: location.pathname }, [channel.port2]);
      });
      await navigator.storage?.persist?.().catch(() => false);
      await runtime.store.put("ready:" + portal, { kind: "ready", portal, at: (/* @__PURE__ */ new Date()).toISOString() });
      runtime.notify(portal);
      progress("\u96E2\u7DDA\u8CC7\u6599\u5DF2\u5C31\u7DD2");
    };
    runtime.backup = async (portal) => {
      await runtime.grant(portal);
      return (await runtime.store.all("event", portal)).filter((r) => r.kind === "event" && r.portal === portal && r.patches.length);
    };
    window.POSOffline = runtime;
    return runtime;
  }
  var registrationPromise;
  async function registerOfflineWorker() {
    if (!navigator.serviceWorker) throw Error("\u700F\u89BD\u5668\u4E0D\u652F\u63F4\u96E2\u7DDA\u958B\u555F");
    return registrationPromise ||= (async () => {
      const registration = await navigator.serviceWorker.register("/pos/pos-sw.js", { scope: "/pos/", updateViaCache: "none" });
      const installing = registration.installing || registration.waiting;
      if (installing && installing.state !== "activated") await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          installing.removeEventListener("statechange", changed);
          reject(Error("\u96E2\u7DDA\u7A0B\u5F0F\u66F4\u65B0\u903E\u6642\uFF0C\u8ACB\u91CD\u8A66\u3002"));
        }, 6e4);
        const changed = () => {
          if (installing.state !== "activated" && installing.state !== "redundant") return;
          clearTimeout(timer);
          installing.removeEventListener("statechange", changed);
          if (installing.state === "activated") resolve();
          else reject(Error("\u96E2\u7DDA\u7A0B\u5F0F\u672A\u5B8C\u6210\u4E0B\u8F09\uFF0C\u8ACB\u91CD\u8A66\u3002"));
        };
        installing.addEventListener("statechange", changed);
        changed();
      });
      return Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(Error("\u96E2\u7DDA\u7A0B\u5F0F\u672A\u5B8C\u6210\u4E0B\u8F09\uFF0C\u8ACB\u4FDD\u6301\u9023\u7DDA\u5F8C\u91CD\u8A66\u3002")), 6e4))
      ]);
    })().catch((error) => {
      registrationPromise = null;
      throw error;
    });
  }
  return __toCommonJS(offline_exports);
})();
