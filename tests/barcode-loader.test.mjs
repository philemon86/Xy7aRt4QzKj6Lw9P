import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { POS_RELEASE, REGISTER_FILE } from '../lib/release.mjs';
import { loadBarcodeDecoder } from '../lib/barcode-loader.mjs';
test('Old open registers keep their exact camera imports across a deployment', async () => {
  for (const [file, hash] of [
    [
      'esm-BIEdAo5f.js',
      'a08646f45c20464e8499abf575e08a0c7f8fc14c0f8cec2c90a7367e6c625fea',
    ],
    [
      'esm-CozMJoCa.js',
      '4cd93ebc7363249d9df2e0f237f356e6bd5167354244ccf360ea433e1854e472',
    ],
  ])
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync('compat/camera/' + file))
        .digest('hex'),
      hash,
    );
  const previousWindow = globalThis.window;
  globalThis.window = { BigInt };
  try {
    const library =
      await import('../compat/camera/esm-BIEdAo5f.js');
    const browser =
      await import('../compat/camera/esm-CozMJoCa.js');
    assert.equal(typeof browser.BrowserMultiFormatReader, 'function');
    assert.equal(typeof library.DecodeHintType.TRY_HARDER, 'number');
    assert.equal(typeof library.BarcodeFormat.EAN_13, 'number');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
test('Register HTML and direct dependencies have matching release URLs', () => {
  const html = fs.readFileSync('public' + REGISTER_FILE, 'utf8');
  assert.equal(html, fs.readFileSync('public/register.html', 'utf8'));
  for (const file of ['bridge.js', 'pos-core.js', 'checkout.css'])
    assert.ok(html.includes('/pos/' + file + '?v=' + POS_RELEASE));
});
test('Published decoder is self-contained and exports the reader and hint enums', () => {
  const context = { window: { BigInt } };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync('public/barcode-decoder.js', 'utf8'),
    context,
  );
  assert.equal(
    typeof context.POSBarcodeDecoder.BrowserMultiFormatReader,
    'function',
  );
  assert.equal(
    typeof context.POSBarcodeDecoder.DecodeHintType.TRY_HARDER,
    'number',
  );
  assert.equal(typeof context.POSBarcodeDecoder.BarcodeFormat.EAN_13, 'number');
  assert.equal(typeof context.POSBarcodeDecoder.createGlareReader, 'function');
});
test('Failed scanner loads retry automatically, permit another attempt and share one successful load', async () => {
  const host = {POSBarcodeDecoder: {BrowserMultiFormatReader() {}}};
  let requests = 0,
    failures = true;
  const document = {
    createElement: () => ({ remove() {} }),
    head: {
      append(script) {
        requests++;
        assert.match(script.src, /^\/pos\/barcode-decoder-v2\.js\?v=2/);
        queueMicrotask(() => {
          if (failures) script.onerror();
          else {
            host.POSBarcodeDecoder = { BrowserMultiFormatReader() {}, createGlareReader() {} };
            script.onload();
          }
        });
      },
    },
  };
  await assert.rejects(loadBarcodeDecoder(host, document), /載入失敗/);
  assert.equal(requests, 2);
  failures = false;
  const first = loadBarcodeDecoder(host, document);
  assert.equal(loadBarcodeDecoder(host, document), first);
  assert.equal(await first, host.POSBarcodeDecoder);
  assert.equal(requests, 3);
  await loadBarcodeDecoder(host, document);
  assert.equal(requests, 3);
});
