import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
let html = fs.readFileSync(path.join(root, 'legacy/index.html'), 'utf8');
const start = html.indexOf('(function (root, factory)');
const end = html.indexOf('</script>', start);
fs.mkdirSync(path.join(root, 'legacy'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'legacy/pilot-exporter.cjs'),
  html.slice(start, end),
);
html = html.replace(
  '<title>腓利門雲POS</title>',
  '<title>腓利門 POS V2 收銀台</title><link rel="stylesheet" href="/register.css"><script src="/bridge.js"></script>',
);
html = html
  .replace('<link rel="stylesheet" href="/register.css">', '')
  .replace('</head>', '<link rel="stylesheet" href="/register.css"></head>');
html = html.replace(
  "document.addEventListener('DOMContentLoaded', () => {",
  "document.addEventListener('DOMContentLoaded', async () => {\n      let cloud; try { cloud=await window.makeCloud(); } catch(error) { document.body.textContent=error.message; return; }\n      const localStorage=cloud.storage;\n",
);
const loadStart = html.indexOf('      const loadMasterData = async () => {');
const loadEnd = html.indexOf('      const getSpecialDiscount', loadStart);
html =
  html.slice(0, loadStart) +
  `      const loadMasterData = async () => {
        const data=cloud.catalog;unitMap=data.units;clasMap=data.classes;kindMap=data.kinds;customerMap=Object.fromEntries(data.customers.map(c=>[c.code,c]));
        customerOptions.replaceChildren(...data.customers.map(c=>{const option=document.createElement('option');option.value=formatCustomerOption(c);return option;}));
        products={};for(const source of data.products){const p={...source};if(cloud.event.pricing==='website'&&p.websitePrice!==null&&p.websitePrice!==undefined){p.price=p.websitePrice;p.defaultDiscount=100;p.websiteBase=true;}products[p.code]=p;if(p.barcode)products[p.barcode]=p;if(p.webBarcode&&!products[p.webBarcode])products[p.webBarcode]=p;}
        dbStatusElement.textContent=data.products.length+' 件商品 · '+(cloud.event.pricing==='website'?'官網售價':'原書展折扣');
        invoiceCustomerInput.value=cloud.event.tenant?formatCustomerOption(customerMap[cloud.event.tenant.toUpperCase()]):'';syncInvoiceCustomerVisibility();
      };
` +
  html.slice(loadEnd);
html = html.replace(
  '        const special = getSpecialDiscount(item);',
  '        if(item.websiteBase && !item.isManual && sessionRules[item.class]===undefined)return 100;\n        const special = getSpecialDiscount(item);',
);
html = html.replace(
  '        if (!item) return undefined;',
  '        if (!item || item.websiteBase) return undefined;',
);
html = html.replace(
  "return `${y}${m}${day}-${String(clientCounter).padStart(3,'0')}`;",
  'return `${y}${m}${day}-${crypto.randomUUID()}`;',
);
html = html.replace(
  '      const performCheckout = (paymentMethod, isComposite = false) => {',
  '      let checkoutBusy=false;\n      const performCheckout = async (paymentMethod, isComposite = false) => {\n        if(checkoutBusy)return;',
);
html = html.replace(
  '        POSAudio.success();\n\n        clients[clientId] = {',
  '        clients[clientId] = {',
);
html = html.replace(
  '          transactionId: clientId,',
  '          transactionId: clientId,\n          createdAt: new Date().toISOString(),',
);
const checkoutMarker = '        cart.forEach(item => {';
const pos = html.indexOf(checkoutMarker, html.indexOf('const performCheckout'));
html =
  html.slice(0, pos) +
  `        checkoutBusy=true;checkoutBtns.forEach(b=>b.disabled=true);
        try { localStorage.setItem('cart','[]'); saveSummary(); await cloud.flush(); POSAudio.success(); } catch(error) { const cover=document.createElement('div');cover.className='retry-cover';const p=document.createElement('p');p.textContent='結帳等待雲端確認。請勿重新收款。'+error.message;const btn=document.createElement('button');btn.textContent='重試儲存';btn.onclick=async()=>{btn.disabled=true;try{await cloud.flush();location.reload();}catch(e){p.textContent=e.message;btn.disabled=false;}};cover.append(p,btn);document.body.append(cover);return; } finally {checkoutBusy=false;checkoutBtns.forEach(b=>b.disabled=false);}
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
  'async function exportPilot(options = {}) {\n  await cloud.flush(); await cloud.reserve(1024+Object.values(clients).reduce((s,c)=>s+(c.items||[]).length*12,0));',
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
html = html.replace(
  '<body>',
  '<body data-view="checkout"><div id="cloud-status" role="status">正在連接雲端…</div>',
);
html = html.replace(
  'loadMasterData().then(() => {',
  `loadMasterData().then(() => {
  const groups=[...document.querySelectorAll('body > .flex-container')];groups.forEach((el,i)=>el.dataset.section=['checkout','history','accounting','exports'][i]);
  document.querySelector('#title').textContent='掃描與搜尋';
  const bulk=document.querySelector('.bulk-input');const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='批次輸入商品';details.append(summary);bulk.parentNode.insertBefore(details,bulk);details.append(bulk);
  window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent)return;if(e.data.type==='scan'){const code=String(e.data.code).toUpperCase();if(products[code]){addProductToCart(code);productInfoElement.textContent='已加入：'+products[code].name;}else productInfoElement.textContent='找不到商品：'+code;}if(e.data.type==='close'){cloud.close(e.data.day,e.data.counts,e.data.expenses,e.data.notes).then(()=>parent.postMessage({type:'closed'},location.origin)).catch(error=>alert(error.message));}});
  if(cloud.event.status!=='open'){document.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);document.querySelectorAll('#export-csv-btn,#export-pilot-btn,#backup-btn').forEach(el=>el.disabled=false);}
  cloud.onUpdate=()=>{clients=JSON.parse(localStorage.getItem('clients'));updateSummaryTable();};
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
