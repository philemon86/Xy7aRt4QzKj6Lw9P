// Shared checkout markup: bookstore fairs and church self-checkout use this
// same field, draft storage and invoice-customer rules.
const carrierControl = document.createElement('div');
carrierControl.className = 'invoice-carrier-input';
invoiceDonateCarrierInput.before(carrierControl);
carrierControl.append(invoiceDonateCarrierInput);
const carrierCamera = document.createElement('button');
carrierCamera.id = 'scan-carrier-btn';
carrierCamera.type = 'button';
carrierCamera.title = '相機掃描載具';
carrierCamera.setAttribute('aria-label', '相機掃描載具');
carrierCamera.setAttribute('aria-haspopup', 'dialog');
carrierCamera.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5z"/><circle cx="12" cy="13" r="4"/></svg>';
carrierCamera.onclick = () => {
  if (cloud.event.status !== 'open') return;
  cloud.unlockAudio();
  parent.postMessage({ type: 'open-camera', target: 'carrier' }, location.origin);
};
carrierControl.append(carrierCamera);
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== parent ||
      event.data?.type !== 'carrier-scan' || cloud.event.status !== 'open') return;
  const carrier = POSCore.normalizeCarrierScan(event.data.code);
  if (!carrier) return;
  invoiceDonateCarrierInput.value = carrier;
  // Use the manual-entry path to clear a previous tax ID, select personal
  // customer, save this device's draft and return focus to product scanning.
  invoiceDonateCarrierInput.dispatchEvent(new Event('input', { bubbles: true }));
  invoiceDonateCarrierInput.dispatchEvent(new Event('change', { bubbles: true }));
});
