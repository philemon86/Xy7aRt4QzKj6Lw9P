import { parseShop } from './shop.mjs';
import { BOGO_API, parseShopPromotions } from './shop-promotions.mjs';
import { mergeSyncedPromotions } from './pricing-rules.mjs';
import { syncCollectionPrices } from './shop-collection.mjs';

export function sitemapProducts(xml) {
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].replaceAll('&amp;', '&'))
    .filter((url) => {
      try {
        const u = new URL(url);
        return (
          u.origin === 'https://www.pbooks.com.tw' &&
          u.pathname.startsWith('/products/') &&
          !u.username &&
          !u.password
        );
      } catch {
        return false;
      }
    });
  if (!urls.length || urls.length > 5000)
    throw Error('官網商品清單不完整，保留既有快取');
  return [...new Set(urls)];
}
export function syncStatus(job) {
  const { urls, ...status } = job || { cursor: 0, total: 0 };
  return status;
}
export function dailySyncDue(job, now = Date.now()) {
  if (!job?.finished || !Number.isFinite(Date.parse(job.finished))) return true;
  const day = (date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(date));
  return day(job.finished) !== day(now);
}
export async function syncPromotions(
  db,
  config,
  fetcher = fetch,
  options = {},
) {
  const products = [];
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const res = await fetcher(BOGO_API + '?page=' + page, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw Error('官網活動暫時無法同步');
    const data = await res.json();
    if (
      !Array.isArray(data.products) ||
      !Number.isInteger(data.total_count) ||
      !Number.isInteger(data.total_pages) ||
      data.total_pages > 10
    )
      throw Error('官網活動格式變更');
    total = data.total_count;
    products.push(...data.products);
    if (page >= data.total_pages) break;
  }
  if (products.length !== total || !total)
    throw Error('官網活動清單不完整，保留快取');
  const incoming = parseShopPromotions(products, config.products);
  const merged = mergeSyncedPromotions(
    config.rules,
    incoming,
    options.restoreDeleted === true,
  );
  const revision = crypto.randomUUID();
  const value = JSON.stringify({
    ...merged,
    revision,
  });
  const old = await db
    .prepare("SELECT value FROM settings WHERE key='global-pricing'")
    .first();
  if ((old ? JSON.parse(old.value).revision : '') !== config.pricingRevision)
    throw Error('活動正在修改，延後官網同步');
  const r = old
    ? await db
        .prepare(
          "UPDATE settings SET value=? WHERE key='global-pricing' AND value=?",
        )
        .bind(value, old.value)
        .run()
    : await db
        .prepare(
          "INSERT OR IGNORE INTO settings(key,value) VALUES('global-pricing',?)",
        )
        .bind(value)
        .run();
  if (r.meta.changes !== 1) throw Error('活動正在修改，延後官網同步');
  const suppressed = incoming.filter((g) =>
    merged.deletedGroupIds.includes(g.id),
  ).length;
  return { revision, count: incoming.length - suppressed, suppressed };
}

export async function syncShopStep(db, config, options = {}, fetcher = fetch) {
  // Short durable lease prevents simultaneous browser/automation workers advancing a job twice.
  const lease = JSON.stringify({
    owner: crypto.randomUUID(),
    until: Date.now() + 90000,
  });
  const claimed = await db
    .prepare(
      "INSERT INTO settings(key,value) VALUES('shop-sync-lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(json_extract(settings.value,'$.until') AS INTEGER) < ?",
    )
    .bind(lease, Date.now())
    .run();
  const readJob = async () => {
    const row = await db
      .prepare("SELECT value FROM settings WHERE key='sync'")
      .first();
    return row ? JSON.parse(row.value) : null;
  };
  if (claimed.meta.changes !== 1)
    return { ...syncStatus(await readJob()), busy: true };
  try {
    let job = await readJob();
    const stale = dailySyncDue(job);
    const refreshPromotions = async () => {
      if (!job.collectionPricesAttempted) {
        job.collectionPricesAttempted = true;
        try {
          job.collectionPrices = await syncCollectionPrices(
            db,
            config,
            fetcher,
          );
        } catch (e) {
          job.collectionPriceError = e.message;
        }
      }
      if (job.promotionsAttempted) return;
      job.promotionsAttempted = true;
      try {
        job.promotions = await syncPromotions(db, config, fetcher);
      } catch (e) {
        job.promotionError = e.message;
      }
    };
    if (options.daily && job?.finished && !stale) {
      if (!job.promotionsAttempted || !job.collectionPricesAttempted) {
        await refreshPromotions();
        await db
          .prepare("UPDATE settings SET value=? WHERE key='sync'")
          .bind(JSON.stringify(job))
          .run();
      }
      return { ...syncStatus(job), skipped: true };
    }
    if (
      options.restart ||
      !job?.urls?.length ||
      (options.daily && job.finished && stale)
    ) {
      const res = await fetcher('https://www.pbooks.com.tw/sitemap.xml', {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw Error('官網暫時無法同步，既有快取仍可使用');
      const urls = sitemapProducts(await res.text());
      job = {
        urls,
        total: urls.length,
        cursor: 0,
        matched: 0,
        failed: 0,
        started: new Date().toISOString(),
        finished: null,
      };
    }
    await refreshPromotions();
    if (job.finished) return syncStatus(job);
    const known = new Set(config.products.map((p) => p.code));
    const slice = job.urls.slice(job.cursor, job.cursor + 6);
    // Only two requests in flight, separate from checkout; updates use one small DB batch.
    const writes = [];
    for (let i = 0; i < slice.length; i += 2) {
      await Promise.all(
        slice.slice(i, i + 2).map(async (url) => {
          try {
            if (!sitemapProducts('<loc>' + url + '</loc>').includes(url))
              throw Error('不支援的商品網址');
            const res = await fetcher(url, {
              signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) throw Error('官網讀取失敗');
            for (const p of parseShop(await res.text(), url))
              if (known.has(p.code)) {
                writes.push(
                  db
                    .prepare(
                      'INSERT INTO shop(code,data) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data',
                    )
                    .bind(p.code, JSON.stringify(p)),
                );
                job.matched++;
              }
          } catch {
            job.failed++;
          }
        }),
      );
    }
    job.cursor += slice.length;
    job.total = job.urls.length;
    job.finished = job.cursor >= job.total ? new Date().toISOString() : null;
    writes.push(
      db
        .prepare(
          "INSERT INTO settings(key,value) VALUES('sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .bind(JSON.stringify(job)),
    );
    await db.batch(writes);
    return syncStatus(job);
  } finally {
    await db
      .prepare("DELETE FROM settings WHERE key='shop-sync-lease' AND value=?")
      .bind(lease)
      .run();
  }
}
