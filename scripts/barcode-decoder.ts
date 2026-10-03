export { BrowserMultiFormatReader } from '@zxing/browser';
export { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { MultiFormatOneDReader, BitArray } from '@zxing/library';
import { localBarcodeRow, glareScanRows } from '../lib/glare-scan.mjs';

export function createGlareReader(hints: Map<any, any>) {
  const reader = new MultiFormatOneDReader(hints);
  const progress = new Map<string, {cursor: number; phase: number}>();
  return {
    decodeFromCanvas(canvas: HTMLCanvasElement) {
      const started = performance.now();
      const width = canvas.width, height = canvas.height;
      const key = width + 'x' + height;
      if (!progress.has(key)) {
        if (progress.size >= 8) progress.delete(progress.keys().next().value!);
        progress.set(key, {cursor:0, phase:0});
      }
      const state = progress.get(key)!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx || !width || !height) throw Error('No frame');
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const luminance = new Uint8Array(width);
      const row = new BitArray(width);
      const rows = glareScanRows(height, state.phase);
      for (let n = 0; n < rows.length; n++) {
        const y = rows[state.cursor++];
        if (state.cursor >= rows.length) { state.cursor = 0; state.phase++; }
        for (let x = 0; x < width; x++) {
          const p = (y * width + x) * 4;
          luminance[x] = (pixels[p] + pixels[p + 1] * 2 + pixels[p + 2]) >> 2;
        }
        for (const radius of [24, 64]) {
          const black = localBarcodeRow(luminance, radius);
          row.clear();
          for (let x = 0; x < width; x++) if (black[x]) row.set(x);
          for (let reversed = 0; reversed < 2; reversed++) {
            if (reversed) row.reverse();
            try { return reader.decodeRow(y, row, hints); } catch {}
          }
          // Bounded extra work keeps the preview and continuous scanning live.
          if (performance.now() - started >= 22) throw Error('No barcode in scan budget');
        }
      }
      throw Error('No barcode');
    },
  };
}
