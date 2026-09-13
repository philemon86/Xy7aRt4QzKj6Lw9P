export function mergeChanges(current, changes) {
  const next = { ...current };
  for (const p of changes) {
    if (
      !p ||
      typeof p.key !== 'string' ||
      p.key.length > 160 ||
      ['__proto__', 'constructor', 'prototype'].includes(p.key)
    )
      throw Error('無效欄位');
    const existing = current[p.key] ?? null;
    if (
      JSON.stringify(existing) !== JSON.stringify(p.before ?? null) &&
      JSON.stringify(existing) !== JSON.stringify(p.after ?? null)
    ) {
      const error = Error('這筆資料已被另一台裝置修改，請重新載入後再操作。');
      error.status = 409;
      throw error;
    }
    if (p.after == null) delete next[p.key];
    else next[p.key] = p.after;
  }
  return next;
}
export function validateOrder(o) {
  if (
    !o ||
    typeof o.id !== 'string' ||
    !Array.isArray(o.items) ||
    o.items.length > 1000
  )
    throw Error('訂單格式錯誤');
  let sum = 0;
  for (const i of o.items) {
    if (
      !i.code ||
      typeof i.name !== 'string' ||
      /[<>]/.test(i.code) ||
      /[<>]/.test(i.name.replace(/<[\u3400-\u9fff-]+>/g, '')) ||
      ![i.price, i.quantity, i.discount].every(Number.isFinite) ||
      Math.abs(i.price) > 9999999 ||
      Math.abs(i.quantity) > 100000 ||
      i.discount < 0 ||
      i.discount > 100
    )
      throw Error('商品數量或金額錯誤');
    sum += (i.price * i.quantity * i.discount) / 100;
  }
  if (!Number.isFinite(o.amount) || Math.round(sum) !== o.amount)
    throw Error('訂單金額與明細不符');
  if (
    !Array.isArray(o.paymentRecords) ||
    o.paymentRecords.some(
      (p) =>
        !['現金', '信用卡', 'LINE PAY', '文化幣'].includes(p.method) ||
        !Number.isFinite(p.amount),
    ) ||
    Math.round(o.paymentRecords.reduce((s, p) => s + p.amount, 0)) !== o.amount
  )
    throw Error('付款金額不符');
  if (/[<>]/.test(o.id + o.paymentMethod)) throw Error('訂單格式錯誤');
  return o;
}
export function stats(state) {
  const orders = Object.entries(state)
    .filter(([k]) => k.startsWith('order:'))
    .map(([, v]) => v)
    .filter((o) => o && o.isValid);
  return {
    orders: orders.length,
    revenue: orders.reduce((s, o) => s + o.amount, 0),
    payments: orders
      .flatMap((o) => o.paymentRecords || [])
      .reduce(
        (s, p) => ({ ...s, [p.method]: (s[p.method] || 0) + p.amount }),
        {},
      ),
    quantity: orders.reduce(
      (s, o) => s + o.items.reduce((a, i) => a + i.quantity, 0),
      0,
    ),
  };
}
