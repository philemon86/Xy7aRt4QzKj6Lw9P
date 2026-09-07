export const CHURCH_PAYMENTS = ['文化幣', 'LINE PAY'];
export const STORE_PAYMENTS = ['現金', '信用卡', 'LINE PAY', '文化幣'];
export function taipeiDay(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw Error('交易日期錯誤');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function orderDay(order) {
  if (order.createdAt && Number.isFinite(new Date(order.createdAt).getTime()))
    return taipeiDay(order.createdAt);
  const match = String(order.id).match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : taipeiDay();
}
export function formatOrderNumber(tenant, day, sequence) {
  return (
    (tenant ? tenant.toUpperCase() : 'mon') +
    day.slice(5).replace('-', '') +
    '-' +
    String(sequence).padStart(3, '0')
  );
}
export function orderTotal(items) {
  return Math.round(
    items.reduce(
      (sum, item) =>
        sum +
        (Number(item.price) *
          Number(item.quantity) *
          Number(item.discount ?? 100)) /
          100,
      0,
    ),
  );
}
export function makePayments(amount, choice, split = Math.abs(amount)) {
  if (!amount) return [];
  const methods = choice.split(' + ');
  if (
    !methods.every((method) => STORE_PAYMENTS.includes(method)) ||
    methods.length > 2
  )
    throw Error('付款方式錯誤');
  if (methods.length === 1) return [{ method: methods[0], amount }];
  const part = Number(split);
  if (!Number.isSafeInteger(part) || part < 0 || part > Math.abs(amount))
    throw Error('文化幣金額須為 0 與訂單金額之間的整數');
  const first = Math.sign(amount) * part;
  return [
    { method: methods[0], amount: first },
    { method: methods[1], amount: amount - first },
  ].filter((p) => p.amount !== 0);
}
export function paymentLabel(payments, amount) {
  if (!amount) return '零元';
  if (payments.length === 1)
    return payments[0].method + (amount < 0 ? '退款' : '');
  return payments.map((p) => `${p.method}(${p.amount})`).join(' + ');
}
export function validateRoleChange(role, tenant, patch, current) {
  if (role !== 'admin' && patch.key.startsWith('stock:'))
    throw Object.assign(Error('庫存由書房匯入與調整'), { status: 403 });
  if (!patch.key.startsWith('order:') || patch.after == null) return;
  const order = patch.after;
  if (
    role !== 'admin' &&
    (order.paymentRecords || []).some(
      (p) => !CHURCH_PAYMENTS.includes(p.method),
    )
  )
    throw Object.assign(Error('教會僅開放文化幣與 LINE PAY'), { status: 403 });
  if (
    role !== 'admin' &&
    order.bookFairCustomerCode &&
    !['0002', '305', tenant.toUpperCase()].includes(order.bookFairCustomerCode)
  )
    throw Object.assign(Error('無法使用其他教會的客戶代碼'), { status: 403 });
  if (
    current &&
    (order.createdAt !== current.createdAt ||
      order.transactionId !== current.transactionId)
  )
    throw Error('原出貨日期與識別資料不可變更');
}
