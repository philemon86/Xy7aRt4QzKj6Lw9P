import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { configureScanTrack, exposureRange, exposureValue } from '../lib/glare-scan.mjs';

const scope = { window: { BigInt }, performance };
vm.createContext(scope);
vm.runInContext(fs.readFileSync('public/barcode-decoder-v2.js', 'utf8'), scope);
const { createGlareReader, BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = scope.POSBarcodeDecoder;
const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]]]);
const digits = '4006381333931';
const patterns = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const invert = bits => [...bits].map(bit => bit === '0' ? '1' : '0').join('');
let bits = '101';
for (let i = 1; i < 7; i++) {
  const pattern = patterns[Number(digits[i])];
  bits += 'LGLLGG'[i - 1] === 'L' ? pattern : [...invert(pattern)].reverse().join('');
}
bits += '01010';
for (let i = 7; i < 13; i++) bits += invert(patterns[Number(digits[i])]);
bits += '101';

function fixture(kind, reversed = false) {
  const width = 460, height = 180;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const column = reversed ? width - x - 1 : x;
    const index = Math.floor((column - 40) / 4);
    const bar = y >= 20 && y < 160 && index >= 0 && index < bits.length && bits[index] === '1';
    let value = bar ? 20 : 245;
    if (kind === 'gradient') value = bar ? 25 + column * 0.46 : Math.min(255, 112 + column * 0.38);
    if (kind === 'glare-band' && y >= 24 && y < 148) value = 255;
    if (kind === 'blank' || kind === 'washed-out') value = 255;
    const offset = (y * width + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  const image = { data };
  return { width, height, getContext: () => ({getImageData: () => image}) };
}

test('Actual shipped glare decoder reads clean, unevenly lit, reflected-center and reversed EAN barcodes', () => {
  for (const kind of ['clean', 'gradient', 'glare-band']) for (const reversed of [false, true]) {
    const reader = createGlareReader(hints);
    let result;
    // The decoder intentionally stops at its frame budget and interleaves rows.
    for (let i = 0; i < 10 && !result; i++) {
      try { result = reader.decodeFromCanvas(fixture(kind, reversed)).getText(); } catch {}
    }
    assert.equal(result, digits, kind + (reversed ? ' reversed' : ''));
  }
  assert.equal(typeof BrowserMultiFormatReader, 'function');
});

test('A blank or completely washed-out label never invents a barcode', () => {
  for (const kind of ['blank', 'washed-out']) {
    const reader = createGlareReader(hints);
    for (let i = 0; i < 3; i++) assert.throws(() => reader.decodeFromCanvas(fixture(kind)));
  }
});

test('Uneven reflection that defeats the existing global threshold is decoded with a local threshold', () => {
  const image = fixture('gradient');
  const original = new BrowserMultiFormatReader(hints);
  assert.throws(() => original.decodeFromCanvas(image));
  assert.equal(createGlareReader(hints).decodeFromCanvas(image).getText(), digits);
});

test('A busy frame budget resumes on the next scan line rather than starving clear edges', () => {
  const oldClock = scope.performance;
  let time = 0;
  scope.performance = {now: () => time += 30};
  try {
    const reader = createGlareReader(hints), image = fixture('glare-band');
    let actual;
    for (let frame = 0; frame < 60 && !actual; frame++) {
      try { actual = reader.decodeFromCanvas(image).getText(); } catch {}
    }
    assert.equal(actual, digits);
  } finally { scope.performance = oldClock; }
});

test('Unsupported camera controls remain optional; exposure rejection cannot block focus, white balance or torch-off', async () => {
  const controls = [];
  const track = {
    getCapabilities: () => ({focusMode:['continuous'], exposureMode:['continuous'], whiteBalanceMode:['continuous'], torch:true}),
    applyConstraints: async constraint => {
      controls.push(constraint.advanced[0]);
      if ('exposureMode' in constraint.advanced[0]) throw Error('unsupported');
    },
  };
  await configureScanTrack(track);
  assert.deepEqual(controls, [{focusMode:'continuous'},{exposureMode:'continuous'},{whiteBalanceMode:'continuous'},{torch:false}]);
  await configureScanTrack({getCapabilities:()=>({}),applyConstraints:()=>assert.fail('unsupported controls must be skipped')});
});

test('Exposure UI only appears for a supported range and sends a bounded device step', () => {
  assert.equal(exposureRange({}), null);
  assert.equal(exposureRange({exposureCompensation:{min:0,max:0}}), null);
  const range = exposureRange({exposureCompensation:{min:-2,max:2,step:0.5}},{exposureCompensation:0.5});
  assert.equal(range.value, 0.5);
  assert.equal(exposureValue(range, -0.8), -1);
  assert.equal(exposureValue(range, -100), -2);
  assert.equal(exposureValue(range, 100), 2);
  assert.equal(exposureValue(range, NaN), null);
});
