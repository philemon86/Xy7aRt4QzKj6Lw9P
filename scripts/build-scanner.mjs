// A self-contained, stable asset avoids late imports of deployment-specific chunks.
// Loaded only when a device needs the JavaScript barcode fallback.
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const result = await build({
  configFile: false,
  root,
  publicDir: false,
  build: {
    write: false,
    lib: {
      entry: path.join(root, 'scripts/barcode-decoder.ts'),
      name: 'POSBarcodeDecoder',
      formats: ['iife'],
    },
    minify: true,
  },
});
const bundle = (Array.isArray(result) ? result : [result])
  .flatMap((r) => r.output)
  .find((o) => o.type === 'chunk');
if (!bundle || bundle.imports.length || bundle.dynamicImports.length)
  throw Error('Scanner must be self-contained');
fs.writeFileSync(path.join(root, 'public/barcode-decoder.js'), bundle.code);
fs.writeFileSync(path.join(root, 'public/barcode-decoder-v2.js'), bundle.code);
console.log(
  'Self-contained barcode decoder generated (' + bundle.code.length + ' bytes)',
);
