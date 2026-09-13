// Shared by the register and React tools. Existing orders keep their saved prices.
export function resolveProductPricing(product, now = new Date()) {
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
