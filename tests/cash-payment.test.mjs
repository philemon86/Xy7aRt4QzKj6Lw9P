import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { suggestCashAmount, culturalCoinPayment } from '../lib/pos-core.mjs';
test('Tendered cash follows denomination boundaries and rounds above 1000 to a thousand', () => {
  for (const [total, expected] of [
    [0, 0],
    [-100, 0],
    [13, 100],
    [100, 100],
    [101, 500],
    [500, 500],
    [501, 1000],
    [1000, 1000],
    [1001, 2000],
    [2000, 2000],
    [2001, 3000],
    [3435, 4000],
  ])
    assert.equal(suggestCashAmount(total), expected);
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
