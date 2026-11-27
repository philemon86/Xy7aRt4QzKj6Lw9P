(function batchBooks(){
 'use strict';
 const $=id=>document.getElementById(id);
 const norm=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const title=p=>norm(String(p.name||'').replace(/^\s*\d+折\s*\/?/,'').replace(/[（(][^）)]*[）)]/g,''));
 function longest(a,b){let best=0,prev=new Uint16Array(b.length+1);for(let i=1;i<=a.length;i++){const cur=new Uint16Array(b.length+1);for(let j=1;j<=b.length;j++)if(a[i-1]===b[j-1]){cur[j]=prev[j-1]+1;best=Math.max(best,cur[j]);}prev=cur;}return best;}
 function lcs(a,b){let prev=new Uint16Array(b.length+1);for(const x of a){const cur=new Uint16Array(b.length+1);for(let j=1;j<=b.length;j++)cur[j]=x===b[j-1]?prev[j-1]+1:Math.max(prev[j],cur[j-1]);prev=cur;}return prev[b.length];}
 function candidateRank(list,texts){
  const phrases=[...new Set(texts.map(norm).filter(x=>x.length>=2&&x.length<=110))];
  const out=[];
  for(const p of list){
   const n=title(p);if(n.length<2)continue;const main=norm(String(p.name||'').replace(/^\s*\d+折\s*\/?/,'').split(/[-－—：:／]/)[0]);let score=0,why='';
   for(const q of phrases){
    if(q===norm(p.code)||q===norm(p.barcode)&&norm(p.barcode).length>=8){score=120;why='代碼／ISBN';break;}
    if(n.length>=3&&q.includes(n)){if(score<100){score=100;why='完整書名';}continue;}
    if(main.length>=4&&main!==n&&q.includes(main)){if(score<86){score=86;why='主書名';}continue;}
    if(n.length<4||q.length<3)continue;
    const common=longest(q,n), cover=lcs(q,n)/n.length;
    const value=common>=3&&cover>=.48?Math.min(88,Math.round(cover*55+Math.min(1,common/n.length)*35)):0;
    if(value>score){score=value;why='部分書名';}
   }
   if(score>=43)out.push({p,score,why});
  }
  return out.sort((a,b)=>b.score-a.score||b.p.name.length-a.p.name.length||a.p.code.localeCompare(b.p.code)).slice(0,5);
 }
 function boxFrom(item,w,h,angle){
  const pts=item.poly||item.box||item.points;
  if(!Array.isArray(pts)||!pts.length||!pts.every(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])))return null;
  let xy=pts.map(([x,y])=>angle===90?[y,h-x]:angle===270?[w-y,x]:angle===180?[w-x,h-y]:[x,y]);
  const xs=xy.map(p=>p[0]),ys=xy.map(p=>p[1]);
  const x0=Math.min(...xs)/w,x1=Math.max(...xs)/w,y0=Math.min(...ys)/h,y1=Math.max(...ys)/h;
  if(x1<=x0||y1<=y0)return null;
  return {x0,x1,y0,y1,x:(x0+x1)/2,y:(y0+y1)/2,text:String(item.text||'').trim(),angle};
 }
 function bands(boxes,axis='y'){
  const key=axis,lo=axis+'0',hi=axis+'1',other=axis==='y'?'x':'y';
  const sorted=boxes.filter(b=>norm(b.text).length>=1).sort((a,b)=>a[key]-b[key]);
  const rows=[];
  for(const b of sorted){
   const size=b[hi]-b[lo];
   let best=null,dist=Infinity;
   for(const g of rows){
    const d=Math.abs(g.center-b[key]), limit=Math.max(.0035,Math.min(.022,Math.max(g.size,size)*.58));
    if(d<=limit&&d<dist){best=g;dist=d;}
   }
   if(best){best.boxes.push(b);best.center=best.boxes.reduce((v,x)=>v+x[key],0)/best.boxes.length;best.size=Math.max(best.size,size);}
   else rows.push({center:b[key],size,boxes:[b]});
  }
  return rows.sort((a,b)=>a.center-b.center).map(g=>{
   const phrases=[];
   for(const angle of new Set(g.boxes.map(b=>b.angle))){const bs=g.boxes.filter(b=>b.angle===angle).sort((a,b)=>a[other]-b[other]);const texts=bs.map(b=>b.text);phrases.push(...texts,texts.join(''),[...texts].reverse().join(''));}
   return {center:g.center,texts:[...new Set(phrases.filter(Boolean))],raw:[...new Set(g.boxes.map(b=>b.text))].join(' ／ ')};
  });
 }
 // A standalone review page, no nested scrolling and no automatic order mutation.
 let rows=[],bookList=[],busy=false,generation=0,photo=null,manualQuery='',returnY=0,added=false;
 const css=`.batch-book-btn{font:inherit;background:#fff;color:var(--blue);border:1px solid var(--line);border-radius:8px;padding:7px 12px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}.batch-book-page{display:none;max-width:880px;margin:0 auto;padding:16px 13px 30px;min-height:100dvh;color:var(--black)}body.batch-book-open>.shell{display:none!important}body.batch-book-open>.batch-book-page{display:block}body.batch-book-open{overflow:visible!important;height:auto!important}.batch-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px}.batch-head h2{font-size:21px}.batch-status{font-size:13px;color:var(--gray);line-height:1.65;margin:10px 0}.batch-row{background:white;border:1px solid var(--line);border-radius:10px;margin:7px 0;padding:11px;display:flex;flex-direction:column;gap:7px}.batch-row.good{border-left:3px solid var(--blue)}.batch-row label{font-size:12px;color:var(--gray)}.batch-row select,.batch-manual input,.batch-row input{font:inherit;font-size:15px;color:var(--black);border:1px solid var(--line);padding:9px;border-radius:7px;background:white;min-width:0}.batch-row select{width:100%}.batch-row .batch-raw{font-size:11px;color:var(--gray);line-height:1.5;overflow-wrap:anywhere}.batch-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.batch-actions button{flex:1;min-height:42px}.batch-primary{background:var(--blue);color:white;border:0;border-radius:9px;padding:10px 13px;font-weight:750;font-size:14px;cursor:pointer}.batch-primary:disabled{opacity:.45}.batch-manual{display:flex;gap:8px;align-items:center;margin:10px 0}.batch-manual input{flex:1;width:100%}.batch-summary{font-size:14px;line-height:1.6;background:var(--blue-soft);padding:12px;border-radius:9px;margin:10px 0}.batch-summary strong{color:var(--blue)}.batch-photo{display:block;max-height:220px;max-width:100%;object-fit:contain;margin:8px auto;border-radius:8px}.batch-detail{font-size:12px;color:var(--gray);margin:10px 0}.batch-manual-results button{display:block;text-align:left;width:100%;margin:5px 0}.batch-num{display:flex;align-items:center;gap:8px}.batch-num input{width:80px}.batch-review-title{font-size:15px;font-weight:750;margin-top:18px}.batch-preview-toggle{font-size:12px;color:var(--gray);cursor:pointer}.batch-entry{display:flex;justify-content:flex-end;margin:2px 0}.batch-entry button{width:auto}@media(min-width:900px){.batch-entry{justify-content:flex-start}}`;
 const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
 document.querySelector('.dock-wrap').insertAdjacentHTML('beforeend','<div class="batch-entry"><button type="button" class="batch-book-btn" id="batchBookStart">整疊書辨識</button></div>');
 document.body.insertAdjacentHTML('beforeend','<input type="file" accept="image/*" id="batchBookFile" hidden><main class="batch-book-page" id="batchBookPage"><div class="batch-head"><h2>整疊書辨識</h2><button type="button" class="batch-book-btn" id="batchBack">返回搜尋</button></div><div id="batchStatus" class="batch-status" role="status"></div><div class="batch-actions"><button type="button" class="batch-book-btn" id="batchChoose">選擇／拍攝照片</button><button type="button" class="batch-book-btn" id="batchRetry" hidden>重新辨識</button></div><label class="batch-detail"><input type="checkbox" id="batchOrientation"> 換方向辨識（書脊排列方向不符時勾選後重試）</label><details id="batchPhotoDetails" hidden><summary class="batch-preview-toggle">查看原始照片</summary><img id="batchPhoto" class="batch-photo" alt="待辨識的書本照片"></details><div id="batchResults"></div><div id="batchManual" hidden><div class="batch-review-title">補上漏讀的書</div><div class="batch-manual"><input id="batchManualQuery" placeholder="書名或商品代碼" autocomplete="off"></div><div class="batch-manual-results" id="batchManualResults"></div></div><div id="batchSummary"></div><div class="batch-actions"><button type="button" class="batch-primary" id="batchAdd" disabled>確認並加入訂單</button></div></main>');
 function open(){returnY=window.scrollY;document.body.classList.add('batch-book-open');window.scrollTo(0,0);if(!photo)$('batchStatus').textContent='一次拍下多本書的書脊或封面。先辨識，再確認品項與數量；照片在瀏覽器內處理。';}
 function close(){generation++;document.body.classList.remove('batch-book-open');window.scrollTo(0,returnY);}
 function choices(){const counts=new Map();for(const row of rows)if(row.code&&row.qty>0)counts.set(row.code,(counts.get(row.code)||0)+row.qty);return [...counts].map(([code,qty])=>({code,qty}));}
 function updateSummary(){const list=choices();$('batchSummary').innerHTML=list.length?'<div class="batch-summary"><strong>'+list.length+' 種商品・'+list.reduce((n,p)=>n+p.qty,0)+' 本</strong><div class="batch-detail">加入現有訂單前請確認重複書本數量。選取的是辨識結果，不是庫存盤點。</div>'+list.map(x=>'<div>'+esc(x.code+' '+(bookList.find(p=>p.code===x.code)?.name||'')+' × '+x.qty)+'</div>').join('')+'</div>':'';$('batchAdd').disabled=busy||added||!list.length;}
 function renderRows(){const strong=rows.filter(x=>x.code).length;$('batchResults').innerHTML=rows.length?'<div class="batch-review-title">辨識候選區域 '+rows.length+' 個・已選 '+strong+' 個</div>'+rows.map((row,i)=>'<div class="batch-row '+(row.code?'good':'')+'"><label>區域 '+(i+1)+(row.manual?'・手動補入':'')+'</label><select data-batch-row="'+i+'" aria-label="區域 '+(i+1)+' 商品"><option value="">略過／未確認</option>'+row.options.map(x=>'<option value="'+esc(x.p.code)+'" '+(row.code===x.p.code?'selected':'')+'>'+esc(x.p.code+' '+x.p.name+'（'+x.why+'）')+'</option>').join('')+'</select><div class="batch-num"><label>數量</label><input type="number" min="0" max="9999" inputmode="numeric" data-batch-qty="'+i+'" value="'+row.qty+'"></div>'+(row.raw?'<div class="batch-raw">讀到：'+esc(row.raw.slice(0,180))+'</div>':'')+'</div>').join(''):'<p class="batch-status">尚無可確認候選，請補入書名或重拍。</p>';$('batchManual').hidden=false;updateSummary();}
 async function bitmap(file){const url=URL.createObjectURL(file);try{const im=new Image();await new Promise((resolve,reject)=>{im.onload=resolve;im.onerror=reject;im.src=url;});const scale=Math.min(1,1800/Math.max(im.naturalWidth,im.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(im.naturalWidth*scale));canvas.height=Math.max(1,Math.round(im.naturalHeight*scale));canvas.getContext('2d').drawImage(im,0,0,canvas.width,canvas.height);return canvas;}finally{URL.revokeObjectURL(url);}}
 async function asBlob(canvas,angle){const c=document.createElement('canvas');c.width=angle%180?canvas.height:canvas.width;c.height=angle%180?canvas.width:canvas.height;const ctx=c.getContext('2d');if(angle===90){ctx.translate(c.width,0);ctx.rotate(Math.PI/2);}else if(angle===180){ctx.translate(c.width,c.height);ctx.rotate(Math.PI);}else if(angle===270){ctx.translate(0,c.height);ctx.rotate(-Math.PI/2);}ctx.drawImage(canvas,0,0);return new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(Error('無法處理照片')),'image/jpeg',.94));}
 async function run(file){
  if(busy||ocrBusy){showToast('已有辨識正在執行');return;}
  bookList=products.filter(p=>/^C\d{3}$/i.test(p.code)&&Number(p.code.slice(1))>=1&&Number(p.code.slice(1))<=300&&p.name);
  if(!bookList.length){$('batchStatus').textContent='商品資料未載入，請返回重新整理。';return;}
  photo=file;busy=true;ocrBusy=true;added=false;rows=[];const gen=++generation,started=performance.now();
  const old=$('batchPhoto').src;if(old.startsWith('blob:'))URL.revokeObjectURL(old);$('batchPhoto').src=URL.createObjectURL(file);$('batchPhotoDetails').hidden=false;$('batchRetry').hidden=true;$('batchResults').innerHTML='';$('batchManual').hidden=true;$('batchSummary').innerHTML='';$('batchAdd').disabled=true;
  $('batchStatus').textContent='載入辨識模型，準備逐區讀取書名…';
  try{
   const canvas=await bitmap(file),w=canvas.width,h=canvas.height,all=[];
   const vertical=h>w;const alternate=$('batchOrientation').checked;const rotate=vertical!==alternate;const angles=rotate?[90,270]:[0,180];
   let engine=null;try{engine=await limitOCR(preparePaddle(),45000);}catch(e){console.warn(e);}
   for(const angle of angles){
    if(gen!==generation)return;
    $('batchStatus').textContent=angle===angles[0]?'讀取第一方向書脊…':'補讀反向書脊…';
    const blob=await asBlob(canvas,angle);
    if(engine){try{const [result]=await engine.predict(blob,{textDetLimitSideLen:1600,textDetLimitType:'max',textDetMaxSideLimit:1800,textDetThresh:.18,textDetBoxThresh:.38,textRecScoreThresh:.18});for(const item of result?.items||[]){const b=boxFrom(item,w,h,angle);if(b&&b.text)all.push(b);}}catch(e){console.warn(e);engine=null;}}
    if(!engine){const worker=await limitOCR(prepareTesseract(),45000);const result=await worker.recognize(blob);for(const line of result?.data?.lines||[]){const b=line.bbox;if(!b)continue;const v=boxFrom({text:line.text,poly:[[b.x0,b.y0],[b.x1,b.y0],[b.x1,b.y1],[b.x0,b.y1]]},w,h,angle);if(v&&v.text)all.push(v);}}
   }
   if(gen!==generation)return;
   // Long text boxes determine stack orientation. For a horizontal pile, cluster by Y; for standing spines, by X.
   const axis=rotate?'y':'x';
   rows=bands(all,axis).map(g=>{const options=candidateRank(bookList,g.texts),top=options[0],second=options[1];const strong=top&&(top.score>=100&&(!second||top.score>second.score)||top.score>=76&&(!second||top.score-second.score>=12));return {options,code:strong?top.p.code:'',qty:1,raw:g.raw,center:g.center};}).filter(g=>g.options.length||norm(g.raw).length>=4);
   $('batchStatus').textContent='完成 '+((performance.now()-started)/1000).toFixed(1)+' 秒。候選區域可能漏讀或重複，請核對每本書及數量；低可信度不預選。';
   renderRows();
  }catch(e){if(gen===generation){$('batchStatus').textContent='辨識未完成：'+String(e.message||e)+'。可重拍或手動補入。';renderRows();}}
  finally{busy=false;ocrBusy=false;if(gen===generation){$('batchRetry').hidden=false;updateSummary();}else{$('batchStatus').textContent='辨識已取消，可重新選擇照片。';$('batchRetry').hidden=false;updateSummary();}}
 }
 $('batchBookStart').addEventListener('click',()=>{open();$('batchBookFile').click();});
 $('batchChoose').addEventListener('click',()=>$('batchBookFile').click());
 $('batchBack').addEventListener('click',close);
 $('batchRetry').addEventListener('click',()=>{if(photo)run(photo);});
 $('batchBookFile').addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';if(f)run(f);});
 $('batchResults').addEventListener('change',e=>{const i=e.target.dataset.batchRow,j=e.target.dataset.batchQty;if(i!==undefined){rows[Number(i)].code=e.target.value;added=false;updateSummary();}if(j!==undefined){rows[Number(j)].qty=Math.max(0,Math.min(9999,Math.floor(Number(e.target.value)||0)));added=false;updateSummary();}});
 $('batchManualQuery').addEventListener('input',e=>{manualQuery=e.target.value;const q=norm(manualQuery);const matches=q?bookList.filter(p=>norm(p.code).includes(q)||norm(p.name).includes(q)).slice(0,10):[];$('batchManualResults').innerHTML=matches.map(p=>'<button class="batch-book-btn" type="button" data-batch-manual="'+esc(p.code)+'">'+esc(p.code+' '+p.name)+'</button>').join('');});
 $('batchManualResults').addEventListener('click',e=>{const code=e.target.closest('[data-batch-manual]')?.dataset.batchManual,p=bookList.find(p=>p.code===code);if(!p)return;rows.push({options:[{p,why:'手動選擇'}],code,qty:1,manual:true});added=false;$('batchManualQuery').value='';$('batchManualResults').innerHTML='';renderRows();});
 $('batchAdd').addEventListener('click',()=>{if(busy||added)return;const list=choices();if(!list.length||!window.FindBatchOrderAdd)return;if(window.FindBatchOrderAdd(list)){added=true;updateSummary();close();showToast('已加入 '+list.length+' 種書籍');}});
 window.FindBatchBookTest={candidateRank,bands,boxFrom};
})();
