const cultureDialog = document.createElement('dialog');
cultureDialog.className = 'item-editor culture-editor';
cultureDialog.setAttribute('aria-labelledby', 'culture-title');
cultureDialog.innerHTML = `<form>
  <div class="editor-heading"><div><small>分開記錄每種付款</small><h2 id="culture-title">文化幣收款</h2></div><button type="button" class="culture-cancel" aria-label="關閉文化幣收款">×</button></div>
  <p class="culture-total">訂單總額 <strong id="culture-total"></strong> 元</p>
  <label>文化幣支付金額<input id="culture-amount" type="number" min="0" step="1" inputmode="numeric" required></label>
  <section id="culture-remainder">
    <div class="culture-remainder-heading">剩餘補款 <strong id="culture-rest-amount"></strong> 元</div>
    <label>補款方式<select id="culture-method"></select></label>
    <div class="culture-cash" id="culture-cash"><label>實收現金<input id="culture-paid" type="number" min="0" step="1" inputmode="numeric"></label><div>找零 <strong id="culture-change"></strong> 元</div></div>
  </section>
  <p id="culture-error" role="status"></p>
  <div class="editor-actions"><button type="button" class="culture-cancel">取消</button><button type="submit" class="editor-save">確認收款</button></div>
</form>`;
document.body.append(cultureDialog);
const cultureField = (key) => cultureDialog.querySelector('#culture-' + key);
let cultureTotal = 0,
  cultureCashAuto = true;
const updateCulturePayment = () => {
  const coin = Number(cultureField('amount').value);
  const valid =
    cultureField('amount').value !== '' &&
    Number.isSafeInteger(coin) &&
    coin >= 0 &&
    coin <= cultureTotal;
  const remaining = valid ? cultureTotal - coin : 0;
  cultureField('rest-amount').textContent = remaining;
  cultureField('remainder').hidden = valid && remaining === 0;
  cultureField('cash').hidden = cultureField('method').value !== '現金';
  if (cultureCashAuto)
    cultureField('paid').value = POSCore.suggestCashAmount(remaining);
  cultureField('change').textContent = Math.round(
    Number(cultureField('paid').value || 0) - remaining,
  );
  cultureField('error').textContent = valid
    ? ''
    : '文化幣金額請填 0 至訂單總額的整數';
};
cultureField('amount').oninput = updateCulturePayment;
cultureField('method').onchange = () => {
  cultureCashAuto = true;
  updateCulturePayment();
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
  const methods = isBookstore
    ? ['現金', 'LINE PAY', '信用卡']
    : ['LINE PAY', '現金'];
  cultureField('method').replaceChildren(
    ...methods.map((method) => {
      const option = document.createElement('option');
      option.value = method;
      option.textContent = method;
      return option;
    }),
  );
  updateCulturePayment();
  cultureDialog.showModal();
  const rect = window.frameElement?.getBoundingClientRect();
  cultureDialog.style.maxHeight = Math.max(220, parent.innerHeight - 32) + 'px';
  cultureDialog.style.top =
    Math.max(
      12,
      -(rect?.top || 0) +
        Math.max(16, (parent.innerHeight - cultureDialog.offsetHeight) / 2),
    ) + 'px';
  cultureField('amount').focus({ preventScroll: true });
  cultureField('amount').select();
};
cultureDialog.querySelector('form').onsubmit = async (event) => {
  event.preventDefault();
  try {
    if (checkoutBusy || checkoutChecking) return;
    if (cultureTotal !== calculateCartTotal(cart))
      throw Error('購物車已更新，請重新開啟文化幣收款');
    const coin = Number(cultureField('amount').value);
    const remaining = cultureTotal - coin;
    const method = cultureField('method').value;
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
