// Alternate a small full frame with detailed overlapping regions. Every part
// of the preview is covered; users do not have to line up a scan stripe.
export function scanFrame(width, height, pass = 0) {
  const mode = pass % 6;
  const region = mode <= 2;
  const sourceHeight = region ? Math.ceil(height / 2) : height;
  const y = mode === 0 ? Math.round((height-sourceHeight)/2) : mode === 2 ? height-sourceHeight : 0;
  const max = mode === 1 || mode === 2 || mode === 4 ? 1920 : 1280;
  const scale = Math.min(1, max / Math.max(width, sourceHeight));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(sourceHeight * scale));
  return { x: 0, y, sourceWidth: width, sourceHeight, width: w, height: h, rotate: mode === 3, tryHarder: mode === 4 };
}

export function captureScanFrame(canvas, source, width, height, pass = 0) {
  const f = scanFrame(width, height, pass);
  canvas.width = f.rotate ? f.height : f.width;
  canvas.height = f.rotate ? f.width : f.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw Error('此瀏覽器無法建立條碼辨識畫面');
  ctx.imageSmoothingEnabled = false;
  if (f.rotate) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(source, f.x, f.y, f.sourceWidth, f.sourceHeight, 0, 0, f.width, f.height);
  return canvas;
}

// Native support does not guarantee a result. A native miss must also try
// ZXing, rather than permanently selecting a detector that cannot read it.
export async function decodeScanFrame(canvas, native, reader) {
  if (native) {
    try {
      const result = (await native.detect(canvas)).find(r => r.rawValue);
      if (result) return result.rawValue;
    } catch {}
  }
  if (reader) {
    try { return reader.decodeFromCanvas(canvas).getText(); } catch {}
  }
  return null;
}
