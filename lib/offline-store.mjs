// One atomic record holds both the downloaded event and its pending changes.
// A successful write means the register may clear its cart, even without a network.
export function indexedStore() {
  let opened;
  function db() {
    return opened ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('philemon-pos-offline', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records').createIndex('kindPortal', ['kind', 'portal']);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(Error('裝置資料庫無法開啟；請勿清除購物車，檢查瀏覽器儲存權限。'));
      request.onblocked = () => reject(Error('裝置資料庫被其他分頁占用，請關閉舊分頁後重試。'));
    });
  }
  async function operation(mode, action) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('records', mode, { durability: 'strict' });
      let value;
      action(transaction.objectStore('records'), (result) => { value = result; });
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = transaction.onabort = () => reject(Error('無法保存到裝置；請保留畫面並檢查儲存空間。'));
    });
  }
  return {
    get: (key) => operation('readonly', (s, done) => { s.get(key).onsuccess = (e) => done(e.target.result); }),
    put: (key, value) => operation('readwrite', (s) => s.put(value, key)),
    all: (kind, portal) => operation('readonly', (s, done) => {
      const request = kind ? s.index('kindPortal').getAll(IDBKeyRange.only([kind, portal])) : s.getAll();
      request.onsuccess = (e) => done(e.target.result);
    }),
  };
}
