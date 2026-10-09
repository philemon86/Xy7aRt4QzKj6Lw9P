import { OfflineEngine } from './offline-engine.mjs';
import { indexedStore } from './offline-store.mjs';

export function getOfflineRuntime() {
  if (window.POSOffline) return window.POSOffline;
  // The cashier iframe and workspace share one coordinator and one device DB.
  if (window.parent !== window && window.parent.POSOffline) return window.parent.POSOffline;
  const serial = new Map();
  const lock = (key, fn) => {
    if (navigator.locks) return navigator.locks.request('pos-offline:' + key, fn);
    const pending = (serial.get(key) || Promise.resolve()).catch(() => {}).then(fn);
    serial.set(key, pending);
    return pending;
  };
  const portals = new Set();
  const runtime = new OfflineEngine({
    store: indexedStore(), lock,
    online: () => navigator.onLine,
    notify: (portal) => {
      portals.add(portal);
      window.dispatchEvent(new CustomEvent('pos-offline-status', { detail: { portal } }));
    },
    network: async (portal, path, body) => {
      const response = await fetch('/pos/api/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-POS-Portal': portal, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store',
        signal: AbortSignal.timeout(body === undefined || path === 'session-renew' ? 2500 : 12000),
      });
      // HTML error pages from an upstream outage must not masquerade as a valid cache.
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (response.status === 401 && path !== 'login') window.dispatchEvent(new Event('pos-session-expired'));
        throw Object.assign(Error(error.error || '雲端連線失敗'), { status: response.status });
      }
      return response.json();
    },
  });
  const nativeRequest = runtime.request.bind(runtime);
  runtime.request = async (portal, path, body) => {
    portals.add(portal);
    // Final export must reflect every locally accepted checkout, not an old server snapshot.
    if (body !== undefined && /pilot|export|\/archive$/.test(path)) await runtime.requireSynced(portal);
    const result = await nativeRequest(portal, path, body);
    if (path === 'bootstrap' && !runtime.disconnected) void runtime.syncAll(portal).catch(() => {});
    return result;
  };
  const sync = () => {
    for (const portal of portals) void (async () => {
      if (runtime.disconnected && navigator.onLine) {
        await runtime.grant(portal);
        const result = await runtime.remote(portal, 'session-renew', {});
        await runtime.cache(portal, 'session-renew', result);
      }
      await runtime.syncAll(portal);
    })().catch(() => {});
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', () => { for (const p of portals) runtime.notify(p); });
  setInterval(sync, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  runtime.prepare = async (portal, progress = () => {}) => {
    progress('下載商品與書展…');
    const boot = await runtime.remote(portal, 'bootstrap');
    await runtime.cache(portal, 'bootstrap', boot);
    if (boot.me.role === 'church') await runtime.request(portal, 'church-stock/' + portal);
    const events = boot.events.filter((e) => e.status === 'open');
    // Sequential downloads avoid flooding the server; cashiers can keep working.
    for (let i = 0; i < events.length; i++) {
      progress(`下載書展 ${i + 1}/${events.length}…`);
      await runtime.request(portal, 'events/' + events[i].id);
      if (runtime.disconnected) throw Error('下載中斷；已下載的資料保留，連線後可重試。');
    }
    progress('下載結帳與掃碼程式…');
    if (!navigator.serviceWorker) throw Error('此瀏覽器不支援離線開啟，請使用最新版 Chrome、Edge 或 Safari。');
    const registration = await registerOfflineWorker();
    const worker = registration.active;
    if (!worker) throw Error('離線程式尚未就緒，請稍後重試。');
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => reject(Error('離線程式下載逾時，請重試。')), 60000);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timer);
        channel.port1.close();
        if (data.error) reject(Error(data.error)); else resolve(data);
      };
      worker.postMessage({ type: 'PREPARE', route: location.pathname }, [channel.port2]);
    });
    await navigator.storage?.persist?.().catch(() => false);
    await runtime.store.put('ready:' + portal, { kind: 'ready', portal, at: new Date().toISOString() });
    runtime.notify(portal);
    progress('離線資料已就緒');
  };
  runtime.backup = async (portal) => {
    await runtime.grant(portal);
    return (await runtime.store.all('event', portal)).filter((r) => r.kind === 'event' && r.portal === portal && r.patches.length);
  };
  window.POSOffline = runtime;
  return runtime;
}
let registrationPromise;
export async function registerOfflineWorker() {
  if (!navigator.serviceWorker) throw Error('瀏覽器不支援離線開啟');
  return registrationPromise ||= (async () => {
    const registration = await navigator.serviceWorker.register('/pos/pos-sw.js', { scope: '/pos/', updateViaCache: 'none' });
    const installing = registration.installing || registration.waiting;
    if (installing && installing.state !== 'activated') await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { installing.removeEventListener('statechange', changed); reject(Error('離線程式更新逾時，請重試。')); }, 60000);
      const changed = () => {
        if (installing.state !== 'activated' && installing.state !== 'redundant') return;
        clearTimeout(timer); installing.removeEventListener('statechange', changed);
        if (installing.state === 'activated') resolve(); else reject(Error('離線程式未完成下載，請重試。'));
      };
      installing.addEventListener('statechange', changed); changed();
    });
    return Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(Error('離線程式未完成下載，請保持連線後重試。')), 60000)),
    ]);
  })().catch((error) => { registrationPromise = null; throw error; });
}
