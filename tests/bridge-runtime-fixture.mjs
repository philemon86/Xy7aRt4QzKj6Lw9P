// Bridge-only tests keep their deterministic network adapter. Offline queue/DB
// behavior is exercised separately by offline.test.mjs and offline-browser.mjs.
export function attachBridgeRuntime(context) {
  context.window.parent = context.parent;
  context.window.POSOfflineModule = { getOfflineRuntime: () => ({
    request: async (portal, path, body) => {
      const response = await context.fetch('/pos/api/' + path, body === undefined
        ? { headers: { 'X-POS-Portal': portal } }
        : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-POS-Portal': portal }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw Object.assign(Error(result.error || '連線失敗'), { status: response.status });
      return result;
    },
    summary: async () => ({ pending: 0, pendingEvents: 0, offline: false, error: '' }),
    key: (portal, id) => portal + ':' + id,
    store: { get: async () => undefined },
  }) };
}
