window.POSCore=(()=>{// Shared by the register and React tools. Existing orders keep their saved prices.
function formatDiscount(value) {
  const n = Number(value);
  return n === 100 ? '原價' : n === 0 ? '免費' : Number(n.toFixed(1)) + ' 折';
}
function resolveProductPricing(product, now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const active = (r) =>
    r &&
    !r.disabled &&
    (!r.start || r.start <= day) &&
    (!r.end || r.end >= day);
  const legacyPrice = Number(product.legacyPrice ?? product.price);
  const single =
    product.productRule ??
    (product.specialDiscount != null
      ? { mode: 'discount', value: product.specialDiscount, origin: 'legacy' }
      : null);
  const category =
    product.categoryRule ??
    (product.defaultDiscount != null
      ? { mode: 'discount', value: product.defaultDiscount }
      : null);
  const web =
    product.websitePrice != null &&
    Number.isFinite(Number(product.websitePrice)) &&
    Number(product.websitePrice) >= 0;
  let price = legacyPrice,
    discount = 100,
    priceSource = 'original',
    priceLabel = 'CSV 原價';
  const apply = (rule, source, label) => {
    if (rule.mode === 'price') price = Number(rule.value);
    else discount = Number(rule.value);
    priceSource = source;
    priceLabel = label;
  };
  if (active(single))
    apply(
      single,
      single.origin === 'legacy' ? 'legacy-special' : 'product',
      '單品設定',
    );
  else if (web) {
    price = Number(product.websitePrice);
    priceSource = 'website';
    priceLabel = '官網售價';
  } else if (active(category)) apply(category, 'legacy', '類別設定');
  return {
    ...product,
    legacyPrice,
    price,
    defaultDiscount: discount,
    priceSource,
    priceLabel,
    websiteBase: priceSource === 'website',
  };
}

function editCartItem(item, values) {
  const price = Number(values.price),
    quantity = Number(values.quantity),
    discount = Number(values.discount);
  if (
    [values.price, values.quantity, values.discount].some(
      (v) => String(v).trim() === '',
    ) ||
    ![price, quantity, discount].every(Number.isFinite)
  )
    throw Error('請完整輸入單價、數量與折扣');
  if (!Number.isInteger(quantity) || Math.abs(quantity) > 100000)
    throw Error('數量請輸入整數；退貨可用負數');
  if (Math.abs(price) > 9999999) throw Error('單價超出可用範圍');
  if (discount < 0 || discount > 100)
    throw Error('折扣請輸入 0～100，例如 79 表示七九折');
  return { ...item, price, quantity, discount, isManual: true };
}

// Arithmetic parser: no eval, with operator precedence, unary signs and parentheses.
function evaluateExpression(expression) {
  if (/[\d.]\s+[\d.]/.test(String(expression)))
    throw Error('請在數字之間加入運算符號');
  const source = String(expression)
    .replaceAll('×', '*')
    .replaceAll('÷', '/')
    .replaceAll('−', '-')
    .replace(/\s/g, '');
  if (!source || source.length > 200) throw Error('請輸入算式（最多 200 字）');
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/-]/g);
  if (!tokens || tokens.join('') !== source)
    throw Error('僅支援數字與加減乘除');
  let index = 0;
  function factor() {
    const token = tokens[index++];
    if (token === '+' || token === '-')
      return (token === '-' ? -1 : 1) * factor();
    if (token === '(') {
      const value = sum();
      if (tokens[index++] !== ')') throw Error('請補上右括號');
      return value;
    }
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token))
      throw Error('算式尚未完成');
    return Number(token);
  }
  function term() {
    let value = factor();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const op = tokens[index++],
        right = factor();
      if (op === '/' && right === 0) throw Error('不能除以零');
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }
  function sum() {
    let value = term();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const op = tokens[index++],
        right = term();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }
  const result = sum();
  if (index !== tokens.length) throw Error('請在數字之間加入運算符號');
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER)
    throw Error('結果超出可計算範圍');
  return Number(result.toPrecision(12));
}

function insertOperand(expression, amount) {
  const input = String(expression).trimEnd();
  const value = amount < 0 ? '(' + amount + ')' : String(amount);
  return input + (input && /[\d.)]$/.test(input) ? '+' : '') + value;
}

function createScanGate(delay = 1000) {
  let last = '',
    lastSeen = -Infinity;
  return (code, now = Date.now()) => {
    const repeated = code === last && now - lastSeen < delay;
    last = code;
    lastSeen = now;
    return !repeated;
  };
}


const promotionDay = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
const ruleActive = (rule, day = promotionDay()) =>
  !!rule &&
  !rule.disabled &&
  (!rule.start || rule.start <= day) &&
  (!rule.end || rule.end >= day);
function validatePromotion(value, products) {
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
      giftMode: 'scanned',
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
function productPromotions(product, groups, now = new Date()) {
  return (groups || [])
    .filter(
      (g) => ruleActive(g, promotionDay(now)) && g.codes.includes(product.code),
    )
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
// Computes checkout lines from the scanned cart; never mutates drafts or completed orders.
function applyPromotions(items, products, groups, now = new Date()) {
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
    // Old saved auto-gift rules also require both physical products to be scanned.
    .map((g) => (g.type === 'bogo' ? { ...g, giftMode: 'scanned' } : g))
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
            ? [...choices]
                .sort(
                  (a, b) => Number(a === item.code) - Number(b === item.code),
                )
                .find((code) =>
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

return {formatDiscount,applyPromotions,resolveProductPricing,editCartItem,evaluateExpression,insertOperand,createScanGate};})();
