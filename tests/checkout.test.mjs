import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import {
  requiresChurchCustomer,
  invoiceCustomerCode,
} from '../lib/invoice-customers.mjs';
const Pilot = createRequire(import.meta.url)('../legacy/pilot-exporter.cjs');
const html = fs.readFileSync('public/register.html', 'utf8');
const start = html.indexOf('      let checkoutBusy=false'),
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
    pricedCart: () => context.cart,
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
    POSCore: { requiresChurchCustomer, invoiceCustomerCode },
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
      ensureSession: async () => {},
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
    resetCashSuggestion: no,
    syncInvoiceCustomerVisibility: no,
    saveCheckoutFields: no,
    productInfoElement: {},
    alert: no,
    document: {
      createElement: (tag) => {
        const el = { append: no, textContent: '' };
        if (tag === 'button') buttons.push(el);
        return el;
      },
      body: { append: no, dataset: {} },
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
test('Expired authorization preserves the cart and creates no payment or order', async () => {
  const x = make();
  x.context.cloud.ensureSession = async () => {
    throw Error('登入已到期');
  };
  await x.checkout('現金');
  assert.equal(x.context.cart.length, 1);
  assert.equal(Object.keys(x.context.clients).length, 0);
  assert.equal(Object.keys(x.saved).length, 0);
  assert.equal(x.prints, 0);
});
test('Repeated payment clicks during authorization check create one order', async () => {
  const x = make();
  const button = { disabled: false };
  x.context.checkoutBtns.push(button);
  let release;
  x.context.cloud.ensureSession = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const first = x.checkout('現金');
  assert.equal(button.disabled, true);
  assert.equal(x.context.document.body.dataset.checkout, 'checking');
  await x.checkout('現金');
  release();
  await first;
  assert.equal(Object.keys(x.saved).length, 1);
  assert.equal(button.disabled, false);
});
test('No carrier or tax ID is always a book-fair sale even with a selected church or donation', async () => {
  for (const invoiceInfo of [
    {},
    { donationCode: '2995' },
    { donationCode: '12345' },
  ]) {
    const x = make();
    x.context.getInvoiceInfoFromInputs = () => invoiceInfo;
    x.context.getSelectedBookFairCustomer = () => ({
      code: 'AA01',
      name: '台北教會',
    });
    await x.checkout('現金');
    assert.equal(Object.values(x.saved)[0].accountingCustomer.code, '0002');
  }
});
test('Refund, zero amount, and cultural coin composite retain legacy payments', async () => {
  for (const [amount, quantity, method, total] of [
    [100, -2, '信用卡', -200],
    [0, 1, '現金', 0],
    [100, 1, '文化幣(30) + 現金(70)', 100],
    [100, 1, '文化幣(30) + 信用卡(70)', 100],
    [100, 1, '文化幣(30) + LINE PAY(70)', 100],
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

test('Mixed culture/cash saves the cash tendered independently of the full order amount', async () => {
  const x = make({ amount: 899 });
  await x.checkout('文化幣(400) + 現金(499)', true, 500);
  const order = Object.values(x.saved)[0];
  assert.equal(order.tenderedAmount, 500);
  assert.deepEqual(
    order.paymentRecords.map((p) => [p.method, p.amount]),
    [
      ['文化幣', 400],
      ['現金', 499],
    ],
  );
});
test('Other tax IDs save as personal customer 305, retaining the tax ID and ignoring an old church selection', async () => {
  for (const customer of [null, { code: 'AA01', name: '台北教會' }]) {
    const x = make();
    x.context.getInvoiceInfoFromInputs = () => ({
      taxId: '12345678',
      carrier: '',
      donationCode: '',
    });
    x.context.getSelectedBookFairCustomer = () => customer;
    await x.checkout('信用卡');
    const o = Object.values(x.saved)[0];
    assert.equal(o.accountingCustomer.code, '305');
    assert.equal(o.invoiceInfo.taxId, '12345678');
    assert.equal(o.bookFairCustomerCode, '');
    assert.equal(o.amount, 899);
  }
});
test('52399254 requires a church and saves that church once selected', async () => {
  const x = make();
  x.context.getInvoiceInfoFromInputs = () => ({ taxId: '52399254' });
  await x.checkout('現金');
  assert.equal(Object.keys(x.saved).length, 0);
  assert.equal(x.context.cart.length, 1);
  x.context.getSelectedBookFairCustomer = () => ({
    code: 'AA01',
    name: '台北教會',
  });
  await x.checkout('現金');
  const o = Object.values(x.saved)[0];
  assert.equal(o.accountingCustomer.code, 'AA01');
  assert.equal(o.bookFairCustomerCode, 'AA01');
  assert.equal(o.invoiceInfo.taxId, '52399254');
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

test('background synchronization errors cannot block another cashier sale', async () => {
  const fixture = make();
  fixture.context.cloud.offlineSyncError = '這筆資料已被另一台裝置修改';
  await fixture.checkout('現金');
  assert.equal(Object.values(fixture.saved).length, 1);
  assert.equal(Object.values(fixture.saved)[0].amount, 899);
});
