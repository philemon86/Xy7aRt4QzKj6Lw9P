// One destination for the next sale; the outer page owns scrolling the full cart.
const SEARCH_IDLE_MS = 30000;
let searchIdleTimer, searchComposing = false;
const canReturnToProductSearch = () => {
  if (document.hidden || document.body.dataset.view !== 'checkout' ||
      ['checking', 'saving', 'failed'].includes(document.body.dataset.checkout) ||
      document.querySelector('dialog[open], [role="dialog"], .retry-cover')) return false;
  // Camera and workspace editors live outside the register iframe.
  if (parent !== window && parent.document.querySelector('dialog[open], [role="dialog"]')) return false;
  return !searchComposing;
};
const returnToProductSearch = () => {
  if (!canReturnToProductSearch()) return false;
  productCodeInput.focus({ preventScroll: true });
  const top = Math.max(0, productCodeInput.getBoundingClientRect().top + window.scrollY - 40);
  if (parent !== window) parent.postMessage({ type: 'checkout-search', top }, location.origin);
  else window.scrollTo({ top, behavior: 'auto' });
  return true;
};
const resetSearchIdle = () => {
  clearTimeout(searchIdleTimer);
  searchIdleTimer = setTimeout(() => {
    if (!returnToProductSearch()) resetSearchIdle();
  }, SEARCH_IDLE_MS);
};
for (const target of parent === window ? [document] : [document, parent.document]) {
  for (const type of ['pointerdown', 'keydown', 'input', 'wheel', 'scroll'])
    target.addEventListener(type, resetSearchIdle, { capture: true, passive: true });
}
document.addEventListener('compositionstart', () => { searchComposing = true; resetSearchIdle(); });
document.addEventListener('compositionend', () => { searchComposing = false; resetSearchIdle(); });
document.addEventListener('pos-checkout-focus', () => { returnToProductSearch(); resetSearchIdle(); });
document.addEventListener('visibilitychange', resetSearchIdle);
window.addEventListener('pagehide', () => {
  clearTimeout(searchIdleTimer);
  if (parent !== window)
    for (const type of ['pointerdown', 'keydown', 'input', 'wheel', 'scroll'])
      parent.document.removeEventListener(type, resetSearchIdle, true);
});
resetSearchIdle();
