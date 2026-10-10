// Both directions reuse existing pricing and persist together on this device.
let bulkBusy = false, bulkNeedsSave = false, bulkSavedMessage = '';
const bulkToListBtn = document.getElementById('bulk-to-list-btn');
let bulkMovedItems = {};
try { bulkMovedItems = JSON.parse(localStorage.getItem('bulkMovedItems') || '{}') || {}; } catch {}
bulkResult.setAttribute('role', 'status');
bulkResult.setAttribute('aria-live', 'polite');
bulkInput.value = localStorage.getItem('bulkInput') || '';
const saveBulkInput = () => {
  localStorage.setItem('bulkInput', bulkInput.value);
  localStorage.setItem('bulkMovedItems', JSON.stringify(bulkMovedItems));
};
bulkInput.addEventListener('input', saveBulkInput);
const canChangeBulk = () => {
  if (bulkBusy || checkoutBusy || checkoutChecking) return false;
  if (cloud.event.status !== 'open' || (isBookstore && cloud.event.organizer === 'church')) {
    bulkResult.textContent = '此書展僅供查看，無法移動商品。'; return false;
  }
  return true;
};
const commitBulk = async (button) => {
  bulkBusy = true; checkoutChecking = true;
  bulkBackupBtn.disabled = bulkToListBtn.disabled = bulkClearBtn.disabled = bulkInput.disabled = true;
  checkoutBtns.forEach((button) => button.disabled = true);
  try {
    saveCart(); saveBulkInput();
    await cloud.flush();
    bulkNeedsSave = false;
    bulkBackupBtn.textContent = '清單 → 購物車';
    bulkToListBtn.textContent = '購物車 → 清單';
    bulkResult.textContent = bulkSavedMessage;
  } catch (error) {
    button.textContent = '重試保存';
    bulkResult.textContent = '商品已移動，但尚未保存。請按「重試保存」，不要重複輸入。' + error.message;
  } finally {
    bulkBusy = false; checkoutChecking = false;
    bulkBackupBtn.disabled = bulkToListBtn.disabled = bulkClearBtn.disabled = bulkInput.disabled = false;
    checkoutBtns.forEach((button) => button.disabled = false);
  }
};
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
  if (bulkBusy || bulkNeedsSave) return;
  bulkInput.value = ''; bulkMovedItems = {};
  saveBulkInput();
  bulkResult.textContent = '已清除批次輸入；購物車保留。';
  bulkInput.focus();
});
bulkToListBtn.addEventListener('click', async () => {
  if (!canChangeBulk()) return;
  if (bulkNeedsSave) { await commitBulk(bulkToListBtn); return; }
  if (!cart.length) {
    bulkResult.textContent = '購物車目前沒有商品；可先在清單輸入商品，再按「清單 → 購物車」。'; return;
  }
  const lines = cart.map(item => `${item.code},${item.quantity}`);
  for (const item of cart) bulkMovedItems[item.code] = { ...item };
  bulkInput.value = [bulkInput.value.trim(), ...lines].filter(Boolean).join('\n');
  const count = cart.length;
  cart = [];
  updateCartDisplay(); calculateTotal();
  bulkSavedMessage = `已將購物車 ${count} 筆商品移至清單，購物車暫時清空；回填可繼續結帳。`;
  bulkNeedsSave = true;
  await commitBulk(bulkToListBtn);
  bulkInput.focus();
});
bulkBackupBtn.addEventListener('click', async () => {
  if (!canChangeBulk()) return;
  if (bulkNeedsSave) { await commitBulk(bulkBackupBtn); return; }
  let success = 0, quantity = 0;
  const failed = [], acceptedCodes = new Set();
  if (!bulkNeedsSave) {
    const lines = (bulkInput.value || '').split(/\r?\n/);
    if (!lines.some((line) => line.trim())) {
      bulkResult.textContent = '請先輸入商品代碼與數量，例如 C001,2，再按「清單 → 購物車」。';
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
      } else {
        const moved = bulkMovedItems[product.code];
        const item = cart.find(item => item.code === product.code);
        if (!existing && moved && item) Object.assign(item, moved, { quantity: item.quantity });
        acceptedCodes.add(product.code);
        success++; quantity += parsed.qty;
      }
    });
    if (!success) {
      bulkResult.textContent = '尚未回填。' + failed.map((f) => f.message).join('；'); return;
    }
    // Remove only accepted input so another click cannot duplicate those lines.
    bulkInput.value = failed.map((f) => f.line).join('\n');
    for (const code of acceptedCodes) {
      if (!failed.some(f => products[parseBulkLine(f.line)?.code]?.code === code)) delete bulkMovedItems[code];
    }
    updateCartDisplay();
    calculateTotal();
    bulkNeedsSave = true;
  }
  bulkSavedMessage = `已回填 ${success} 筆（${quantity} 件）至購物車。` + (failed.length ? '未加入：' + failed.map((f) => f.message).join('；') : '');
  await commitBulk(bulkBackupBtn);
});
