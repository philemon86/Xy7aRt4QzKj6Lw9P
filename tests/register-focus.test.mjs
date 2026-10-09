import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture() {
  let now = 0, id = 0, focused = 0, modal = false;
  const timers = new Map(), handlers = {}, parentHandlers = {}, messages = [];
  const document = { hidden: false, body: { dataset: { view: 'checkout', checkout: 'idle' } },
    querySelector: () => modal, addEventListener: (type, fn) => { handlers[type] = fn; } };
  const parent = { document: { querySelector: () => modal,
    addEventListener: (type, fn) => { parentHandlers[type] = fn; },
    removeEventListener: type => { delete parentHandlers[type]; } },
    postMessage: value => messages.push(value) };
  const context = { document, parent, window: { scrollY: 0, addEventListener: (type, fn) => { handlers[type] = fn; } },
    location: { origin: 'https://fixture.test' },
    productCodeInput: { value: 'keep my search', focus: () => focused++, getBoundingClientRect: () => ({ top: 400 }) },
    clearTimeout: key => timers.delete(key),
    setTimeout: (fn, delay) => { timers.set(++id, { fn, at: now + delay }); return id; } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('scripts/register-focus.js', 'utf8'), context);
  return { context, handlers, messages, parentHandlers,
    set modal(value) { modal = value; }, get focused() { return focused; },
    tick(ms) { now += ms; for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.fn(); } } };
}
test('Idle return waits 30 seconds after the last input and retains input text', () => {
  const x = fixture();
  x.tick(29999); assert.equal(x.focused, 0);
  x.handlers.input(); x.tick(29999); assert.equal(x.focused, 0);
  x.tick(1); assert.equal(x.focused, 1);
  assert.equal(x.messages[0].type, 'checkout-search');
  assert.equal(x.messages[0].top, 360);
  assert.equal(x.context.productCodeInput.value, 'keep my search');
});
test('Idle never interrupts dialogs, pending checkout, another tab, composition or hidden pages', () => {
  for (const block of ['dialog', 'saving', 'history', 'composition', 'hidden']) {
    const x = fixture();
    if (block === 'dialog') x.modal = true;
    if (block === 'saving') x.context.document.body.dataset.checkout = 'saving';
    if (block === 'history') x.context.document.body.dataset.view = 'history';
    if (block === 'composition') x.handlers.compositionstart();
    if (block === 'hidden') x.context.document.hidden = true;
    x.tick(30000); assert.equal(x.focused, 0, block);
    x.modal = false; x.context.document.hidden = false;
    x.context.document.body.dataset = { view: 'checkout', checkout: 'saved' };
    x.handlers.compositionend();
    x.tick(30000); assert.equal(x.focused, 1, block);
  }
});
test('Reclicking checkout returns immediately and unloading removes parent listeners', () => {
  const x = fixture();
  x.handlers['pos-checkout-focus'](); x.handlers['pos-checkout-focus']();
  assert.equal(x.focused, 2);
  x.handlers.pagehide();
  assert.equal(Object.keys(x.parentHandlers).length, 0);
  x.tick(30000); assert.equal(x.focused, 2);
});
