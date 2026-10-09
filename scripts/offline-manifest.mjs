import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { REGISTER_FILE } from '../lib/release.mjs';
const root = 'dist/client';
async function files(dir) {
  const result = [];
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const path = dir + '/' + f.name;
    if (f.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result;
}
const assets = (await files(root + '/pos/_next')).filter((p) => /\.(js|css|woff2?|wasm)$/.test(p)).map((p) => p.slice(root.length));
for (const file of [REGISTER_FILE, '/bridge.js', '/offline-runtime.js', '/pos-core.js', '/checkout.css', '/register.css', '/barcode-decoder-v2.js', '/barcode-reader-v3.wasm', '/barcode-worker-v3.js', '/favicon-bookstore.svg', '/favicon-church.svg', '/文化幣.jpg', '/LINEPAY.jpg', '/LOGO.png']) {
  await readFile(root + file); // A missing required decoder/payment asset must fail the build.
  assets.push('/pos' + file);
}
const hash = createHash('sha256');
for (const asset of assets) hash.update(await readFile(root + (asset.startsWith('/pos/_next/') ? asset : asset.slice(4))));
const version = hash.digest('hex').slice(0, 16);
await writeFile(root + '/offline-assets.json', JSON.stringify({ version, assets }));
await writeFile(root + '/pos-sw.js', (await readFile('public/pos-sw.js', 'utf8')).replaceAll('__ASSET_VERSION__', version));
console.log(`Offline manifest: ${assets.length} required assets, ${version}`);
