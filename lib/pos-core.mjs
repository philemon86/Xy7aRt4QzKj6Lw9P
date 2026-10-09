// Shared by the register and React tools. Existing orders keep their saved prices.
const pricingDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const productSearchCollator = new Intl.Collator('zh-Hant', {
  numeric: true,
  sensitivity: 'base',
});
export function searchProducts(items, query) {
  const normalize = (value) =>
    String(value ?? '')
      .normalize('NFKC')
      .trim()
      .toLowerCase();
  const text = normalize(query);
  if (!text) return [];
  const terms = text.split(/\s+/);
  const matches = [];
  for (const product of new Set(items)) {
    const code = normalize(product.code);
    const barcodes = [product.barcode, product.webBarcode]
      .map(normalize)
      .filter(Boolean);
    const names = [product.name, product.csvName, product.webName]
      .map(normalize)
      .filter(Boolean);
    if (
      !terms.every((term) =>
        [code, ...barcodes, ...names].some((value) => value.includes(term)),
      )
    )
      continue;
    // Prefer the requested identifier, then the shortest related identifier.
    let rank;
    if (code === text) rank = [0, 0, 0];
    else if (barcodes.includes(text)) rank = [1, 0, 0];
    else if (code.startsWith(text)) rank = [2, code.length - text.length, 0];
    else if (code.includes(text))
      rank = [3, code.length - text.length, code.indexOf(text)];
    else {
      rank = [10, 0, 0];
      for (const [values, base] of [
        [barcodes, 4],
        [names, 7],
      ]) {
        for (const value of values) {
          const index = value.indexOf(text);
          if (index < 0) continue;
          const candidate = [
            base + (value === text ? 0 : index === 0 ? 1 : 2),
            value.length - text.length,
            index,
          ];
          if (
            candidate[0] < rank[0] ||
            (candidate[0] === rank[0] && candidate[1] < rank[1]) ||
            (candidate[0] === rank[0] &&
              candidate[1] === rank[1] &&
              candidate[2] < rank[2])
          )
            rank = candidate;
        }
      }
    }
    matches.push({ product, code, rank });
  }
  matches.sort(
    (a, b) =>
      a.rank[0] - b.rank[0] ||
      a.rank[1] - b.rank[1] ||
      a.rank[2] - b.rank[2] ||
      productSearchCollator.compare(a.code, b.code),
  );
  return matches.map(({ product }) => product);
}
export function formatDiscount(value) {
  const n = Number(value);
  return n === 100
    ? '原價'
    : n === 0
      ? '免費'
      : Number((n / 10).toFixed(2)) + ' 折';
}
export function suggestCashAmount(total) {
  const amount = Number(total);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (amount <= 100) return 100;
  if (amount <= 500) return 500;
  if (amount <= 1000) return 1000;
  return Math.ceil(amount / 500) * 500;
}

export function culturalCoinPayment(total, coin, remainderMethod, role) {
  total = Number(total);
  coin = Number(coin);
  if (
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    !Number.isSafeInteger(coin) ||
    coin < 0 ||
    coin > total
  )
    throw Error('文化幣金額請填 0 至訂單總額的整數');
  const allowed =
    role === 'church' ? ['LINE PAY', '現金'] : ['信用卡', 'LINE PAY', '現金'];
  const remainder = total - coin;
  if (remainder && !allowed.includes(remainderMethod))
    throw Error('請選擇可用的補款方式');
  return [
    coin ? `文化幣(${coin})` : '',
    remainder ? `${remainderMethod}(${remainder})` : '',
  ]
    .filter(Boolean)
    .join(' + ');
}
export function resolveProductPricing(product, now = new Date()) {
  const day = pricingDayFormatter.format(now);
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
    Number(product.websitePrice) >= 0 &&
    (Number(product.websitePrice) > 0 ||
      legacyPrice === 0 ||
      product.websiteZeroConfirmed === true);
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

// Only the unfinished cart calls this recovery. Explicit manual/free-gift prices remain intact.
export function repairWebsiteZeroCart(items, products) {
  return items.map((item) => {
    const product = products[item.code];
    if (
      item.priceSource !== 'website' ||
      (Number(item.price) !== 0 &&
        !product?.websitePriceCorrectionFrom?.includes(Number(item.price))) ||
      item.isManual ||
      item.promotionGift ||
      Number(item.discount) === 0 ||
      !product ||
      !(product.price > 0)
    )
      return item;
    return {
      ...item,
      price: product.price,
      defaultDiscount: product.defaultDiscount,
      discount: product.defaultDiscount,
      priceSource: product.priceSource,
      priceLabel: product.priceLabel,
    };
  });
}

// Round one physical unit before multiplying quantity. Refunds keep the same
// magnitude as their corresponding sale, including negative-price adjustments.
export function discountedUnitPrice(item) {
  const value = Number(item.price || 0) * Number(item.discount ?? 100) / 100;
  return Math.sign(value) * Math.floor(Math.abs(value) + 0.5 + Number.EPSILON * Math.max(1, Math.abs(value)) * 4);
}
export function itemTotal(item, roundingMode = 'unit-v1') {
  return roundingMode === 'unit-v1'
    ? discountedUnitPrice(item) * Number(item.quantity || 0)
    : Math.round(Number(item.price || 0) * Number(item.discount ?? 100) / 100 * Number(item.quantity || 0));
}
export function cartTotal(items, roundingMode = 'unit-v1') {
  return roundingMode === 'unit-v1'
    ? (items || []).reduce((sum, item) => sum + itemTotal(item), 0)
    : Math.round((items || []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.discount ?? 100) / 100 * Number(item.quantity || 0), 0));
}
export function editCartItem(item, values) {
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
  if (Math.abs(discount * 10 - Math.round(discount * 10)) > 0.0000001)
    throw Error('折扣百分比最多一位小數，例如 95.5%');
  return { ...item, price, quantity, discount, isManual: true };
}

// Arithmetic parser: no eval, with operator precedence, unary signs and parentheses.
export function evaluateExpression(expression) {
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

export function insertOperand(expression, amount) {
  const input = String(expression).trimEnd();
  const value = amount < 0 ? '(' + amount + ')' : String(amount);
  return input + (input && /[\d.)]$/.test(input) ? '+' : '') + value;
}

export function createScanGate(delay = 1000) {
  let last = '',
    lastSeen = -Infinity;
  return (code, now = Date.now()) => {
    const repeated = code === last && now - lastSeen < delay;
    last = code;
    lastSeen = now;
    return !repeated;
  };
}
