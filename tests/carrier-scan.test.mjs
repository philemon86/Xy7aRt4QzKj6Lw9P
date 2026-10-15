import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeCarrierScan } from '../lib/carrier-scan.mjs';
import { code39Bits } from './fixtures/carrier-code39.mjs';

test('Carrier camera accepts complete mobile carriers and rejects products, donations and unrelated scans', () => {
  for (const value of ['/AB12345', '/AB+12-.', ' /ab+12-.\n'])
    assert.equal(normalizeCarrierScan(value), value.trim().toUpperCase());
  for (const value of ['', null, {}, '2995', 'C001', '9786263293786', '/SHORT', '/TOOLONG8', '/AB_1234', 'https://example.com/?carrier=/AB12345'])
    assert.equal(normalizeCarrierScan(value), null);
});

test('Actual shipped decoder reads carrier Code 39 bars with slash and every supported punctuation', () => {
  const scope = {window:{BigInt}, performance};
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync('public/barcode-decoder-v2.js', 'utf8'), scope);
  const {BrowserMultiFormatReader, DecodeHintType, BarcodeFormat} = scope.POSBarcodeDecoder;
  for (const carrier of ['/AB12345', '/AB+12-.']) {
    const bits = code39Bits(carrier), width = bits.length * 3, height = 120;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
      const offset=(y*width+x)*4, value=y>=10&&y<110&&bits[Math.floor(x/3)]==='1'?0:255;
      data[offset]=data[offset+1]=data[offset+2]=value;data[offset+3]=255;
    }
    const canvas={width,height,getContext:()=>({getImageData:()=>({data})})};
    const reader=new BrowserMultiFormatReader(new Map([[DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.CODE_39]]]));
    assert.equal(reader.decodeFromCanvas(canvas).getText(),carrier);
  }
});
