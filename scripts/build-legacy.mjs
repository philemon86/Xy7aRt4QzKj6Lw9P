import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
let html = fs.readFileSync(path.join(root, 'legacy/index.html'), 'utf8');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const core = read('lib/pos-core.mjs').replace(/^export /gm, '');
fs.writeFileSync(
  path.join(root, 'public/pos-core.js'),
  `window.POSCore=(()=>{${core}\nreturn {resolveProductPricing,editCartItem,evaluateExpression,insertOperand,createScanGate};})();\n`,
);
const start = html.indexOf('(function (root, factory)');
const end = html.indexOf('</script>', start);
fs.mkdirSync(path.join(root, 'legacy'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'legacy/pilot-exporter.cjs'),
  html.slice(start, end),
);
const legacyPilot = html.slice(start, end);
const factoryStart =
  legacyPilot.indexOf('function () {') + 'function () {'.length;
const factoryEnd = legacyPilot.lastIndexOf('});');
fs.writeFileSync(
  path.join(root, 'lib/pilot-core.mjs'),
  'export default (function () {' +
    legacyPilot.slice(factoryStart, factoryEnd) +
    '})();\n',
);
html = html.replace(
  '<title>腓利門雲POS</title>',
  '<title>腓利門 POS V2 收銀台</title><link rel="stylesheet" href="/checkout.css"><script src="/bridge.js"></script><script src="/pos-core.js"></script>',
);
html = html
  .replace('<link rel="stylesheet" href="/checkout.css">', '')
  .replace('</head>', '<link rel="stylesheet" href="/checkout.css"></head>');
html = html.replace(
  "document.addEventListener('DOMContentLoaded', () => {",
  "document.addEventListener('DOMContentLoaded', async () => {\n      let cloud; try { cloud=await window.makeCloud(); } catch(error) { document.body.textContent=error.message; parent.postMessage({type:'register-error'},location.origin); return; }\n      const localStorage=cloud.storage;\n      const isBookstore=cloud.me.role==='admin';\n      const displayOrderNumber=order=>cloud.numbers[order?.id] || '正在編號';\n",
);
const loadStart = html.indexOf('      const loadMasterData = async () => {');
const loadEnd = html.indexOf('      const getSpecialDiscount', loadStart);
html =
  html.slice(0, loadStart) +
  `      const loadMasterData = async () => {
        const data=cloud.catalog;unitMap=data.units;clasMap=data.classes;kindMap=data.kinds;customerMap=Object.fromEntries(data.customers.map(c=>[c.code,c]));
        customerOptions.replaceChildren(...data.customers.map(c=>{const option=document.createElement('option');option.value=formatCustomerOption(c);return option;}));
        products={};for(const source of data.products){const p=POSCore.resolveProductPricing(source);products[p.code]=p;if(p.barcode)products[p.barcode]=p;if(p.webBarcode&&!products[p.webBarcode])products[p.webBarcode]=p;}
        dbStatusElement.textContent=data.products.length+' 件商品 · 價格已快取';
        if(!cloud.catalogLoaded)invoiceCustomerInput.value=cloud.event.tenant?formatCustomerOption(customerMap[cloud.event.tenant.toUpperCase()]):'';syncInvoiceCustomerVisibility();cloud.catalogLoaded=true;
      };
      cloud.onCatalogUpdate=async()=>{await loadMasterData();renderSearch();renderFavorites();};
` +
  html.slice(loadEnd);
const discountStart = html.indexOf('      const getSpecialDiscount =');
const discountEnd = html.indexOf('      const resetIdleTimer', discountStart);
html =
  html.slice(0, discountStart) +
  '      const getSpecialDiscount = () => undefined;\n      const calculateItemDiscount = item => item.isManual ? item.discount : (item.defaultDiscount ?? 100);\n' +
  html.slice(discountEnd);
// Preset specials remain automatic; manual edits always take precedence.
html = html.replace(
  /          if \(getSpecialDiscount\(newItem\) !== undefined\) \{[\s\S]*?\n          \}/g,
  '',
);
const cartStart = html.indexOf('      const updateCartDisplay = () => {');
const cartEnd = html.indexOf('      const calculateCartTotal', cartStart);
html =
  html.slice(0, cartStart) +
  read('scripts/register-cart.js') +
  '\n' +
  html.slice(cartEnd);
const scanStart = html.indexOf("      scanForm.addEventListener('submit'");
const scanEnd = html.indexOf('      const parseBulkLine', scanStart);
html = html.slice(0, scanStart) + html.slice(scanEnd);
const searchStart = html.indexOf(
  "      productCodeInput.addEventListener('input'",
);
const searchEnd = html.indexOf(
  '      const calculatePaymentStats',
  searchStart,
);
html =
  html.slice(0, searchStart) +
  read('scripts/register-search.js') +
  '\n' +
  html.slice(searchEnd);
html = html.replace(
  "      document.addEventListener('keydown', (e) => {",
  "      document.addEventListener('keydown', (e) => {\n        if(document.querySelector('dialog[open]') || document.body.dataset.view!=='checkout')return;",
);
html = html.replace(
  '        sysCashTotalEl.textContent = stats.cash;',
  "        sysCashTotalEl.textContent = stats.cash;\n        parent.postMessage({type:'cash-total',amount:stats.cash},location.origin);",
);
html = html.replace('今日銷售總覽', '本場銷售總覽');
html = html.replace(
  "return `${y}${m}${day}-${String(clientCounter).padStart(3,'0')}`;",
  'return `${y}${m}${day}-${crypto.randomUUID()}`;',
);
html = html.replace(
  '      const performCheckout = (paymentMethod, isComposite = false) => {',
  "      let checkoutBusy=false;\n      const performCheckout = async (paymentMethod, isComposite = false) => {\n        if(checkoutBusy || cloud.event.status!=='open'||(isBookstore&&cloud.event.organizer==='church'))return;\n        if(cloud.recoveryError){parent.postMessage({type:'resolve-recovery'},location.origin);return;}\n        if(!isBookstore && /信用卡|現金/.test(paymentMethod)){alert('教會僅開放文化幣與 LINE PAY');return;}",
);
html = html.replace(
  /        POSAudio.success\(\);\s*(?=clients\[clientId\] = \{)/,
  '        ',
);
html = html.replace(
  '          transactionId: clientId,',
  '          transactionId: clientId,\n          createdAt: new Date().toISOString(),',
);
const checkoutMarker = '        cart.forEach(item => {';
const pos = html.indexOf(checkoutMarker, html.indexOf('const performCheckout'));
html =
  html.slice(0, pos) +
  `        checkoutBusy=true;checkoutBtns.forEach(b=>b.disabled=true);document.body.dataset.checkout='saving';let checkoutSaved=false;
        try { localStorage.setItem('cart','[]'); saveSummary(); await cloud.flush(); checkoutSaved=true;POSAudio.success(); } catch(error) { const cover=document.createElement('div');cover.className='retry-cover';const p=document.createElement('p');p.textContent='結帳等待雲端確認。請勿重新收款。'+error.message;const btn=document.createElement('button');btn.textContent='重試儲存';btn.onclick=async()=>{btn.disabled=true;try{await cloud.flush();location.reload();}catch(e){p.textContent=e.message;btn.disabled=false;}};cover.append(p,btn);document.body.append(cover);return; } finally {checkoutBusy=!checkoutSaved;checkoutBtns.forEach(b=>b.disabled=!checkoutSaved);document.body.dataset.checkout=checkoutSaved?'saved':'failed';}
` +
  html.slice(pos);
// Reserve globally unique, server-persistent ERI ranges; preserve exporter allocation rules.
const eriStart = html.indexOf('      function nextPilotEriSuffix() {');
const eriEnd = html.indexOf('      function generateERI', eriStart);
html =
  html.slice(0, eriStart) +
  '      function nextPilotEriSuffix() { return cloud.nextEri(); }\n' +
  html.slice(eriEnd);
html = html.replace(
  'async function exportPilot(options = {}) {',
  "async function exportPilot(options = {}) {\n  if(!isBookstore){alert('請由書房匯出');return;}\n  await cloud.flush(); await cloud.reserve(1024+Object.values(clients).reduce((s,c)=>s+(c.items||[]).length*12,0));",
);
// Keep internal IDs and Pilot ERI intact; human-facing shipment numbers come from D1.
html = html.replaceAll(
  '單號：${client.id}',
  '出貨單號：${displayOrderNumber(client)}',
);
html = html.replaceAll(
  '>${client.id}</a>',
  '>${displayOrderNumber(client)}</a>',
);
html = html.replaceAll('`${client.id}`', '`${displayOrderNumber(client)}`');
html = html.replace(
  '訂單：${clientId}',
  '出貨單：${displayOrderNumber(client)}',
);
html = html.replaceAll('訂單編號', '出貨單號');
html = html.replace(
  '<th>單號</th><th>金額</th><th>付款</th><th>操作</th>',
  '<th>出貨單號</th><th>日期</th><th>金額</th><th>付款方式</th><th>操作</th>',
);
html = html.replace(
  '<td>${Math.round(client.amount)}</td>',
  '<td>${client.createdAt?new Date(client.createdAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false}):String(client.id).slice(0,8)}</td><td>${Math.round(client.amount)}</td>',
);
html = html.replace('(作廢 / 刪除 / 修改付款)', '(刪除 / 修改內容)');
html = html.replace(
  'Object.values(clients).sort((a,b) => b.id.localeCompare(a.id))',
  'Object.values(clients).sort((a,b) => String(b.createdAt||b.id).localeCompare(String(a.createdAt||a.id)))',
);
html = html.replace(
  '<td><button class="btn-change-pay" data-client-id="${client.id}">${method}</button></td>',
  '<td>${method}</td>',
);
html = html
  .split('\n')
  .map((line) =>
    line.includes('${client.isValid ? `<button class="btn-void"')
      ? '              <button class="btn-edit-order" data-client-id="${client.id}">修改</button>'
      : line,
  )
  .join('\n');
const historyStart = html.indexOf('      const attachHistoryEvents = () => {');
const historyEnd = html.indexOf('      window.openPaymentModal', historyStart);
html =
  html.slice(0, historyStart) +
  read('scripts/register-history.js') +
  '\n' +
  html.slice(historyEnd);
html = html.replace(
  'if (validCount > 0 && validCount % 20 === 0)',
  'if (isBookstore && validCount > 0 && validCount % 20 === 0)',
);
html = html.replace(
  "exportCsvBtn.addEventListener('click', async () => {",
  "exportCsvBtn.addEventListener('click', async () => {\n  if(!isBookstore){alert('請由書房匯出');return;}",
);
// Church split payments use LINE PAY for the remainder, while bookstore keeps its cash flow.
html = html.replace(
  '  const cashAmount = totalAmount - coinAmount;',
  "  const cashAmount = totalAmount - coinAmount;\n  const remainderMethod=isBookstore?'現金':'LINE PAY';",
);
html = html.replace(
  '`文化幣(${coinAmount}) + 現金(${cashAmount})`',
  '`文化幣(${coinAmount}) + ${remainderMethod}(${cashAmount})`',
);
html = html.replace(
  'else methodStr = `現金(${totalAmount})`;',
  'else methodStr = `${remainderMethod}(${totalAmount})`;',
);
// Import remains available, but await durable storage before reload.
html = html.replace(
  'reader.onload = (event) => {',
  'reader.onload = async (event) => {',
);
html = html.replace(
  '            if (data.clients) {',
  `            if (data.clients) {
              for(const client of Object.values(data.clients)){client.items=(client.items||[]).map(i=>({...i,price:Number(i.price||0),quantity:Number(i.quantity||0),discount:i.discount===undefined?100:Number(i.discount)}));if(Number(client.amount)===0&&calculateCartTotal(client.items)!==0)client.amount=calculateCartTotal(client.items);client.amount=Number(client.amount);client.paymentRecords=PilotExporter.getPaymentRecords(client);}
`,
);
html = html.replace(
  "              alert('還原成功！');",
  "              await cloud.flush();\n              alert('還原成功！');",
);
html = html.replace(
  "document.getElementById('clear-all-btn').onclick = () => {",
  "document.getElementById('clear-all-btn').onclick = async () => {",
);
html = html.replace(
  "          alert('資料已清空，系統將重新載入。ERI 流水號已保留。');",
  "          await cloud.flush();\n          alert('本場資料已清空。雲端修訂紀錄仍保留。');",
);
html = html.replace(
  "        if (confirm('確定要刪除全部訂單？(將清除所有資料並重整)')) {",
  "        if (confirm('確定要清空本場工作資料？雲端修訂紀錄會保留。')) {",
);
html = html.replace(
  '【警告】這將完全刪除此筆資料，無法復原。確定要刪除嗎？',
  '確定刪除此筆訂單？雲端修訂紀錄會保留。',
);
// Preserve existing totals and operations, reshape the working surface into focused views.
const exportStart = html.indexOf('async function exportPilot(options = {}) {');
const exportEnd = html.indexOf('// ===== 啟動 =====', exportStart);
if (exportStart < 0 || exportEnd < 0) throw Error('找不到既有 PILOT 匯出接點');
html =
  html.slice(0, exportStart) +
  read('scripts/register-pilot.js') +
  '\n\n' +
  html.slice(exportEnd);
html = html.replace(/doBackup\(\);\s*exportPilot\(\);/, 'doBackup();');
html = html.replace(
  '<body>',
  '<body data-view="checkout"><div id="cloud-status" role="status">正在連接雲端…</div>',
);
html = html.replace(
  'loadMasterData().then(() => {',
  `loadMasterData().then(() => {
  const groups=[...document.querySelectorAll('body > .flex-container')];groups.forEach((el,i)=>el.dataset.section=['checkout','history','accounting','exports'][i]);
  document.body.dataset.audience=cloud.me.role==='church'||cloud.event.organizer==='church'?'church':'bookstore';
  document.body.dataset.role=cloud.me.role;
  if(!isBookstore){btnF7.hidden=true;btnF10.hidden=true;document.querySelector('.payment-details').hidden=true;document.querySelector('[data-section="exports"]').hidden=true;document.querySelector('#pay-cash').closest('.pay-badge').hidden=true;document.querySelector('#pay-credit').closest('.pay-badge').hidden=true;}
  document.querySelector('#title').textContent='加入商品';
  document.querySelector('#current-date').closest('.header').hidden=true;
  document.querySelector('label[for="product-code"]').textContent='掃條碼，或輸入名稱、代碼';
  productCodeInput.placeholder='條碼 / 名稱 / 商品代碼';productCodeInput.style.textTransform='none';productCodeInput.setAttribute('aria-controls','search-results');productCodeInput.setAttribute('aria-label','掃描條碼或搜尋商品');productCodeInput.setAttribute('enterkeyhint','search');
  scanForm.querySelector('button').textContent='加入 / 搜尋';
  cloud.unlockAudio=()=>POSAudio.ctx.resume().catch(()=>{});
  const cameraButton=document.createElement('button');cameraButton.type='button';cameraButton.className='scan-camera-btn';cameraButton.textContent='相機';cameraButton.onclick=()=>{cloud.unlockAudio();parent.postMessage({type:'open-camera'},location.origin);};scanForm.append(cameraButton);
  productInfoElement.removeAttribute('style');productInfoElement.setAttribute('role','status');productInfoElement.textContent='掃描後按 Enter 加入，支援連續掃描。';
  scanForm.parentNode.append(searchResultsElement);document.querySelector('.search-container').hidden=true;
  const favoritesSection=document.createElement('section');favoritesSection.className='favorites-section';favoritesSection.innerHTML='<div class="favorites-heading"><h2>常用商品</h2><span>本場雲端保存</span></div><div id="favorite-products"></div>';
  scanForm.closest('.container-half').insertBefore(favoritesSection,document.querySelector('.bulk-input'));
  readFavorites();renderFavorites();
  document.querySelector('.cart-table-shell .table-title').innerHTML='<span>本次結帳</span><small id="cart-count"></small>';
  document.querySelector('#cart-table thead').innerHTML='<tr><th>商品 / 單價</th><th>數量</th><th>小計</th><th></th></tr>';
  const cartHint=document.createElement('p');cartHint.className='cart-help';cartHint.textContent='點編輯或連點商品兩下，調整單價、數量與折扣。';document.querySelector('.cart-table-shell').append(cartHint);
  const invoice=document.querySelector('.invoice-input-row');const invoiceDetails=document.createElement('details');invoiceDetails.className='invoice-details';const invoiceSummary=document.createElement('summary');invoiceSummary.textContent='發票資訊 · 載具 / 捐贈 / 統編';invoiceDetails.append(invoiceSummary);invoice.parentNode.insertBefore(invoiceDetails,invoice);invoiceDetails.append(invoice,document.querySelector('.invoice-hint'));
  const printOption=document.querySelector('#print-enabled').closest('div');document.querySelector('.payment-qr-actions').append(printOption);
  document.querySelector('.invoice-hint').textContent='一般結帳可留白；輸入統編時請選擇發票教會。';
  document.querySelector('.payment-info').append(document.querySelector('.checkout-buttons-area'));
  const bulk=document.querySelector('.bulk-input');const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='批次輸入商品';details.append(summary);bulk.parentNode.insertBefore(details,bulk);details.append(bulk);
  window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent)return;if(e.data.type==='scan')addScannedProduct(e.data.code,true);});
  if(cloud.event.status!=='open'){document.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);document.querySelectorAll('#export-csv-btn,#export-pilot-btn,#backup-btn').forEach(el=>el.disabled=false);}
  cloud.onUpdate=()=>{clients=JSON.parse(localStorage.getItem('clients'));updateSummaryTable();readFavorites();renderFavorites();renderSearch();};
  const resize=new ResizeObserver(()=>parent.postMessage({type:'height',height:document.body.scrollHeight+24},location.origin));resize.observe(document.body);
  parent.postMessage({type:'register-ready'},location.origin);
`,
);
for (const name of [
  'LINEPAY.jpg',
  '文化幣.jpg',
  'LOGO.png',
  'favicon-cloud.svg',
])
  if (!fs.existsSync(path.join(root, 'public', name)))
    throw Error('缺少原收款圖片 ' + name);
fs.writeFileSync(path.join(root, 'public/register.html'), html);
console.log(
  'Legacy calculation and Pilot export core retained; cloud adapter generated.',
);
