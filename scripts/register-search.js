let composingSearch = false,
  searchTimer,
  feedbackTimer;
let favorites = [];
const readFavorites = () => {
  try {
    const list = JSON.parse(localStorage.getItem('favorites') || '[]');
    favorites = Array.isArray(list)
      ? [...new Set(list)].filter((code) => products[code])
      : [];
  } catch {
    favorites = [];
  }
};
const feedback = (ok, text, code = '', camera = false) => {
  clearTimeout(feedbackTimer);
  productInfoElement.textContent = text;
  productInfoElement.dataset.result = ok ? 'success' : 'error';
  productInfoElement.classList.remove('scan-flash');
  void productInfoElement.offsetWidth;
  productInfoElement.classList.add('scan-flash');
  feedbackTimer = setTimeout(
    () => productInfoElement.classList.remove('scan-flash'),
    1100,
  );
  if (!ok) POSAudio.error();
  if (camera)
    parent.postMessage(
      { type: 'scan-result', ok, text, code, at: Date.now() },
      location.origin,
    );
};
function addScannedProduct(raw, camera = false) {
  if (cloud.event.status !== 'open' || checkoutBusy || editDialog.open) {
    feedback(false, '請先完成目前操作再掃描', raw, camera);
    return false;
  }
  const text = String(raw).trim().toUpperCase();
  const parsed = parseProductInput(text);
  const code = parsed?.code || text;
  const product = products[code];
  if (!product) {
    feedback(false, '查無商品：' + text, text, camera);
    return false;
  }
  if (
    parsed &&
    (!Number.isInteger(parsed.quantity) ||
      parsed.quantity <= 0 ||
      parsed.quantity > 100000)
  ) {
    feedback(false, '請輸入 1～100000 的數量', code, camera);
    return false;
  }
  if (
    !parsed &&
    (cart.find((i) => i.code === product.code)?.quantity || 0) >= 100000
  ) {
    feedback(false, '此商品已達數量上限', code, camera);
    return false;
  }
  addProductToCart(code);
  if (parsed) {
    const item = cart.find((i) => i.code === product.code);
    item.quantity = parsed.quantity;
    updateCartDisplay();
    calculateTotal();
    saveCart();
  }
  productCodeInput.value = '';
  searchResultsElement.replaceChildren();
  clearTimeout(searchTimer);
  feedback(true, '已加入 · ' + product.name, code, camera);
  return true;
}
function favoriteButton(product) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'favorite-toggle';
  const saved = favorites.includes(product.code);
  button.textContent = saved ? '★' : '☆';
  button.setAttribute(
    'aria-label',
    (saved ? '移除常用：' : '設為常用：') + product.name,
  );
  button.setAttribute('aria-pressed', String(saved));
  button.disabled = cloud.event.status !== 'open';
  button.onclick = () => {
    readFavorites();
    favorites = favorites.includes(product.code)
      ? favorites.filter((c) => c !== product.code)
      : [...favorites, product.code];
    localStorage.setItem('favorites', JSON.stringify(favorites));
    renderFavorites();
    renderSearch();
  };
  return button;
}
function renderFavorites() {
  const list = document.getElementById('favorite-products');
  if (!list) return;
  list.replaceChildren();
  for (const code of favorites) {
    const product = products[code];
    if (!product) continue;
    const row = document.createElement('div');
    row.className = 'favorite-product';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'favorite-add';
    const name = document.createElement('b');
    name.textContent = product.name;
    const detail = document.createElement('small');
    detail.textContent =
      product.code +
      ' · $' +
      formatAmount(Math.round((product.price * product.defaultDiscount) / 100));
    add.append(name, detail);
    add.onclick = () => addScannedProduct(code);
    add.disabled = cloud.event.status !== 'open';
    row.append(add, favoriteButton(product));
    list.append(row);
  }
  if (!favorites.length) {
    const tip = document.createElement('p');
    tip.className = 'favorites-empty';
    tip.textContent = '搜尋商品後點 ☆ 加入，下次一點就能結帳。';
    list.append(tip);
  }
}
function renderSearch() {
  const query = productCodeInput.value.trim().toLowerCase();
  searchResultsElement.replaceChildren();
  if (!query) return;
  const terms = query.split(/\s+/).filter(Boolean);
  const matches = [...new Set(Object.values(products))].filter((p) =>
    terms.every((k) =>
      [p.name, p.csvName, p.webName, p.code, p.barcode, p.webBarcode].some(
        (v) =>
          String(v || '')
            .toLowerCase()
            .includes(k),
      ),
    ),
  );
  const label = document.createElement('p');
  label.className = 'search-count';
  label.textContent = matches.length
    ? '找到 ' + matches.length + ' 件 · 點商品加入，點 ☆ 設為常用'
    : '查無符合商品，請檢查名稱或條碼';
  searchResultsElement.append(label);
  for (const product of matches.slice(0, 30)) {
    const row = document.createElement('div');
    row.className = 'search-row';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'search-product';
    const text = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = product.name;
    const meta = document.createElement('small');
    meta.textContent = product.code + ' · ' + product.priceLabel;
    text.append(name, meta);
    const price = document.createElement('strong');
    price.textContent =
      '$' +
      formatAmount(Math.round((product.price * product.defaultDiscount) / 100));
    add.append(text, price);
    add.onclick = () => addScannedProduct(product.code);
    add.disabled = cloud.event.status !== 'open';
    row.append(add, favoriteButton(product));
    searchResultsElement.append(row);
  }
  if (matches.length > 30) {
    const tip = document.createElement('p');
    tip.className = 'search-count';
    tip.textContent = '顯示前 30 件，輸入更多關鍵字可縮小範圍。';
    searchResultsElement.append(tip);
  }
}
productCodeInput.addEventListener(
  'compositionstart',
  () => (composingSearch = true),
);
productCodeInput.addEventListener('compositionend', () => {
  composingSearch = false;
  renderSearch();
});
productCodeInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  if (!composingSearch) searchTimer = setTimeout(renderSearch, 100);
});
scanForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (composingSearch) return;
  const raw = productCodeInput.value.trim();
  if (!raw) return;
  if (products[raw.toUpperCase()] || parseProductInput(raw.toUpperCase()))
    addScannedProduct(raw);
  else {
    renderSearch();
    if (!searchResultsElement.querySelector('.search-product'))
      feedback(false, '查無商品：' + raw);
    // Select unknown scans for replacement; successful keyword matches remain selectable.
    else feedback(true, '請從搜尋結果選擇商品');
    productCodeInput.select();
  }
});
