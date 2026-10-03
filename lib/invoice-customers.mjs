export const CHURCH_TAX_ID = '52399254';

export function requiresChurchCustomer(taxId) {
  return String(taxId || '').trim() === CHURCH_TAX_ID;
}

export function invoiceCustomerCode(invoice = {}, churchCode = '') {
  if (requiresChurchCustomer(invoice.taxId)) return churchCode;
  return String(invoice.taxId || '').trim() ||
    String(invoice.carrier || '').trim()
    ? '305'
    : '0002';
}
