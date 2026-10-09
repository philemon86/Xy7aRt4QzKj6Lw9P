// Scope is /pos/ only. API data lives in portal-scoped IndexedDB, never HTTP cache.
const CACHE = 'philemon-pos-assets-__ASSET_VERSION__';
const PAGES = 'philemon-pos-pages-__ASSET_VERSION__';
const MANIFEST = '/pos/offline-assets.json';
const pagePath = (path) => /^\/pos\/(?:[a-z]{2}\d{2}\/?|)$/.test(path);
async function resources() {
  const cache = await caches.open(CACHE);
  const manifest = await cache.match(MANIFEST);
  if (!manifest) throw Error('離線程式未完成下載');
  return { cache, manifest: await manifest.json() };
}
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = await fetch(MANIFEST, { cache: 'reload' });
    if (!response.ok) throw Error('離線程式清單讀取失敗');
    const manifest = await response.clone().json();
    const cache = await caches.open(CACHE);
    // Small parallel batches reduce first-download congestion and fail as a unit.
    for (let i = 0; i < manifest.assets.length; i += 6) {
      await Promise.all(manifest.assets.slice(i, i + 6).map(async (path) => {
        const asset = await fetch(path, { cache: 'reload' });
        if (!asset.ok || (path.endsWith('.js') && !/javascript/.test(asset.headers.get('content-type') || '')))
          throw Error('離線資源下載失敗：' + path);
        await cache.put(path, asset);
      }));
    }
    await cache.put(MANIFEST, response);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  // Keep older assets for open cashiers during a release. No destructive cache cleanup mid-sale.
  event.waitUntil(self.clients.claim());
});
async function storePage(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok || !/text\/html/.test(response.headers.get('content-type') || '')) throw Error('離線登入頁下載失敗');
  await (await caches.open(PAGES)).put(path, response.clone());
  return response;
}
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'PREPARE') return;
  event.waitUntil((async () => {
    try {
      const path = event.data.route;
      if (!pagePath(path)) throw Error('無效入口');
      const { cache, manifest } = await resources();
      for (const path of manifest.assets) if (!(await cache.match(path))) throw Error('離線資源不完整，請重新整理後重試');
      await storePage(path);
      event.ports[0]?.postMessage({ ready: true });
    } catch (error) { event.ports[0]?.postMessage({ error: error.message }); }
  })());
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/pos/') || url.pathname.startsWith('/pos/api/')) return;
  if (event.request.mode === 'navigate' && pagePath(url.pathname)) {
    event.respondWith((async () => {
      const cached = await (await caches.open(PAGES)).match(url.pathname);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), cached ? 1200 : 10000);
        let response;
        try { response = await fetch(event.request, { signal: controller.signal }); }
        finally { clearTimeout(timer); }
        if (!response.ok) throw Error('連線失敗');
        if (/text\/html/.test(response.headers.get('content-type') || ''))
          await (await caches.open(PAGES)).put(url.pathname, response.clone());
        return response;
      } catch { return cached || new Response('尚未下載此入口。請連線後登入並下載離線資料。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
    })());
    return;
  }
  event.respondWith((async () => {
    const { cache, manifest } = await resources();
    if (!manifest.assets.includes(url.pathname)) return fetch(event.request);
    // query strings on decoder scripts don't change their release-bound contents.
    return await cache.match(url.pathname) || fetch(event.request);
  })());
});
