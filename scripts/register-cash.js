// Automatic suggestions stop after a cashier enters an amount, and survive reload.
const savedCashFields =
  JSON.parse(localStorage.getItem('checkoutFields') || '{}') || {};
let cashAuto =
  savedCashFields.cashAuto ??
  (!savedCashFields['paid-amount'] ||
    savedCashFields['paid-amount'] === '1000');
const updateCashSuggestion = (total) => {
  if (!cart.length) cashAuto = true;
  if (cashAuto || total <= 0)
    paidAmountInput.value =
      total < 0 ? total : POSCore.suggestCashAmount(total);
  saveCheckoutFields();
};
paidAmountInput.addEventListener('input', () => {
  cashAuto = false;
  saveCheckoutFields();
});
const resetCashSuggestion = () => {
  cashAuto = true;
  updateCashSuggestion(calculateCartTotal(cart));
  calculateChange();
};

// Let the containing workspace scroll, preserving the fully expanded cart.
const returnToCheckoutSummary = () => {
  const summary = document.querySelector('.checkout-summary');
  if (!summary) return;
  const top = summary.getBoundingClientRect().top + window.scrollY;
  if (parent !== window)
    parent.postMessage({ type: 'checkout-summary', top }, location.origin);
  else window.scrollTo({ top: Math.max(0, top - 16), behavior: 'auto' });
};
let invoiceScrollTimer;
const finishInvoiceEntry = () => {
  clearTimeout(invoiceScrollTimer);
  const taxId = invoiceTaxIdInput.value.trim();
  const carrier = invoiceDonateCarrierInput.value.trim();
  if (POSCore.requiresChurchCustomer(taxId) && !getSelectedBookFairCustomer())
    return;
  if (!/^\d{8}$/.test(taxId) && !/^\/[A-Z0-9+.-]{7}$/i.test(carrier)) return;
  invoiceScrollTimer = setTimeout(() => {
    if (
      [
        invoiceTaxIdInput,
        invoiceDonateCarrierInput,
        invoiceCustomerInput,
      ].includes(document.activeElement)
    )
      document.activeElement.blur();
    clearTimeout(invoiceScrollTimer);
    returnToCheckoutSummary();
  }, 180);
};
for (const field of [
  invoiceTaxIdInput,
  invoiceDonateCarrierInput,
  invoiceCustomerInput,
]) {
  field.addEventListener('input', finishInvoiceEntry);
  field.addEventListener('change', finishInvoiceEntry);
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finishInvoiceEntry();
    }
  });
}
