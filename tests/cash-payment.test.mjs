import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { suggestCashAmount, culturalCoinPayment } from '../lib/pos-core.mjs';
import { requiresChurchCustomer } from '../lib/invoice-customers.mjs';
test('Tendered cash follows denomination boundaries and rounds above 1000 to five hundred', () => {
  for (const [total, expected] of [
    [0, 0],
    [-100, 0],
    [13, 100],
    [100, 100],
    [101, 500],
    [500, 500],
    [501, 1000],
    [1000, 1000],
    [1001, 1500],
    [1500, 1500],
    [1501, 2000],
    [2000, 2000],
    [2001, 2500],
    [2500, 2500],
    [2501, 3000],
    [3435, 3500],
  ])
    assert.equal(suggestCashAmount(total), expected);
});

test('Donation completion returns to amounts without jumping while an arbitrary code is incomplete', () => {
  const script = fs.readFileSync('scripts/register-cash.js', 'utf8');
  let jumps = 0,
    church = null;
  const field = () => ({ value: '', addEventListener() {} });
  const context = {
    clearTimeout() {},
    setTimeout(fn) {
      fn();
      return 1;
    },
    returnToCheckoutSummary() {
      jumps++;
    },
    POSCore: { requiresChurchCustomer },
    getSelectedBookFairCustomer: () => church,
    invoiceTaxIdInput: field(),
    invoiceDonateCarrierInput: field(),
    invoiceCustomerInput: field(),
    document: { activeElement: null },
  };
  vm.createContext(context);
  vm.runInContext(
    script.slice(script.indexOf('let invoiceScrollTimer;')) +
      '\nglobalThis.finish=finishInvoiceEntry;',
    context,
  );
  context.invoiceDonateCarrierInput.value = '299';
  context.finish({ type: 'input' });
  assert.equal(jumps, 0);
  context.invoiceDonateCarrierInput.value = '2995';
  context.finish({ type: 'input' });
  assert.equal(jumps, 1);
  context.invoiceDonateCarrierInput.value = '12345';
  context.finish({ type: 'input' });
  assert.equal(jumps, 1);
  context.finish({ key: 'Enter' });
  assert.equal(jumps, 2);
  context.finish({ type: 'blur' });
  assert.equal(jumps, 3);
  context.invoiceTaxIdInput.value = '52399254';
  context.finish({ type: 'change' });
  assert.equal(jumps, 3);
  church = { code: 'AA01' };
  context.finish({ type: 'change' });
  assert.equal(jumps, 4);
});
test('Culture split payments balance and church payment options reject credit', () => {
  for (const method of ['現金', 'LINE PAY', '信用卡'])
    assert.equal(
      culturalCoinPayment(899, 400, method, 'admin'),
      `文化幣(400) + ${method}(499)`,
    );
  assert.equal(culturalCoinPayment(899, 899, '', 'church'), '文化幣(899)');
  assert.equal(culturalCoinPayment(899, 0, '現金', 'church'), '現金(899)');
  for (const value of [-1, 900, 0.5, NaN])
    assert.throws(() => culturalCoinPayment(899, value, '現金', 'admin'));
  assert.throws(() => culturalCoinPayment(899, 400, '信用卡', 'church'));
});
test('Cash suggestions update until manual entry, restore that choice and reset after clearing', () => {
  const source = fs
    .readFileSync('scripts/register-cash.js', 'utf8')
    .split('// Let the containing workspace scroll')[0];
  for (const restored of [null, { 'paid-amount': '5000', cashAuto: false }]) {
    const handlers = {};
    const context = {
      POSCore: { suggestCashAmount },
      cart: [{}],
      paidAmountInput: {
        value: restored?.['paid-amount'] || '',
        addEventListener: (type, fn) => (handlers[type] = fn),
      },
      localStorage: { getItem: () => JSON.stringify(restored) },
      saveCheckoutFields() {},
      calculateCartTotal: () => 135,
      calculateChange() {},
    };
    vm.createContext(context);
    vm.runInContext(
      source + '\nglobalThis.update=updateCashSuggestion;',
      context,
    );
    context.update(135);
    assert.equal(Number(context.paidAmountInput.value), restored ? 5000 : 500);
    context.paidAmountInput.value = '1000';
    handlers.input();
    context.update(550);
    assert.equal(context.paidAmountInput.value, '1000');
    context.cart = [];
    context.update(0);
    assert.equal(Number(context.paidAmountInput.value), 0);
    context.cart = [{}];
    context.update(89);
    assert.equal(Number(context.paidAmountInput.value), 100);
  }
});
