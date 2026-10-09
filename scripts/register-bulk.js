// Batch input -> cart. Reuse existing product pricing and quantity rules.
let bulkBusy = false, bulkNeedsSave = false;
bulkResult.setAttribute('role', 'status');
bulkResult.setAttribute('aria-live', 'polite');
bulkInput.value = localStorage.getItem('bulkInput') || '';
const saveBulkInput = () => localStorage.setItem('bulkInput', bulkInput.value);
bulkInput.addEventListener('input', saveBulkInput);
const parseBulkLine = (line) => {
  const raw = line.trim().toUpperCase();
  if (!raw) return null;
  const left = raw.match(/^(-?\d+)\s*\*\s*([\w\-/]+)$/);
  const right = raw.match(/^([\w\-/]+)\s*[*，,]\s*(-?\d+)$/);
  if (right && products[right[1]]) return { code: right[1], qty: Number(right[2]) };
  if (left) return { code: left[2], qty: Number(left[1]) };
  if (right) return { code: right[1], qty: Number(right[2]) };
  if (/^[\w\-/]+$/.test(raw)) return { code: raw, qty: 1 };
  return { error: '格式錯誤' };
};
bulkClearBtn.addEventListener('click', () => {
  if (bulkBusy) return;
  bulkInput.value = '';
  saveBulkInput();
  bulkResult.textContent = '已清除批次輸入；購物車保留。';
  bulkInput.focus();
});
bulkBackupBtn.addEventListener('click', async () => {
  if (bulkBusy || checkoutBusy || checkoutChecking) return;
  if (cloud.event.status !== 'open' || (isBookstore && cloud.event.organizer === 'church')) {
    bulkResult.textContent = '此書展僅供查看，無法回填購物車。'; return;
  }
  if (cloud.offlineSyncError) {
    bulkResult.textContent = '請先處理上方的待同步資料，再回填購物車。'; return;
  }
  let success = 0, quantity = 0;
  const failed = [];
  if (!bulkNeedsSave) {
    const lines = (bulkInput.value || '').split(/\r?\n/);
    if (!lines.some((line) => line.trim())) {
      bulkResult.textContent = '請先輸入商品代碼與數量，例如 C001,2，再按「回填購物車」。';
      bulkInput.focus(); return;
    }
    lines.forEach((line, index) => {
      const parsed = parseBulkLine(line);
      if (!parsed) return;
      const product = products[parsed.code];
      const existing = product && cart.find((item) => item.code === product.code);
      const reason = parsed.error || (!Number.isSafeInteger(parsed.qty) || parsed.qty === 0 || Math.abs(parsed.qty) > 100000
        || Math.abs((existing?.quantity || 0) + parsed.qty) > 100000 ? '數量須為非零整數，合計不可超過 100000'
        : !product ? '找不到商品' : '');
      if (reason || !addProductWithQuantity(parsed.code, parsed.qty)) {
        failed.push({ line, message: `第 ${index + 1} 行 ${parsed.code || line.trim()}：${reason || '無法加入'}` });
      } else { success++; quantity += parsed.qty; }
    });
    if (!success) {
      bulkResult.textContent = '尚未回填。' + failed.map((f) => f.message).join('；'); return;
    }
    // Remove only accepted input so another click cannot duplicate those lines.
    bulkInput.value = failed.map((f) => f.line).join('\n');
    updateCartDisplay();
    calculateTotal();
    bulkNeedsSave = true;
  }
  bulkBusy = true; checkoutChecking = true;
  bulkBackupBtn.disabled = bulkClearBtn.disabled = bulkInput.disabled = true;
  checkoutBtns.forEach((button) => button.disabled = true);
  try {
    saveCart(); saveBulkInput();
    await cloud.flush();
    bulkNeedsSave = false;
    bulkBackupBtn.textContent = '回填購物車';
    bulkResult.textContent = success ? `已回填 ${success} 筆（${quantity} 件）至購物車。` + (failed.length ? '未加入：' + failed.map((f) => f.message).join('；') : '') : '購物車已保存。';
  } catch (error) {
    bulkBackupBtn.textContent = '重試保存';
    bulkResult.textContent = '商品已帶入購物車，但尚未保存。請按「重試保存」，不要重複輸入。' + error.message;
  } finally {
    bulkBusy = false; checkoutChecking = false;
    bulkBackupBtn.disabled = bulkClearBtn.disabled = bulkInput.disabled = false;
    checkoutBtns.forEach((button) => button.disabled = false);
  }
});
