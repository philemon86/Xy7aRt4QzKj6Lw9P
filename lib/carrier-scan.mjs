// Camera results are stricter than manual invoice entry. Never write a product
// barcode, donation code or arbitrary scanned text into the mobile carrier field.
export function normalizeCarrierScan(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^\/[A-Z0-9+.-]{7}$/.test(code) ? code : null;
}
