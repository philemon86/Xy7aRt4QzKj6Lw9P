(function setupOrder(){
  'use strict';
  const $=id=>document.getElementById(id);
  const cats={all:'全部商品',bible:'聖經',books:'書籍',hymns:'讚美詩／樂譜',calendar:'月曆／週曆',gifts:'文創禮品',church:'教會用品'};
  const filters={size:'',version:'',material:'',zip:'',thumb:'',color:''};
  const facets={size:['尺寸',['袖珍／掌型','輕便型','中型','大字版','特大字版','大型（其他）','待核對','未確認']],version:['譯本',['和合本','新標點和合本','和合本修訂版','現代中文譯本','雙語／對照','其他／未確認']],material:['封面材質',['硬面／精裝','漆布','膠皮','皮面','布面','牛仔布','未確認']],zip:['拉鍊',['有','未標示']],thumb:['索引',['有','未標示']],color:['顏色',['黑色','藍色','紅色','咖啡色','紫色','綠色','未確認']]};
  const info={church:'',name:'',phone:'',address:'',tax:'',note:'',format:'name'};
  let category='',limit=30,detail=false,ready=false;
  const key='philemon-find-order-v4';
  try{const q=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(q))state.quote=q.filter(x=>x&&typeof x.code==='string'&&Number.isInteger(x.qty)&&x.qty>0&&x.qty<=9999).slice(0,500);}catch(e){}
  function save(){if(ready)try{localStorage.setItem(key,JSON.stringify(state.quote));}catch(e){}}
  function isBible(p){return p.clas==='01'}
  function spec(p){
    const n=p.name||'',c=String(p.code||'').toUpperCase();
    const model=(c.match(/^(?:CUNP(?:CS|PS|SS|IB)?|RCU|CU)\d+[A-Z0-9]*$/)||n.toUpperCase().match(/CUNP(?:CS|PS|SS|IB)?\d+[A-Z0-9]*/)||[])[0]||'';
    const m=model.match(/^(CUNP(?:CS|PS|SS|IB)?|RCU|CU)(\d+)([A-Z0-9]*)$/);
    let version=/和合本2010|和合修訂|和修本/.test(n)||m?.[1]==='RCU'?'和合本修訂版':/新標點|新標和合/.test(n)||m?.[1]?.startsWith('CUNP')?'新標點和合本':/現代中文/.test(n)?'現代中文譯本':/和合/.test(n)||m?.[1]==='CU'?'和合本':'其他／未確認';
    if(/對照|中英|\/ESV|NRSV\//.test(n+' '+c))version='雙語／對照';
    const explicit=/特大字/.test(n)?'特大字版':/大字/.test(n)?'大字版':/中型/.test(n)?'中型':/輕便/.test(n)?'輕便型':/袖珍|掌型/.test(n)?'袖珍／掌型':/大型/.test(n)?'大型（其他）':'';
    const implied=m&&m[2].length===2?({'3':'袖珍／掌型','5':'輕便型','6':'中型','8':'大字版','9':'特大字版'}[m[2][0]]||''):'';
    const conflict=!!(explicit&&implied&&explicit!==implied);
    const material=/漆布/.test(n)?'漆布':/牛仔布|牛仔/.test(n)?'牛仔布':/膠皮|膠面/.test(n)?'膠皮':/皮面|真皮/.test(n)?'皮面':/硬面|硬皮|精裝/.test(n)?'硬面／精裝':/布面/.test(n)?'布面':'未確認';
    const suffix=m?.[3]||'';
    const color=/藍/.test(n)||suffix.endsWith('BU')?'藍色':/紅色|紅皮/.test(n)||suffix.endsWith('RD')?'紅色':/咖啡|褐/.test(n)||suffix.endsWith('BR')?'咖啡色':/黑色|雅黑|紋黑/.test(n)||suffix.endsWith('BK')?'黑色':/紫/.test(n)||suffix.endsWith('PU')?'紫色':/綠/.test(n)||suffix.endsWith('GN')?'綠色':'未確認';
    return {size:conflict?'待核對':explicit||implied||'未確認',version,material,color,zip:/拉[鍊鏈]|拉链/.test(n)||suffix.includes('Z')?'有':'未標示',thumb:/索引/.test(n)||suffix.includes('TI')?'有':'未標示',conflict};
  }
  const memo=new WeakMap();
  function bs(p){if(!memo.has(p))memo.set(p,spec(p));return memo.get(p)}
  function summary(p){if(!isBible(p))return '';const b=bs(p);return [b.version,b.size,b.material,b.color,b.zip==='有'?'拉鍊':'',b.thumb==='有'?'索引':'',b.conflict?'名稱與型號尺寸不同，需核對':''].filter(x=>x&&x!=='未確認').join('／')}
  function match(p){
    const cl=p.clas||'',n=p.name||'';
    if(!category||category==='all')return true;
    if(category==='bible')return isBible(p)&&Object.entries(filters).every(([k,v])=>!v||bs(p)[k]===v);
    if(category==='books')return /^(02|03|07|08)-/.test(cl);
    if(category==='hymns')return /^05-/.test(cl)||/樂譜|琴譜/.test(n);
    if(category==='calendar')return /月曆|週曆|周曆|桌曆|年曆/.test(n);
    if(category==='gifts')return /^09-/.test(cl)&&!/月曆|週曆|周曆|桌曆|年曆/.test(n);
    if(category==='church')return /^04-/.test(cl)||cl==='11';
    return true;
  }
  function stock(p){return /絕版/.test(p.name+' '+p.spec)?'絕版／需確認':p.qty>0?'有庫存紀錄':'供貨待確認'}
  function findCode(code){return products.find(p=>p.code===code)}
  const oldBuild=buildIndex;
  buildIndex=function(list){oldBuild(list);list.forEach(p=>codeIndex.set(p.code.toLowerCase(),p));ready=list.length>0&&list.some(p=>p.clas);};
  const oldFilter=getFiltered;
  getFiltered=function(){
    if(ocrRaw)return oldFilter();
    const q=state.query.trim().toLowerCase();
    if(!q&&!category)return {items:[],totalHits:0};
    const words=q.split(/\s+/).filter(Boolean);
    const hits=products.filter(p=>match(p)&&(!words.length||p.code.toLowerCase()===q||p.barcode.toLowerCase()===q||words.every(w=>(p.name+' '+p.code+' '+p.barcode+' '+p.spec+' '+summary(p)).toLowerCase().includes(w))));
    const score=p=>p.code.toLowerCase()===q?1000:p.barcode.toLowerCase()===q?500:q&&p.name.toLowerCase().includes(q)?40:0;
    hits.sort((a,b)=>score(b)-score(a)||Number(b.qty>0)-Number(a.qty>0)||a.code.localeCompare(b.code,'zh-Hant',{numeric:true}));
    return {items:hits.slice(0,limit),totalHits:hits.length};
  };
  const style=document.createElement('style');style.textContent=`
.order-home{display:grid;gap:12px;width:100%}
.idle-box{justify-content:flex-start;align-items:stretch;text-align:left;overflow:auto;min-height:0;padding:8px 2px}
.order-home h2{font-size:24px;line-height:1.25}
.order-home p,.v4-note{font-size:12px;color:var(--gray);line-height:1.6}
.bible-entry{border:0;background:var(--blue);color:#fff;border-radius:16px;padding:18px;display:flex;align-items:center;justify-content:space-between;text-align:left;gap:12px;cursor:pointer}
.bible-entry strong{display:block;font-size:20px;margin-bottom:6px}
.bible-entry small{color:#e4edff;font-size:13px;line-height:1.55}
.v4-spines{display:flex;align-items:flex-end;gap:4px;flex-shrink:0}
.v4-spines i,.size-row i{background:#243247;border:1px solid #9cb2da;border-radius:3px;color:#e5d39b;writing-mode:vertical-rl;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:10px;width:17px}
.v4-cats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.v4-cats button,.v4-nav button{background:white;border:1px solid var(--line);border-radius:10px;padding:12px 8px;font-size:14px;font-weight:700;cursor:pointer;color:var(--black)}
.v4-nav{display:flex;gap:5px;overflow-x:auto;padding-bottom:3px;scrollbar-width:thin}
.v4-nav button{white-space:nowrap;font-size:12px;padding:7px 9px}
.v4-nav button.active{background:var(--blue-soft);color:var(--blue);border-color:var(--blue)}
.list-head.show{display:flex;flex-direction:column;align-items:stretch;gap:7px}
.v4-list-summary{display:flex;justify-content:space-between;align-items:center;gap:8px}
.v4-guide{background:white;border:1px solid var(--line);border-radius:11px;padding:9px;color:var(--black);font-size:13px}
.v4-guide summary{color:var(--blue);font-weight:800;cursor:pointer}
.size-row{display:flex;align-items:flex-end;justify-content:center;gap:6px;margin:8px 0}
.size-row button{background:none;border:0;display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px;font-size:11px;cursor:pointer;color:var(--black)}
.size-row button.active{background:var(--blue-soft);color:var(--blue);border-radius:8px}
.size-row i{width:25px;font-size:11px;background:#25262b}
.v4-facets,.v4-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.v4-facets label,.v4-fields label{display:flex;flex-direction:column;gap:4px;color:var(--gray);font-size:12px;min-width:0}
.v4-facets select,.v4-fields input,.v4-fields textarea,.v4-format{font:inherit;width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:white;color:var(--black);min-width:0;font-size:14px}
.v4-fields .wide{grid-column:1/-1}
.v4-fields{margin:12px 0}.v4-fields textarea{min-height:48px}
.v4-preview{width:100%;min-height:108px;resize:vertical;border:1px solid var(--line);background:var(--bg);border-radius:9px;padding:10px;font:inherit;font-size:13px;line-height:1.6;margin:9px 0}
.v4-actions{display:grid;gap:8px}.v4-actions button:disabled{opacity:.45}
.item-card{flex-shrink:0;gap:8px}.ic-name{white-space:normal;overflow-wrap:anywhere;line-height:1.45}
.ic-sub{flex-wrap:wrap}.v4-end{display:flex;align-items:flex-end;flex-direction:column;gap:5px;flex-shrink:0}
.v4-add,.v4-more,.v4-close{border:1px solid var(--blue);background:white;color:var(--blue);font-size:12px;font-weight:800;border-radius:8px;padding:7px 10px;cursor:pointer}
.v4-more{padding:12px;flex-shrink:0}.v4-add:disabled{opacity:.45}
.v4-qty{width:54px;border:0;text-align:center;font:inherit;font-weight:700;padding:6px 0;color:var(--black)}
.hero-spec{color:var(--gray);font-size:12px;margin-bottom:10px;line-height:1.55}.hero-spec:empty{display:none}
.barcode-strip .bars{display:none}.barcode-strip:before{content:'商品條碼／ISBN';font-size:11px;color:var(--gray)}
#stream{scrollbar-width:thin}#stream::-webkit-scrollbar{display:block;width:5px}#stream::-webkit-scrollbar-thumb{background:var(--line);border-radius:9px}
.quote-pill{background:var(--blue);white-space:nowrap}
@media(max-width:899px){.shell{max-width:560px;gap:8px;padding:10px 12px 12px}.big-search-box{height:48px}.big-search-box input{font-size:16px}.big-act{height:43px;font-size:13px}.stage{gap:8px}.hero{padding:13px}.hero-name{font-size:18px;margin-bottom:9px}.price-big{font-size:36px}.hero-price-row{padding-top:9px}.barcode-strip{margin-top:9px}.sheet{max-height:88dvh;padding:14px 16px 22px}.stage:not(.v4-detail) .hero.show{display:none}.v4-guide[open]{max-height:32dvh;overflow:auto}.v4-guide[open] summary{position:sticky;top:0;background:white}}
@media(min-width:900px){.idle-box{padding:24px}.order-home h2{font-size:30px}.v4-cats{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.v4-cats button{min-height:60px;font-size:15px}.bible-entry{padding:24px}.bible-entry strong{font-size:25px}.v4-facets{grid-template-columns:repeat(3,minmax(0,1fr))}.v4-end{flex-direction:row;align-items:center;gap:12px}.sheet{max-width:710px}.v4-guide[open]{max-height:38vh;overflow:auto}}
`;
  document.head.appendChild(style);
  $('idleBox').insertAdjacentHTML('afterbegin','<div class="order-home"><h2>書報組訂購助手</h2><p>找商品 → 加入訂單 → 複製或傳 LINE。免登入，不直接扣庫存。</p><button type="button" class="bible-entry" data-v4-category="bible"><span><strong>聖經規格選購</strong><small>尺寸、譯本、材質、顏色、拉鍊與索引</small></span><span class="v4-spines" aria-hidden="true"><i style="height:35px">聖經</i><i style="height:46px">聖經</i><i style="height:57px">聖經</i><i style="height:72px">聖經</i></span></button><div class="v4-cats">'+Object.entries(cats).filter(([k])=>k!=='bible').map(([k,v])=>'<button type="button" data-v4-category="'+k+'">'+v+'</button>').join('')+'</div><p>也可直接搜尋品名、ISBN 或商品代碼。價格及供貨以書房確認為準。</p></div>');
  $('idleBox').querySelectorAll('.idle-title,.idle-sub').forEach(e=>e.remove());
  $('heroName').insertAdjacentHTML('afterend','<div id="v4HeroSpec" class="hero-spec"></div>');
  $('heroAddBtn').textContent='＋ 訂購';
  $('desktopQuote').querySelector('.desktop-quote-head strong').innerHTML='訂購清單 <small style="font-size:11px;color:var(--gray)">草稿</small>';
  $('desktopCopyQuote').textContent='確認及複製訂單';
  const oldHead=$('listHead').innerHTML;
  $('listHead').innerHTML='<div id="v4Nav" class="v4-nav"></div><details id="v4Guide" class="v4-guide" style="display:none"><summary>聖經規格篩選（展開／收合）</summary><div id="v4Sizes" class="size-row"></div><div id="v4Facets" class="v4-facets"></div><p class="v4-note">尺寸圖為相對大小示意。規格依名稱及已知型號推定；未標示不等於沒有。相同 ISBN 保留各自代碼。</p><button class="v4-close" type="button" id="v4Reset">清除規格</button></details><div class="v4-list-summary">'+oldHead+'</div>';
  function renderNav(){
    $('v4Nav').innerHTML='<button type="button" data-v4-category="">首頁</button>'+Object.entries(cats).map(([k,v])=>'<button type="button" data-v4-category="'+k+'" class="'+(category===k?'active':'')+'">'+v+'</button>').join('');
    const g=$('v4Guide');g.style.display=category==='bible'?'block':'none';
    if(category==='bible'){
      if(g.dataset.started!=='1'){g.open=true;g.dataset.started='1'}
      $('v4Sizes').innerHTML=[['輕便型',35,'CU5'],['中型',46,'CU6'],['大字版',57,'CU8'],['特大字版',72,'CU9']].map(([v,h,c])=>'<button type="button" data-v4-size="'+v+'" class="'+(filters.size===v?'active':'')+'"><i style="height:'+h+'px">聖經</i>'+v+'<small>'+c+'</small></button>').join('');
      $('v4Facets').innerHTML=Object.entries(facets).map(([k,[label,opts]])=>'<label>'+label+'<select data-v4-facet="'+k+'"><option value="">不限</option>'+opts.map(v=>'<option value="'+esc(v)+'" '+(filters[k]===v?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>').join('');
    }else g.dataset.started='';
  }
  const originalHero=renderHero;
  renderHero=function(p){
    originalHero(p);
    if(p){$('heroStock').textContent=stock(p);$('v4HeroSpec').textContent=summary(p);$('heroAddBtn').disabled=!ready;}
  };
  function rows(){
    return state.quote.map(q=>({q,p:findCode(q.code)})).filter(x=>x.p);
  }
  function add(code){
    if(!ready||!findCode(code)){showToast('商品資料未就緒，請重新查詢');return}
    const q=state.quote.find(x=>x.code===code);
    if(q)q.qty=Math.min(9999,q.qty+1);else state.quote.push({code,qty:1});
    renderQuotePill();showToast('已加入訂購清單');
  }
  function qty(code,v){const q=state.quote.find(x=>x.code===code);if(!q)return;q.qty=Math.max(0,Math.min(9999,Math.floor(Number(v)||0)));if(!q.qty)state.quote=state.quote.filter(x=>x!==q);renderQuotePill()}
  function orderText(format=info.format,contact=true){
    const r=rows();if(!r.length)return '';
    if(format==='tsv')return ['商品代碼\t商品名稱\t數量\t單位\t參考單價\t小計',...r.map(({q,p})=>[p.code,p.name,q.qty,p.unit,p.price,p.price*q.qty].map(v=>String(v).replace(/[\t\r\n]/g,' ')).join('\t'))].join('\n');
    const lines=[(info.church.trim()||'教會')+' 書報組訂購'];
    if(contact)for(const [k,l] of [['name','收件人姓名'],['phone','收件人電話'],['address','收件地址'],['tax','統一編號'],['note','備註']])if(info[k].trim())lines.push('●'+l+'：'+info[k].trim());
    lines.push('','／產品品名和數量／');
    r.forEach(({q,p})=>lines.push(format==='short'?p.code+' *'+q.qty:p.code+' '+p.name+' × '+q.qty+p.unit+(format==='full'?'（NT$'+(p.price*q.qty).toLocaleString()+'）':'')));
    if(format==='full')lines.push('','商品試算合計：NT$'+r.reduce((s,{p,q})=>s+p.price*q.qty,0).toLocaleString(),'折扣、運費及供貨依書房確認為準。');
    return lines.join('\n');
  }
  function updatePreview(){if($('v4Preview'))$('v4Preview').value=orderText()}
  const oldPill=renderQuotePill;
  renderQuotePill=function(){
    oldPill();const r=rows();
    $('quotePill').style.display='inline-flex';
    $('quotePillTxt').textContent='訂單 '+r.reduce((s,{q})=>s+q.qty,0)+' 件';
    $('desktopCopyQuote').disabled=false;
    if(!r.length&&desktopMedia.matches)$('desktopQuoteList').innerHTML='<div class="desktop-quote-empty">從商品清單按「＋ 訂購」，即可加入訂單。草稿不會直接扣庫存。</div>';
    save();
  };
  function browse(c){resetOCR();category=c;state.query='';state.activeCode='';$('searchInput').value='';detail=false;limit=30;Object.keys(filters).forEach(k=>filters[k]='');render();$('stream').scrollTop=0}
  render=function(){
    const q=state.query.trim(),home=!q&&!category&&!state.activeCode;
    $('clearBtn').classList.toggle('show',!!q);
    $('ocrBanner').classList.toggle('show',!!state.ocrNote);
    $('retryOcrBtn').style.display=lastOCRPhoto&&state.ocrNote&&!ocrBusy?'inline-block':'none';
    if(state.ocrNote)$('ocrBannerTxt').textContent=state.ocrNote;
    const stage=document.querySelector('.stage');
    stage.classList.toggle('v4-detail',detail);
    $('idleBox').style.display=home?'flex':'none';
    $('listHead').classList.toggle('show',!home);
    $('stream').style.display=home?'none':'flex';
    if(home){
      renderHero(null);
      const r=state.recent.map(findCode).filter(Boolean);
      $('recentWrap').style.display=r.length?'block':'none';
      $('recentList').innerHTML=r.map(p=>'<div class="item-card" data-recent="'+esc(p.code)+'"><div class="ic-main"><div class="ic-name">'+esc(p.name)+'</div><div class="ic-sub">'+esc(p.code)+' · '+stock(p)+'</div></div><div class="ic-price">$'+p.price+'</div></div>').join('');
      renderQuotePill();return;
    }
    renderNav();
    const result=getFiltered();
    let items=result.items;
    if(!q&&!category&&state.activeCode){const p=findCode(state.activeCode);items=p?[p]:[];result.totalHits=items.length}
    let active=items.find(p=>p.code===state.activeCode)||null;
    if(!active&&!ocrRaw&&q&&items.length===1){active=items[0];state.activeCode=active.code;detail=true;stage.classList.add('v4-detail')}
    if(!active&&!ocrRaw&&q&&desktopMedia.matches&&items.length>1&&!category){active=items[0];state.activeCode=active.code}
    if(active&&(!ocrRaw||ocrConfirmed))recordRecent(active.code);
    renderHero(ocrRaw&&!ocrConfirmed?null:active);
    const expand=$('expandOcrBtn');expand.style.display=ocrRaw&&!ocrShowAll&&result.allHits>result.totalHits?'inline-block':'none';
    $('countLabel').textContent=items.length<result.totalHits?'顯示 '+items.length+'／'+result.totalHits+' 筆':result.totalHits+' 筆';
    $('stream').innerHTML=items.map(p=>'<div class="item-card'+(active&&active.code===p.code?' active':'')+'" data-code="'+esc(p.code)+'"><div class="ic-main"><div class="ic-name">'+hi(p.name,q)+'</div>'+(isBible(p)?'<div class="v4-note">'+esc(summary(p))+'</div>':'')+'<div class="ic-sub"><span class="mono">'+esc(p.code)+'</span><span style="color:'+(p.qty<=0?'var(--red)':'var(--gray)')+'">'+stock(p)+'</span></div></div><div class="v4-end"><div class="ic-price num">$'+p.price+'</div><button type="button" class="v4-add" data-v4-add="'+esc(p.code)+'" '+(ready?'':'disabled')+'>＋ 訂購</button></div></div>').join('')||'<div class="v4-note" style="padding:25px;text-align:center">'+(ready?'沒有符合的商品，請放寬搜尋條件。':'商品資料尚未載入，請重新整理。')+'</div>';
    if(!ocrRaw&&items.length<result.totalHits)$('stream').insertAdjacentHTML('beforeend','<button type="button" class="v4-more" id="v4More">顯示更多商品</button>');
    renderQuotePill();
  };
  openQuoteSheet=function(){
    const r=rows(),total=r.reduce((s,{q,p})=>s+q.qty*p.price,0);
    const html=r.map(({q,p})=>'<div class="q-row"><div style="flex:1;min-width:0"><strong style="font-size:14px">'+esc(p.name)+'</strong><div class="ic-sub">'+esc(p.code)+' · $'+p.price+' · '+stock(p)+'</div></div><div class="q-step"><button type="button" data-v4-q="'+esc(p.code)+'" data-delta="-1" aria-label="減少">−</button><input class="v4-qty" type="number" min="0" max="9999" inputmode="numeric" data-v4-qty="'+esc(p.code)+'" value="'+q.qty+'" aria-label="數量"><button type="button" data-v4-q="'+esc(p.code)+'" data-delta="1" aria-label="增加">+</button></div></div>').join('');
    const fields=[['church','教會名稱',''],['name','收件人姓名',''],['phone','電話','tel'],['tax','統編（選填）',''],['address','收件地址（選填）','wide'],['note','備註（選填）','wide']];
    $('sheet').innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><strong style="font-size:20px">訂購清單</strong><button type="button" class="v4-close" data-close="1">繼續選購</button></div><p class="v4-note">這是草稿，尚未送單。商品清單保留於此瀏覽器；收件資料不寫入永久儲存。</p>'+(html||'<p class="v4-note" style="padding:20px 0">尚未加入商品。</p>')+(state.quote.length>r.length?'<p class="v4-note">部分草稿商品已不在目前目錄中，請重新確認。</p>':'')+'<div class="desktop-quote-total"><span>參考合計</span><strong class="num" style="color:var(--blue)">NT$ '+total.toLocaleString()+'</strong></div><div class="v4-fields">'+fields.map(([k,l,t])=>'<label class="'+(t==='wide'?'wide':'')+'">'+l+(k==='note'?'<textarea maxlength="500" data-v4-info="'+k+'">'+esc(info[k])+'</textarea>':'<input maxlength="200" type="'+(t==='tel'?'tel':'text')+'" data-v4-info="'+k+'" value="'+esc(info[k])+'" autocomplete="off">')+'</label>').join('')+'</div><label class="v4-note">複製格式<select id="v4Format" class="v4-format">'+[['name','代碼＋品名＋數量'],['short','純代碼＋數量'],['full','含參考金額'],['tsv','表格（Excel／Google Sheets）']].map(([v,l])=>'<option value="'+v+'" '+(info.format===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label><textarea id="v4Preview" class="v4-preview" readonly aria-label="訂單預覽"></textarea><div class="v4-actions"><button class="btn-full" type="button" id="v4Copy" '+(!ready||!r.length?'disabled':'')+'>複製訂單</button><button class="btn-outline" type="button" id="v4Line" '+(!ready||!r.length?'disabled':'')+'>LINE 分享商品明細</button><button class="btn-outline" type="button" id="v4Clear">清空訂購草稿</button></div><p class="v4-note">LINE 分享只帶商品明細及教會名稱，不含收件個資。完整訂單請複製貼上；電腦版 LINE 使用複製。</p>';
    updatePreview();$('mask').classList.add('open');
  };
  // Capture handlers replace only order-related original listeners.
  document.addEventListener('click',e=>{
    const t=e.target.closest('[data-v4-category],[data-v4-size],[data-v4-add],#v4Reset,#v4More,#heroAddBtn,#quotePill,#desktopCopyQuote,#desktopClearQuote,[data-desktop-code],[data-v4-q],#v4Copy,#v4Line,#v4Clear');
    if(!t)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(t.hasAttribute('data-v4-category'))return browse(t.dataset.v4Category);
    if(t.dataset.v4Size){filters.size=filters.size===t.dataset.v4Size?'':t.dataset.v4Size;state.activeCode='';detail=false;limit=30;return render()}
    if(t.id==='v4Reset'){Object.keys(filters).forEach(k=>filters[k]='');state.activeCode='';detail=false;limit=30;return render()}
    if(t.id==='v4More'){const pos=$('stream').scrollTop;limit+=30;render();$('stream').scrollTop=pos;return}
    if(t.dataset.v4Add)return add(t.dataset.v4Add);
    if(t.id==='heroAddBtn'){if(state.activeCode&&(!ocrRaw||ocrConfirmed))add(state.activeCode);return}
    if(t.id==='quotePill'||t.id==='desktopCopyQuote')return openQuoteSheet();
    if(t.id==='desktopClearQuote'||t.id==='v4Clear'){if(confirm('確定清空訂購草稿？')){state.quote=[];renderQuotePill();if(t.id==='v4Clear')openQuoteSheet()}return}
    const code=t.dataset.v4Q||t.dataset.desktopCode;
    if(code){const q=state.quote.find(x=>x.code===code);if(q)qty(code,q.qty+Number(t.dataset.delta));if(t.dataset.v4Q)openQuoteSheet();return}
    if(t.id==='v4Copy'){const txt=orderText();if(ready&&txt)copyText(txt,'訂購內容');return}
    if(t.id==='v4Line'){const txt=orderText('name',false);if(!ready||!txt)return;if(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent))window.open('https://line.me/R/share?text='+encodeURIComponent(txt),'_blank','noopener,noreferrer');else copyText(txt,'商品明細，請貼到 LINE')}
  },true);
  $('v4Facets').addEventListener('change',e=>{const k=e.target.dataset.v4Facet;if(k){filters[k]=e.target.value;state.activeCode='';detail=false;limit=30;render()}});
  $('mask').addEventListener('input',e=>{const k=e.target.dataset.v4Info;if(k&&Object.prototype.hasOwnProperty.call(info,k)){info[k]=e.target.value;updatePreview()}});
  $('mask').addEventListener('change',e=>{if(e.target.id==='v4Format'){info.format=e.target.value;updatePreview()}if(e.target.dataset.v4Qty){qty(e.target.dataset.v4Qty,e.target.value);openQuoteSheet()}});
  $('stream').addEventListener('click',e=>{if(e.target.closest('[data-code]'))detail=true},true);
  $('recentList').addEventListener('click',e=>{if(e.target.closest('[data-recent]'))detail=true},true);
  $('searchInput').addEventListener('input',()=>{detail=false;limit=30;if(!$('searchInput').value.trim())category=''},true);
  for(const id of ['clearBtn','clearOcrBtn','voiceBtn','ocrBtn','barcodeBtn'])$(id).addEventListener('click',()=>{category='';detail=false;limit=30},true);
  const oldBarcode=onBarcodeHit;
  onBarcodeHit=function(raw){category='';detail=true;limit=30;oldBarcode(raw);const val=String(raw||'').trim().toLowerCase();const matches=products.filter(p=>p.code.toLowerCase()===val||p.barcode.toLowerCase()===val);if(matches.length>1){state.activeCode='';detail=false;render();showToast('同一條碼有多個品項，請核對商品代碼')}};
  render();
})();
