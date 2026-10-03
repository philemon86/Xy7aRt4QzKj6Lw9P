// Keep this URL available across deployments: a register may stay open all day.
let pending;
export function loadBarcodeDecoder(host = window, document = host.document) {
  const ready = () => typeof host.POSBarcodeDecoder?.BrowserMultiFormatReader === 'function' && typeof host.POSBarcodeDecoder?.createGlareReader === 'function';
  if (ready())
    return Promise.resolve(host.POSBarcodeDecoder);
  if (pending) return pending;
  const attempt = (retry) =>
    new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src =
        '/pos/barcode-decoder-v2.js?v=2' + (retry ? '&retry=' + Date.now() : '');
      script.async = true;
      const fail = () => {
        clearTimeout(timeout);
        script.remove();
        reject(Error('條碼辨識模組載入失敗，請檢查連線後按重試。'));
      };
      const timeout = setTimeout(fail, 15000);
      script.onerror = fail;
      script.onload = () => {
        if (!ready()) return fail();
        clearTimeout(timeout);
        resolve(host.POSBarcodeDecoder);
      };
      document.head.append(script);
    });
  pending = attempt(false)
    .catch(() => attempt(true))
    .catch((error) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
