import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('scripts/register-bulk.js', 'utf8');
function fixture(storage = new Map()) {
  const element = (value = '') => ({ value, textContent: '', disabled: false, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, setAttribute() {}, focus() {} });
  let fail = false, hold;
  const toList = element();
  const context = {
    bulkInput: element(), bulkBackupBtn: element(), bulkClearBtn: element(), bulkResult: element(),
    document: { getElementById: () => toList },
    localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    checkoutBusy: false, checkoutChecking: false, checkoutBtns: [element(), element()], isBookstore: true,
    cart: [], products: { C001: { code: 'C001', price: 100, defaultDiscount: 79 }, C002: { code: 'C002', price: 50, defaultDiscount: 100 } },
    updateCartDisplay() {}, calculateTotal() {},
    saveCart() { storage.set('cart', JSON.stringify(context.cart)); },
    cloud: { event: { status: 'open', organizer: 'bookstore' }, async flush() { if (hold) await hold; if (fail) throw Error('storage unavailable'); } },
    addProductWithQuantity(code, qty) {
      const product = context.products[code]; if (!product) return false;
      const item = context.cart.find((i) => i.code === product.code);
      if (item) item.quantity += qty; else context.cart.push({ ...product, quantity: qty, discount: product.defaultDiscount });
      return true;
    },
  };
  context.products['4712345678900'] = context.products.C001;
  vm.runInNewContext(source, context);
  return { context, storage, toList: () => toList.handlers.click(), fill: (text) => { context.bulkInput.value = text; context.bulkInput.handlers.input(); }, click: () => context.bulkBackupBtn.handlers.click(), set fail(v) { fail = v; }, set hold(v) { hold = v; } };
}
test('回填 sends batch lines into cart, retaining existing edited price/discount and avoiding repeated input', async () => {
  const f = fixture(), c = f.context;
  c.cart.push({ code: 'C001', price: 88, discount: 90, isManual: true, quantity: 1 });
  f.fill('C001,2\n3*C002\n4712345678900*1'); await f.click();
  assert.equal(c.cart[0].quantity, 4); assert.equal(c.cart[0].price, 88); assert.equal(c.cart[0].discount, 90);
  assert.equal(c.cart[1].quantity, 3); assert.equal(c.bulkInput.value, '');
  assert.match(c.bulkResult.textContent, /已回填 3 筆/);
  await f.click(); assert.equal(c.cart[0].quantity, 4); assert.match(c.bulkResult.textContent, /請先輸入/);
  assert.equal(JSON.parse(f.storage.get('cart')).length, 2);
});
test('partial failures keep unknown/invalid lines visible and report their line numbers', async () => {
  const f = fixture(), c = f.context;
  f.fill('C001，2\nBAD,1\nC002,1.5\nC002,0'); await f.click();
  assert.equal(c.cart.length, 1); assert.equal(c.cart[0].quantity, 2);
  assert.equal(c.bulkInput.value, 'BAD,1\nC002,1.5\nC002,0');
  assert.match(c.bulkResult.textContent, /第 2 行 BAD：找不到商品/);
  assert.match(c.bulkResult.textContent, /第 3 行/);
});
test('empty cart is not a reason to ignore batch refill; empty input gives visible guidance', async () => {
  const f = fixture(); await f.click(); assert.match(f.context.bulkResult.textContent, /請先輸入/);
  f.fill('C001'); await f.click(); assert.equal(f.context.cart[0].quantity, 1);
});
test('failed device commit retries saving the same cart rather than adding the same items again', async () => {
  const f = fixture(); f.fail = true; f.fill('C001,2'); await f.click();
  assert.equal(f.context.bulkBackupBtn.textContent, '重試保存'); assert.equal(f.context.cart[0].quantity, 2);
  f.fail = false; await f.click(); assert.equal(f.context.cart[0].quantity, 2); assert.match(f.context.bulkResult.textContent, /已回填/);
});
test('rapid repeated clicks while committing do not duplicate quantity', async () => {
  const f = fixture(); let release; f.hold = new Promise((resolve) => { release = resolve; });
  f.fill('C001,2'); const pending = f.click(); await f.click();
  assert.equal(f.context.cart[0].quantity, 2); assert.equal(f.context.checkoutChecking, true);
  release(); await pending; assert.equal(f.context.checkoutChecking, false);
});
test('readonly fairs and quantity bounds cannot mutate the cart', async () => {
  const f = fixture(); f.fill('C001,100001'); await f.click(); assert.equal(f.context.cart.length, 0);
  f.fill('C001,2'); f.context.cloud.event.status = 'archived'; await f.click(); assert.equal(f.context.cart.length, 0);
  assert.match(f.context.bulkResult.textContent, /僅供查看/);
});
test('clearing batch input preserves the cart and persists the cleared text separately', async () => {
  const f = fixture(); f.fill('C001,2'); await f.click(); f.fill('C002,3');
  f.context.bulkClearBtn.handlers.click(); assert.equal(f.context.cart[0].quantity, 2);
  assert.equal(f.storage.get('bulkInput'), '');
});

test('cart to list and back survives reload, retaining edited unit price, discount, refunds and existing input', async () => {
  const f=fixture(), c=f.context;
  const moved=[{code:'C001',price:88,discount:79.5,isManual:true,quantity:2},{code:'C002',price:50,discount:100,quantity:-1}];
  c.cart=structuredClone(moved); f.fill('BAD,1'); await f.toList();
  assert.equal(c.cart.length,0); assert.equal(c.bulkInput.value,'BAD,1\nC001,2\nC002,-1');
  assert.equal(JSON.parse(f.storage.get('cart')).length,0);
  const restored=fixture(f.storage); await restored.click();
  assert.deepEqual(JSON.parse(JSON.stringify(restored.context.cart)).map(({code,price,discount,isManual,quantity})=>({code,price,discount,isManual,quantity})),moved.map(({code,price,discount,isManual,quantity})=>({code,price,discount,isManual,quantity})));
  assert.equal(restored.context.bulkInput.value,'BAD,1');
  await restored.click(); assert.equal(restored.context.cart[0].quantity,2);
});

test('cart to list retry and repeated clicks never lose or duplicate moved rows; archived fairs remain readonly', async () => {
  const f=fixture(); f.context.cart=[{code:'C001',price:88,discount:90,quantity:2,isManual:true}];
  f.fail=true; await f.toList(); assert.equal(f.context.bulkInput.value,'C001,2');
  f.fail=false; await f.toList(); assert.equal(f.context.bulkInput.value,'C001,2');
  await f.toList(); assert.match(f.context.bulkResult.textContent,/沒有商品/);
  await f.click(); assert.equal(f.context.cart[0].quantity,2);
  f.context.cloud.event.status='archived'; await f.toList(); assert.equal(f.context.cart[0].quantity,2);
});
