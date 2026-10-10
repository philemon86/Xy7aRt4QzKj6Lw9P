const cultureDialog = document.createElement('dialog');
cultureDialog.className = 'item-editor culture-editor';
cultureDialog.setAttribute('aria-labelledby', 'culture-title');
cultureDialog.innerHTML = `<form>
  <div class="editor-heading"><div><small>分開記錄每種付款</small><h2 id="culture-title">文化幣收款</h2></div><button type="button" class="culture-cancel" aria-label="關閉文化幣收款">×</button></div>
  <p class="culture-total">訂單總額 <strong id="culture-total"></strong> 元</p>
  <div id="culture-methods" class="culture-methods" role="group" aria-label="文化幣付款組合"></div>
  <label>文化幣支付金額<input id="culture-amount" type="number" min="0" step="1" inputmode="numeric" required></label>
  <section id="culture-remainder">
    <div class="culture-remainder-heading">剩餘補款 <strong id="culture-rest-amount"></strong> 元</div>
    <div class="culture-cash" id="culture-cash"><label>實收現金<input id="culture-paid" type="number" min="0" step="1" inputmode="numeric"></label><div>找零 <strong id="culture-change"></strong> 元</div></div>
  </section>
  <p id="culture-error" role="status"></p>
  <div class="editor-actions"><button type="button" class="culture-cancel">取消</button><button type="submit" class="editor-save">確認收款</button></div>
</form>`;
document.body.append(cultureDialog);
const cultureField = (key) => cultureDialog.querySelector('#culture-' + key);
let cultureTotal = 0,
  cultureMethod = '',
  cultureCashAuto = true;
const positionCultureDialog = () => {
  const rect = window.frameElement?.getBoundingClientRect();
  cultureDialog.style.maxHeight = Math.max(220, parent.innerHeight - 32) + 'px';
  cultureDialog.style.top = Math.max(12, -(rect?.top || 0) +
    Math.max(16, (parent.innerHeight - cultureDialog.offsetHeight) / 2)) + 'px';
};
const updateCulturePayment = () => {
  const coin = Number(cultureField('amount').value);
  const valid =
    cultureField('amount').value !== '' &&
    Number.isSafeInteger(coin) &&
    coin >= 0 &&
    coin <= cultureTotal;
  const remaining = valid ? cultureTotal - coin : 0;
  cultureField('rest-amount').textContent = valid ? remaining : '—';
  cultureField('remainder').hidden = !cultureMethod || (valid && remaining === 0);
  cultureField('cash').hidden = cultureMethod !== '現金';
  if (cultureCashAuto)
    cultureField('paid').value = POSCore.suggestCashAmount(remaining);
  cultureField('change').textContent = Math.round(
    Number(cultureField('paid').value || 0) - remaining,
  );
  cultureField('error').textContent = valid || cultureField('amount').value === ''
    ? ''
    : '文化幣金額請填 0 至訂單總額的整數';
  if (cultureDialog.open) positionCultureDialog();
};
cultureField('amount').oninput = updateCulturePayment;
const selectCultureMethod = (method) => {
  const previous = cultureMethod;
  cultureMethod = method;
  cultureDialog.querySelectorAll('.culture-method').forEach(button =>
    button.setAttribute('aria-pressed', String(button.dataset.method === method)));
  cultureField('amount').readOnly = !method;
  if (!method) cultureField('amount').value = cultureTotal;
  else if (!previous) cultureField('amount').value = '';
  cultureCashAuto = true;
  updateCulturePayment();
  if (method) {
    cultureField('amount').focus({ preventScroll: true });
    cultureField('amount').select();
  }
};
cultureField('paid').oninput = () => {
  cultureCashAuto = false;
  updateCulturePayment();
};
cultureDialog
  .querySelectorAll('.culture-cancel')
  .forEach((button) => (button.onclick = () => cultureDialog.close()));
const handleCulturalCoinCheckout = () => {
  if (checkoutBusy || checkoutChecking || cloud.event.status !== 'open') return;
  if (!cart.length) {
    if (!hasShownEmptyCartAlert) {
      alert('購物車為空，無法結帳');
      POSAudio.error();
      hasShownEmptyCartAlert = true;
    }
    return;
  }
  hasShownEmptyCartAlert = false;
  cultureTotal = calculateCartTotal(cart);
  if (cultureTotal <= 0) {
    performCheckout(cultureTotal === 0 ? '零元' : '文化幣');
    return;
  }
  cultureCashAuto = true;
  cultureField('total').textContent = cultureTotal;
  cultureField('amount').value = cultureTotal;
  cultureField('amount').max = cultureTotal;
  cultureMethod = '';
  const methods = isBookstore
    ? ['', '現金', 'LINE PAY', '信用卡']
    : ['', '現金', 'LINE PAY'];
  cultureField('methods').classList.toggle('church-methods', !isBookstore);
  cultureField('methods').replaceChildren(
    ...methods.map((method) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'culture-method';
      button.dataset.method = method;
      button.textContent = method ? '文化幣 ＋ ' + method : '單獨文化幣';
      button.onclick = () => selectCultureMethod(method);
      return button;
    }),
  );
  selectCultureMethod('');
  cultureDialog.showModal();
  positionCultureDialog();
  cultureField('methods').querySelector('button').focus({ preventScroll: true });
};
cultureDialog.querySelector('form').onsubmit = async (event) => {
  event.preventDefault();
  try {
    if (checkoutBusy || checkoutChecking) return;
    if (cultureTotal !== calculateCartTotal(cart))
      throw Error('購物車已更新，請重新開啟文化幣收款');
    const coin = Number(cultureField('amount').value);
    const remaining = cultureTotal - coin;
    const method = cultureMethod;
    const payment = POSCore.culturalCoinPayment(
      cultureTotal,
      coin,
      method,
      cloud.me.role,
    );
    const cashPaid =
      remaining > 0 && method === '現金'
        ? Number(cultureField('paid').value)
        : 0;
    if (
      remaining > 0 &&
      method === '現金' &&
      (!Number.isSafeInteger(cashPaid) || cashPaid < remaining)
    )
      throw Error('實收現金不能少於剩餘補款');
    cultureDialog.close();
    triggerButtonAnimation(btnF9);
    await performCheckout(payment, true, cashPaid);
  } catch (error) {
    cultureField('error').textContent = error.message;
  }
};
