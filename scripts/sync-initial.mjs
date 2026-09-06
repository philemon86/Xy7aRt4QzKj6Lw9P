import fs from 'node:fs';
import { parseShop } from '../lib/shop.mjs';
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL('data/catalog.json', root)));
const known = new Set(catalog.products.map((p) => p.code));
const response = await fetch('https://www.pbooks.com.tw/sitemap.xml');
if (!response.ok) throw Error('官網 sitemap 讀取失敗');
const xml = await response.text();
const urls = [
  ...xml.matchAll(
    /<loc>(https:\/\/www\.pbooks\.com\.tw\/products\/[^<]+)<\/loc>/g,
  ),
].map((m) => m[1].replaceAll('&amp;', '&'));
const outPath = new URL('data/shop-cache.json', root);
let cache = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath)) : {};
let i = 0,
  done = 0,
  fail = 0;
async function run() {
  while (i < urls.length) {
    const url = urls[i++];
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error(response.status);
      const found = parseShop(await response.text(), url);
      for (const p of found) if (known.has(p.code)) cache[p.code] = p;
      done++;
    } catch {
      fail++;
    }
    if ((done + fail) % 40 === 0) {
      fs.writeFileSync(outPath, JSON.stringify(cache));
      console.log(
        JSON.stringify({
          processed: done + fail,
          total: urls.length,
          matched: Object.keys(cache).length,
          fail,
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}
await Promise.all([run(), run(), run()]);
fs.writeFileSync(outPath, JSON.stringify(cache));
fs.writeFileSync(new URL('data/shop-urls.json', root), JSON.stringify(urls));
console.log(
  JSON.stringify({
    done,
    fail,
    matched: Object.keys(cache).length,
    total: urls.length,
  }),
);
