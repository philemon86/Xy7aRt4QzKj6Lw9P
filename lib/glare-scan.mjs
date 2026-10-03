// A 1D scan line needs a local black point when reflections or shadows vary
// across the label. Keep constant/washed-out regions white; never invent bars.
export function localBarcodeRow(luminance, radius = 32) {
  const width = luminance.length;
  const sum = new Float64Array(width + 1);
  for (let x = 0; x < width; x++) sum[x + 1] = sum[x] + luminance[x];
  const black = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    const left = Math.max(0, x - radius);
    const right = Math.min(width, x + radius + 1);
    const mean = (sum[right] - sum[left]) / (right - left);
    black[x] = luminance[x] < mean - 5 ? 1 : 0;
  }
  return black;
}

// Interleave positions between frames so a small clean part of the barcode
// can be read without requiring the operator to align it with a fixed stripe.
export function glareScanRows(height, phase = 0, count = 48) {
  const shift = ((phase % 3) + 3) % 3 / 3;
  const rows = new Set([Math.floor(height / 2)]);
  for (let i = 0; i < count; i++) {
    const row = Math.floor((i + shift + 0.5) * height / count);
    if (row >= 0 && row < height) rows.add(row);
  }
  return [...rows].sort((a, b) => Math.abs(a - height / 2) - Math.abs(b - height / 2));
}

export function exposureRange(capabilities, settings = {}) {
  const range = capabilities?.exposureCompensation;
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min >= range.max) return null;
  const step = Number.isFinite(range.step) && range.step > 0 ? range.step : 0.1;
  const value = Number.isFinite(settings.exposureCompensation) ? settings.exposureCompensation : 0;
  return { min: range.min, max: range.max, step, value: Math.max(range.min, Math.min(range.max, value)) };
}

export function exposureValue(range, requested) {
  if (!range || !Number.isFinite(requested)) return null;
  const steps = Math.round((requested - range.min) / range.step);
  return Number(Math.max(range.min, Math.min(range.max, range.min + steps * range.step)).toFixed(4));
}

export async function configureScanTrack(track) {
  let capabilities = {};
  try { capabilities = track.getCapabilities?.() || {}; } catch {}
  // One rejected optional control must not prevent the remaining controls.
  for (const key of ['focusMode', 'exposureMode', 'whiteBalanceMode']) {
    if (!capabilities[key]?.includes?.('continuous')) continue;
    try { await track.applyConstraints({ advanced: [{ [key]: 'continuous' }] }); } catch {}
  }
  if (capabilities.torch) {
    try { await track.applyConstraints({ advanced: [{ torch: false }] }); } catch {}
  }
  return capabilities;
}
