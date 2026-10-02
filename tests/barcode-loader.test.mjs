import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadBarcodeDecoder } from '../lib/barcode-loader.mjs';
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
});
test('Failed scanner loads retry automatically, permit another attempt and share one successful load', async () => {
  const host = {};
  let requests = 0,
    failures = true;
  const document = {
    createElement: () => ({ remove() {} }),
    head: {
      append(script) {
        requests++;
        assert.match(script.src, /^\/pos\/barcode-decoder\.js\?v=1/);
        queueMicrotask(() => {
          if (failures) script.onerror();
          else {
            host.POSBarcodeDecoder = { BrowserMultiFormatReader() {} };
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
