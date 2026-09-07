import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const Pilot = createRequire(import.meta.url)('../legacy/pilot-exporter.cjs');
const html = fs.readFileSync('public/register.html', 'utf8');
const start = html.indexOf('      let checkoutBusy=false;'),
  end = html.indexOf("      btnF7.addEventListener('click'", start);
const source =
  html.slice(start, end) + '\nglobalThis.checkout=performCheckout;';
function make({ amount = 899, quantity = 1, fail = false } = {}) {
  let saved = {},
    reloads = 0,
    prints = 0;
  const mem = {};
  const no = () => {},
    input = () => ({ value: '', focus: no });
  const buttons = [];
  const context = {
    isBookstore: true,
    cart: [
      { code: 'C296', name: '見證集', price: amount, quantity, discount: 100 },
    ],
    clients: {},
    clientCounter: 1,
    overallSummary: {},
    priceOverrides: {},
    hasShownEmptyCartAlert: false,
    checkoutBtns: [],
    btnF7: {},
    btnF8: {},
    btnF10: {},
    triggerButtonAnimation: no,
    calculateCartTotal: (cart) =>
      Math.round(
        cart.reduce((s, i) => s + (i.price * i.quantity * i.discount) / 100, 0),
      ),
    totalAmountElement: {},
    generateClientId: () => crypto.randomUUID(),
    getInvoiceInfoFromInputs: () => ({}),
    getSelectedBookFairCustomer: () => null,
    BOOK_FAIR_CUSTOMER: { code: '0002', name: '書展' },
    getPersonalCustomer: () => ({ code: '305' }),
    POSAudio: { success: no, error: no },
    PilotExporter: Pilot,
    localStorage: {
      setItem: (k, v) => (mem[k] = v),
      removeItem: (k) => delete mem[k],
    },
    updateCartDisplay: no,
    calculateTotal: no,
    updateSummaryTable: no,
    saveSummary: () => {
      mem.clients = JSON.stringify(context.clients);
    },
    cloud: {
      event: { status: 'open' },
      flush: async () => {
        if (fail) throw Error('offline');
        saved = JSON.parse(mem.clients);
      },
    },
    printReceipt: () => prints++,
    doBackup: no,
    exportPilot: no,
    productCodeInput: input(),
    paidAmountInput: input(),
    invoiceDonateCarrierInput: input(),
    invoiceTaxIdInput: input(),
    invoiceCustomerInput: input(),
    calculateChange: no,
    syncInvoiceCustomerVisibility: no,
    alert: no,
    document: {
      createElement: (tag) => {
        const el = { append: no, textContent: '' };
        if (tag === 'button') buttons.push(el);
        return el;
      },
      body: { append: no },
    },
    location: { reload: () => reloads++ },
    Date,
    crypto,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    context,
    checkout: context.checkout,
    get saved() {
      return saved;
    },
    get mem() {
      return mem;
    },
    get prints() {
      return prints;
    },
    buttons,
    online: () => (fail = false),
    get reloads() {
      return reloads;
    },
  };
}
test('Checkout persists a full order and clears the draft before printing', async () => {
  const x = make();
  await x.checkout('現金');
  const o = Object.values(x.saved)[0];
  assert.equal(o.amount, 899);
  assert.equal(o.paymentRecords[0].amount, 899);
  assert.equal(x.context.cart.length, 0);
  assert.equal(x.prints, 1);
});
test('Refund, zero amount, and cultural coin composite retain legacy payments', async () => {
  for (const [amount, quantity, method, total] of [
    [100, -2, '信用卡', -200],
    [0, 1, '現金', 0],
    [100, 1, '文化幣(30) + 現金(70)', 100],
  ]) {
    const x = make({ amount, quantity });
    await x.checkout(method, true);
    const o = Object.values(x.saved)[0];
    assert.equal(o.amount, total);
    assert.equal(
      o.paymentRecords.reduce((s, p) => s + p.amount, 0),
      total,
    );
  }
});
test('A failed commit keeps the original order ID for retry and does not print', async () => {
  const x = make({ fail: true });
  await x.checkout('現金');
  assert.equal(Object.keys(x.saved).length, 0);
  assert.equal(x.prints, 0);
  assert.equal(x.context.cart.length, 1);
  const id = Object.keys(x.context.clients)[0];
  x.online();
  await x.buttons[0].onclick();
  assert.equal(Object.keys(x.saved).length, 1);
  assert.equal(Object.keys(x.saved)[0], id);
  assert.equal(x.reloads, 1);
  assert.equal(x.mem.cart, '[]');
});
