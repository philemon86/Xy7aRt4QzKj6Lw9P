import { validatePriceRule } from './catalog.mjs';
export const promotionDay = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
export const ruleActive = (rule, day = promotionDay()) =>
  !!rule &&
  !rule.disabled &&
  (!rule.start || rule.start <= day) &&
  (!rule.end || rule.end >= day);
export function validatePromotion(value, products) {
  if (
    !value ||
    !['bogo', 'tiers'].includes(value.type) ||
    !String(value.name || '').trim() ||
    value.name.length > 100
  )
    throw Error('請填寫活動名稱與類型');
  const dates = validatePriceRule({
    mode: 'discount',
    value: 100,
    start: value.start,
    end: value.end,
  });
  const known = new Set(products.map((p) => p.code));
  if (
    !Array.isArray(value.codes) ||
    (value.giftCodes && !Array.isArray(value.giftCodes))
  )
    throw Error('商品清單格式錯誤');
  const codes = [...new Set(value.codes || [])];
  if (!codes.length || codes.length > 1000 || codes.some((c) => !known.has(c)))
    throw Error('請選擇有效的活動商品');
  const result = {
    id: String(value.id || ''),
    name: value.name.trim(),
    type: value.type,
    codes,
    start: dates.start,
    end: dates.end,
    disabled: !!value.disabled,
    priority: Number(value.priority || 0),
    origin: value.origin === 'website' ? 'website' : 'custom',
  };
  if (
    !Number.isSafeInteger(result.priority) ||
    Math.abs(result.priority) > 10000
  )
    throw Error('活動順位無效');
  if (value.type === 'bogo') {
    if (value.giftCode && !known.has(value.giftCode))
      throw Error('找不到贈品商品');
    const giftCodes = [
      ...new Set([value.giftCode, ...(value.giftCodes || [])].filter(Boolean)),
    ];
    if (giftCodes.some((c) => !known.has(c))) throw Error('贈品代碼無效');
    return {
      ...result,
      giftCodes,
      giftCode: value.giftCode || '',
      giftMode: value.giftMode === 'scanned' ? 'scanned' : 'auto',
    };
  }
  if (
    !Array.isArray(value.tiers) ||
    !value.tiers.length ||
    value.tiers.length > 20
  )
    throw Error('請設定至少一個數量門檻');
  const tiers = value.tiers
    .map((t) => {
      if (
        !Number.isSafeInteger(Number(t.quantity)) ||
        Number(t.quantity) < 1 ||
        Number(t.quantity) > 100000
      )
        throw Error('門檻請填正整數');
      if (!['price', 'discount'].includes(t.mode) || t.disabled)
        throw Error('數量折扣方式不符');
      const r = validatePriceRule(t);
      return { quantity: Number(t.quantity), mode: r.mode, value: r.value };
    })
    .sort((a, b) => a.quantity - b.quantity);
  if (new Set(tiers.map((t) => t.quantity)).size !== tiers.length)
    throw Error('數量門檻不可重複');
  return { ...result, tiers };
}
export function productPromotions(product, groups, now = new Date()) {
  return (groups || [])
    .filter(
      (g) => ruleActive(g, promotionDay(now)) && g.codes.includes(product.code),
    )
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
// Computes checkout lines from the scanned cart; never mutates drafts or completed orders.
export function applyPromotions(items, products, groups, now = new Date()) {
  const productMap = Array.isArray(products)
    ? Object.fromEntries(products.map((p) => [p.code, p]))
    : products;
  const lines = items.map((i, index) => ({
    ...i,
    promotionSourceIndex: index,
  }));
  const claimed = new Set();
  const active = (groups || [])
    .filter((g) => ruleActive(g, promotionDay(now)))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const group of active) {
    const eligible = lines.filter(
      (i) =>
        !i.promotionGift &&
        !i.isManual &&
        i.quantity > 0 &&
        i.price >= 0 &&
        !claimed.has(i.promotionSourceIndex) &&
        group.codes.includes(i.code),
    );
    if (!eligible.length) continue;
    const quantity = eligible.reduce((s, i) => s + i.quantity, 0);
    if (group.type === 'tiers') {
      const tier = group.tiers.filter((t) => quantity >= t.quantity).at(-1);
      if (!tier) continue;
      for (const item of eligible) {
        const p = productMap[item.code] || item;
        item.price = Number(p.legacyPrice ?? p.price);
        item.discount = tier.mode === 'price' ? 100 : tier.value;
        if (tier.mode === 'price') item.price = tier.value;
        item.priceSource = 'group';
        item.priceLabel = group.name;
        item.promotionId = group.id;
        claimed.add(item.promotionSourceIndex);
      }
    } else {
      for (const item of eligible) {
        if (claimed.has(item.promotionSourceIndex)) continue;
        const choices = group.giftCodes?.length
          ? group.giftCodes
          : [group.giftCode || item.code];
        const selected = choices.includes(item.promotionGiftCode)
          ? item.promotionGiftCode
          : choices[0];
        const giftCode =
          group.giftMode === 'scanned'
            ? choices.find((code) =>
                lines.some(
                  (i) =>
                    i.code === code &&
                    i.quantity >= (code === item.code ? 2 : 1) &&
                    !i.isManual &&
                    !i.promotionGift &&
                    !claimed.has(i.promotionSourceIndex),
                ),
              ) || selected
            : selected;
        const gift = productMap[giftCode];
        if (!gift) continue;
        let giftQty = item.quantity;
        let giftSource = null;
        if (group.giftMode === 'scanned') {
          giftSource =
            giftCode === item.code
              ? item
              : lines.find(
                  (i) =>
                    i.code === giftCode &&
                    !i.promotionGift &&
                    !i.isManual &&
                    !claimed.has(i.promotionSourceIndex) &&
                    i.quantity > 0,
                );
          giftQty =
            giftCode === item.code
              ? Math.floor(item.quantity / 2)
              : Math.min(item.quantity, giftSource?.quantity || 0);
          if (!giftQty) continue;
          giftSource.quantity -= giftQty;
          claimed.add(giftSource.promotionSourceIndex);
        }
        const p = productMap[item.code] || item;
        item.price = Number(p.legacyPrice ?? p.price);
        item.discount = 100;
        item.priceSource = 'group';
        item.priceLabel = group.name;
        item.promotionId = group.id;
        claimed.add(item.promotionSourceIndex);
        lines.push({
          ...gift,
          price: Number(gift.legacyPrice ?? gift.price),
          quantity: giftQty,
          discount: 0,
          isManual: false,
          promotionGift: true,
          promotionGiftMode: group.giftMode,
          promotionGiftChoices: choices,
          promotionId: group.id,
          promotionSourceIndex:
            giftSource?.promotionSourceIndex ?? item.promotionSourceIndex,
          priceSource: 'group',
          priceLabel: group.name + ' · 贈品',
        });
      }
    }
  }
  return lines.filter((i) => i.quantity !== 0);
}
