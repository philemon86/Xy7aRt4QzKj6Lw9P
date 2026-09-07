// Injected inside the legacy register closure; monetary totals and payment handlers remain shared.
const editDialog = document.createElement('dialog');
editDialog.className = 'item-editor';
editDialog.setAttribute('aria-labelledby', 'edit-title');
editDialog.innerHTML = `<form id="item-edit-form">
  <div class="editor-heading"><div><small>調整本次結帳</small><h2 id="edit-title"></h2><p id="edit-source"></p></div><button type="button" id="edit-cancel" aria-label="關閉編輯">✕</button></div>
  <div class="editor-fields">
    <label>單價<input id="edit-price" type="number" step="any" inputmode="decimal" required></label>
    <label>數量<input id="edit-quantity" type="number" step="1" inputmode="numeric" required></label>
    <label>折扣 %<input id="edit-discount" type="number" min="0" max="100" step="any" inputmode="decimal" required></label>
  </div>
  <p class="editor-help">79 表示七九折；100 為原價。退貨可輸入負數數量。</p>
  <label class="editor-sync"><input type="checkbox" id="edit-sync"> 同時設定本場同分類的折扣</label>
  <p id="edit-error" role="status"></p>
  <div class="editor-preview">此項小計 <strong id="edit-subtotal"></strong></div>
  <div class="editor-actions"><button type="button" id="edit-remove">移除商品</button><button type="button" id="edit-reset">還原預設</button><button type="submit" class="editor-save">套用變更</button></div>
</form>`;
document.body.append(editDialog);
let editingCode = '',
  resetPrice = false;
const editField = (key) => editDialog.querySelector('#edit-' + key);
const formatAmount = (value) =>
  Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const closeEditor = () => {
  editDialog.close();
  if (matchMedia('(pointer:fine)').matches)
    productCodeInput.focus({ preventScroll: true });
};
editField('cancel').onclick = closeEditor;
function previewEdit() {
  try {
    const item = POSCore.editCartItem(
      {},
      {
        price: editField('price').value,
        quantity: editField('quantity').value,
        discount: editField('discount').value,
      },
    );
    editField('subtotal').textContent =
      'NT$ ' +
      formatAmount(
        Math.round((item.price * item.quantity * item.discount) / 100),
      );
    editField('error').textContent = '';
  } catch (e) {
    editField('subtotal').textContent = '—';
  }
}
['price', 'quantity', 'discount'].forEach(
  (key) => (editField(key).oninput = previewEdit),
);
function openItemEditor(code, field = 'quantity') {
  if (cloud.event.status !== 'open' || checkoutBusy) return;
  const item = cart.find((i) => i.code === code);
  if (!item) return;
  editingCode = code;
  resetPrice = false;
  editField('title').textContent = item.name;
  editField('source').textContent =
    code + ' · ' + (item.priceLabel || '已保存價格');
  for (const key of ['price', 'quantity', 'discount'])
    editField(key).value = item[key];
  editField('sync').checked = false;
  editField('sync').disabled = !item.class;
  editField('error').textContent = '';
  previewEdit();
  editDialog.showModal();
  const rect = window.frameElement?.getBoundingClientRect();
  const visibleHeight = parent.innerHeight;
  editDialog.style.maxHeight = Math.max(220, visibleHeight - 32) + 'px';
  editDialog.style.top =
    Math.max(
      12,
      -(rect?.top || 0) +
        Math.max(16, (visibleHeight - editDialog.offsetHeight) / 2),
    ) + 'px';
  editField(field).focus({ preventScroll: true });
  editField(field).select();
}
editField('reset').onclick = () => {
  const product = products[editingCode];
  if (!product) return;
  editField('price').value = product.price;
  editField('discount').value = product.defaultDiscount;
  editField('sync').checked = false;
  resetPrice = true;
  previewEdit();
};
editField('remove').onclick = () => {
  cart = cart.filter((i) => i.code !== editingCode);
  delete priceOverrides[editingCode];
  localStorage.setItem('priceOverrides', JSON.stringify(priceOverrides));
  updateCartDisplay();
  calculateTotal();
  saveCart();
  closeEditor();
};
editDialog.querySelector('form').onsubmit = (e) => {
  e.preventDefault();
  try {
    const index = cart.findIndex((i) => i.code === editingCode);
    if (index < 0) return closeEditor();
    const edited = POSCore.editCartItem(cart[index], {
      price: editField('price').value,
      quantity: editField('quantity').value,
      discount: editField('discount').value,
    });
    cart[index] = edited;
    priceOverrides[edited.code] = edited.price;
    if (
      resetPrice &&
      edited.price === products[edited.code]?.price &&
      edited.discount === products[edited.code]?.defaultDiscount
    ) {
      delete priceOverrides[edited.code];
      Object.assign(edited, {
        priceLabel: products[edited.code].priceLabel,
        priceSource: products[edited.code].priceSource,
      });
    }
    if (editField('sync').checked && edited.class) {
      sessionRules[edited.class] = edited.discount;
      localStorage.setItem('sessionRules', JSON.stringify(sessionRules));
      cart.forEach((item) => {
        if (item.class === edited.class) {
          item.discount = edited.discount;
          item.isManual = true;
        }
      });
    }
    localStorage.setItem('priceOverrides', JSON.stringify(priceOverrides));
    updateCartDisplay();
    calculateTotal();
    saveCart();
    closeEditor();
  } catch (error) {
    editField('error').textContent = error.message;
  }
};
const updateCartDisplay = () => {
  cartTableBody.replaceChildren();
  const count = document.getElementById('cart-count');
  if (count)
    count.textContent =
      cart.length + ' 種 · ' + cart.reduce((s, i) => s + i.quantity, 0) + ' 件';
  if (!cart.length) {
    const row = document.createElement('tr');
    row.className = 'cart-empty';
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.innerHTML =
      '<span class="empty-bag">＋</span><strong>準備好下一筆結帳</strong><small>掃描條碼、搜尋商品，或點選常用商品。</small>';
    row.append(cell);
    cartTableBody.append(row);
  }
  cart.forEach((item) => {
    const row = document.createElement('tr');
    row.className = 'cart-item';
    row.dataset.code = item.code;
    row.innerHTML = `<td class="cart-product"><b></b><small></small><span class="cart-price-note"></span></td>
      <td class="cart-quantity"><div class="quantity-stepper"><button type="button" aria-label="減少一件">−</button><button type="button" class="quantity-value" aria-label="編輯數量"></button><button type="button" aria-label="增加一件">＋</button></div></td>
      <td class="cart-subtotal"><strong></strong></td><td class="cart-edit"><button type="button">編輯</button></td>`;
    row.querySelector('b').textContent = item.name;
    row.querySelector('small').textContent =
      item.code +
      ' · ' +
      (item.isManual ? '手動調整' : item.priceLabel || '已保存價格');
    row.querySelector('.cart-price-note').textContent =
      '$' +
      formatAmount(item.price) +
      (Number(item.discount) === 100 ? '／件' : ' × ' + item.discount + '%');
    row.querySelector('.cart-subtotal strong').textContent =
      '$' +
      formatAmount(
        Math.round((item.price * item.quantity * item.discount) / 100),
      );
    const buttons = row.querySelectorAll('.quantity-stepper button');
    buttons[1].textContent = item.quantity;
    [buttons[0], buttons[2]].forEach(
      (button, i) =>
        (button.onclick = () => {
          if (cloud.event.status !== 'open' || checkoutBusy) return;
          const next = item.quantity + (i ? 1 : -1);
          if (Math.abs(next) > 100000) return;
          item.quantity = next;
          updateCartDisplay();
          calculateTotal();
          saveCart();
        }),
    );
    buttons[1].onclick = () => openItemEditor(item.code);
    row.querySelector('.cart-edit button').onclick = () =>
      openItemEditor(item.code);
    row.querySelector('.cart-product').ondblclick = () =>
      openItemEditor(item.code, 'price');
    row.querySelector('.cart-subtotal').ondblclick = () =>
      openItemEditor(item.code, 'discount');
    if (cloud.event.status !== 'open')
      row.querySelectorAll('button').forEach((b) => (b.disabled = true));
    cartTableBody.append(row);
  });
  resetIdleTimer();
};
