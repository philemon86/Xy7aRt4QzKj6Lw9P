(function setupOrder(){
  'use strict';
  const $=id=>document.getElementById(id);
  const guide=window.FindBookSearch, guideData=window.FindCatalogGuide;
  const audience='unified';
  let churchName='', bookOnly=false, forceAll=false, bookReasons=new Map(), discoveryList=null;
  function salesScore(p){return guide?guide.popularity(p,audience):Number(p.qty>0)}
  function eligible(p){return !/^(?:紅利|折扣|禮券|運費|刷卡手續費|折讓)/.test(p.name||'')}
  function storefront(p){return guideData?.verifiedUrls?.[p.code.toUpperCase()]||'https://www.pbooks.com.tw/'}
  function shopLink(p){const verified=guideData?.verifiedUrls?.[p.code.toUpperCase()];return verified?'<a class="v7-shop" href="'+esc(verified)+'" target="_blank" rel="noopener noreferrer">商城購買</a>':'<button type="button" class="v7-shop" data-v7-store="'+esc(p.code)+'">商城查詢</button>'}
  function guideQuery(q){
    return guide?guide.search(products,stripBudget(q),audience,chatBudget):{matches:[],hasIntent:false};
  }

  const cats={all:'全部商品',bible:'聖經',books:'書籍',hymns:'讚美詩／樂譜',calendar:'月曆／週曆',gifts:'文創禮品',church:'教會用品'};
  const filters={size:'',version:'',material:'',zip:'',thumb:'',color:'',language:'',feature:''};
  let bibleGroup='';
  let chatActive=false, chatQuery='', chatTerms=[], chatBible=false, chatTurns=[], chatPending='', chatBudget=null, chatNeg={}, chatSkipped=new Set();
  const facets={size:['尺寸',['袖珍／掌型','輕便型','中型','大字版','特大字版','大型（其他）','待核對','未確認']],version:['譯本',['和合本','新標點和合本','和合本修訂版','現代中文譯本','雙語／對照','其他／未確認']],material:['封面材質',['硬面／精裝','漆布','膠皮','皮面','布面','牛仔布','未確認']],zip:['拉鍊',['有','未標示']],thumb:['索引',['有','未標示']],color:['顏色',['黑色','藍色','紅色','咖啡色','紫色','綠色','未確認']]};
  const bibleGroups={
    cu:['和合本｜傳統直排','公會 CU 系列，依大小及裝訂選購'],
    cunp:['新標點和合本','含橫排、串珠及各尺寸'],
    rcu:['和合本修訂版','和合本 2010 等修訂本'],
    design:['聖資花色聖經','彩繪、花紋、婚禮及各種封面'],
    centenary:['百年紀念聖經','臺灣傳教百年紀念系列'],
    chinese:['其他中文譯本','現代中文、新普及、環球等'],
    parallel:['雙語／譯本對照','中英、中西與中文譯本對照'],
    study:['研讀／靈修／註釋','研讀、啟導、靈修及合參'],
    learning:['注音／拼音／繪圖','學習閱讀、注音、繪圖本'],
    local:['台語／客語／族語','漢羅、羅馬字、原住民族語'],
    foreign:['外文／原文聖經','英文、日韓、東南亞及原文'],
    other:['其他待整理','新上架且尚無足夠分類資料的品項']
  };
  facets.language=['語言',['英語','日語','韓語','西班牙語','德語','法語','荷蘭語','泰語','越南語','印尼語','菲律賓語','希臘語','希伯來語','台語／羅馬字','客語','賽德克語','鄒語','泰雅語','中英','中西','中文譯本對照']];
  facets.feature=['特色',['橫排','串珠','研讀／啟導','靈修','註釋','紅字','注音','拼音','繪圖','婚禮禮盒','新約','舊約','五經','金邊','銀邊']];
  function groupOf(p){
    const c=String(p.code||'').toUpperCase(),n=p.name||'';
    if(['B320','B320-1','CUNPIB63A','TCV19PS63PU','01030002'].includes(c)||/注音|拼音|繪圖本/.test(n))return 'learning';
    if(/^CM\d/.test(c)||/傳教百年.*聖經/.test(n))return 'centenary';
    if(/^SR\d/.test(c))return 'design';
    if(/^(TTV|TTHV|TTYV|AR38|SED\/|COUNT\/)/.test(c)||/台語|臺語|客語|賽德克|鄒語|泰雅|羅馬字/.test(n))return 'local';
    if(/^(CBT|NRSV\/|ESV\/|RCU\/|TEV\/)/.test(c)||['S13TS01H','S22TS01H','CAT6799'].includes(c)||/中英|中西|譯本對照/.test(n))return 'parallel';
    if(/^(CCT|322CAL|M324|M325|M333|CAT6844|CAT6794|CAT6680|CAT7199|TCV19SB|S34TS99H)/.test(c))return 'study';
    if(/^CU\d/.test(c))return 'cu';
    if(/^CUNP/.test(c))return 'cunp';
    if(/^RCU/.test(c)||c==='9786267223284')return 'rcu';
    if(/^(TCV|CAT|S\d)/.test(c))return 'chinese';
    if(['B308A','B7','THSV62PL','NI53','1501','TPV050P','8184','6010','8147','8173','RVV052','NKR72TH','TB052TI','5119','ESV042','TB2052TI','ESV063','JC63','B308C'].includes(c)||/英文|日文|韓文|西班牙文|德文|法文|荷蘭文|泰文|越南文|印尼文|菲律賓文|希臘|希伯來|七十士/.test(n))return 'foreign';
    if(/研讀|靈修版|註釋|啟導本/.test(n))return 'study';
    return 'other';
  }
  function featureOf(p){
    const n=p.name||'',c=String(p.code||'').toUpperCase(),out=[];
    for(const [v,re] of [['橫排',/橫排|CUNPCS/],['串珠',/串珠/],['研讀／啟導',/研讀|啟導|分析排版/],['靈修',/靈修|生命成長/],['註釋',/註釋/],['紅字',/紅字/],['注音',/注音/],['拼音',/拼音/],['繪圖',/繪圖|彩繪/],['婚禮禮盒',/婚禮/],['新約',/新約/],['舊約',/舊約/],['五經',/五經/],['金邊',/金邊/],['銀邊',/銀邊/]])if(re.test(n+' '+c))out.push(v);
    return out;
  }
  function languageOf(p){
    const n=p.name||'',c=String(p.code||'').toUpperCase();
    const rules=[['中西',/中西/],['中英',/中英|中文.*英文|英文.*中文|^(?:ESV\/|RCU\/ESV|NRSV\/|TEV\/|CBT4738)/],['中文譯本對照',/新漢語\/和合|新譯和合/],['台語／羅馬字',/台語|臺語|羅馬字|^TTV|^AR38/],['客語',/客語|^TTHV/],['賽德克語',/賽德克/],['鄒語',/鄒語/],['泰雅語',/泰雅/],['西班牙語',/西班牙文/],['日語',/日文/],['韓語',/韓文/],['德語',/德文/],['法語',/法文/],['荷蘭語',/荷蘭文/],['泰語',/泰文/],['越南語',/越南文/],['印尼語',/印尼文/],['菲律賓語',/菲律賓文/],['希臘語',/希臘|七十士/],['希伯來語',/希伯來/],['英語',/^ESV\d|英文聖經/]];
    return rules.find(([,re])=>re.test(n)||re.test(c))?.[0]||'';
  }
  const info={church:'',name:'',phone:'',address:'',tax:'',note:'',format:'name'};
  let category='',limit=12,detail=false,ready=false,orderPage=false,returnScroll=0;
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
  function bs(p){
    if(!memo.has(p)){
      const b=spec(p),g=groupOf(p),n=p.name||'';
      if(g==='cu')b.version='和合本';
      if(g==='cunp')b.version='新標點和合本';
      if(g==='rcu')b.version='和合本修訂版';
      if(g==='design'||g==='centenary'){
        if(/特大(?!字)/.test(n))b.size='特大字版';
        if(/仿皮|軟皮|麂皮/.test(n))b.material='皮面（含仿皮）';
      }
      if(/黑皮/.test(n))b.color='黑色';
      if(/白色|雛菊白|星空白/.test(n))b.color='白色';
      if(/粉紅|玫瑰粉|粉銀/.test(n))b.color='粉色';
      if(/灰色|古典灰/.test(n))b.color='灰色';
      if(/新普及/.test(n))b.version='新普及譯本';
      if(/新漢語/.test(n)&&g!=='parallel')b.version='新漢語譯本';
      if(/環球聖經譯本/.test(n))b.version='環球聖經譯本';
      b.language=languageOf(p);b.feature=featureOf(p);b.group=g;
      memo.set(p,b);
    }
    return memo.get(p);
  }
  function facetMatch(p,k,v){const a=bs(p)[k];return !v||(Array.isArray(a)?a.includes(v):a===v)}
  function groupProducts(g=bibleGroup){return products.filter(p=>isBible(p)&&(!g||bs(p).group===g))}
  function groupTitle(g){return bibleGroups[g]?.[0]||'聖經選購'}
  function usableFacet(v){return v&&v!=='未確認'&&v!=='未標示'&&v!=='其他／未確認'&&v!=='待核對'}
  function optionsFor(k){const actual=new Set(groupProducts().flatMap(p=>[bs(p)[k]].flat()).filter(usableFacet));return [...new Set([...facets[k][1],...actual])].filter(v=>actual.has(v))}
  function visibleFacetKeys(){
    const base=['size','material','color','zip','thumb','feature'];
    if(['parallel','foreign','local'].includes(bibleGroup))return ['language',...base];
    if(['chinese','study','learning','other'].includes(bibleGroup))return ['version',...base,'language'];
    return base;
  }

  function summary(p){if(!isBible(p))return '';const b=bs(p);return [...new Set([groupTitle(b.group),b.version,b.language,b.size,b.material,b.color,b.zip==='有'?'拉鍊':'',b.thumb==='有'?'索引':'',...b.feature,b.conflict?'名稱與型號尺寸不同，需核對':''].filter(usableFacet))].join('／')}
  function match(p){
    const cl=p.clas||'',n=p.name||'';
    if(!category||category==='all')return true;
    if(category==='bible')return isBible(p)&&(!bibleGroup||bs(p).group===bibleGroup)&&Object.entries(filters).every(([k,v])=>facetMatch(p,k,v));
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
  function matchesWords(p,q){const words=q.trim().toLowerCase().split(/\s+/).filter(Boolean);const hay=(p.name+' '+p.code+' '+p.barcode+' '+p.spec+' '+summary(p)).toLowerCase();return !words.length||words.every(w=>hay.includes(w));}
  function bibleCount(ignore='',value=''){return groupProducts().filter(p=>matchesWords(p,state.query)&&Object.entries(filters).every(([k,v])=>facetMatch(p,k,k===ignore?value:v))).length;}
  // Local, explainable conversational catalog search. No remote AI request.
  const aliases=[
    ['size','特大字版',/特大字|超大字|最大字/],['size','大字版',/大字|大本/],['size','中型',/中型|中本|中尺寸/],['size','輕便型',/輕便|小本|小型/],['size','袖珍／掌型',/袖珍|掌型|口袋/],
    ['version','和合本修訂版',/和合本2010|和合本修訂版|和修本/],['version','新標點和合本',/新標點(?:和合本)?/],['version','和合本',/和合本|和合版/],['version','現代中文譯本',/現代中文(?:譯本)?/],['version','新普及譯本',/新普及(?:譯本)?/],['version','新漢語譯本',/新漢語(?:譯本)?/],
    ['material','皮面',/真皮|皮面|皮革|黑皮|紅皮/],['material','膠皮',/膠皮|塑膠封面|膠面/],['material','硬面／精裝',/硬面|硬殼|精裝/],['material','漆布',/漆布/],['material','布面',/布面/],['material','牛仔布',/牛仔布/],
    ['zip','有',/拉[鍊鏈]|拉链/],['thumb','有',/拇指索引|手指索引|索引/],
    ['color','黑色',/黑色|黑皮|黑的|黑面/],['color','藍色',/藍色|藍的|藍皮/],['color','紅色',/紅色|紅皮|紅的/],['color','咖啡色',/咖啡色|棕色|褐色/],['color','紫色',/紫色|紫的/],['color','綠色',/綠色|綠的/],['color','白色',/白色|白的/],['color','粉色',/粉紅色|粉色/],
    ['feature','橫排',/橫排/],['feature','串珠',/串珠/],['feature','紅字',/紅字/],['feature','注音',/注音/],['feature','拼音',/拼音/],['feature','金邊',/金邊/],['feature','銀邊',/銀邊/],
    ['language','中英',/中英(?:對照)?/],['language','中西',/中西(?:對照)?/],['language','英語',/英文|英語/],['language','台語／羅馬字',/台語|臺語|羅馬字/],['language','客語',/客語|客家話/],['language','日語',/日文|日語/],['language','韓語',/韓文|韓語/],['language','越南語',/越南文|越南語/]
  ];
  const groupAliases=[['cu',/傳統和合本|傳統直排/],['cunp',/新標點和合本/],['rcu',/和合本修訂版|和合本2010/],['design',/聖資|花色聖經/],['centenary',/百年紀念聖經/],['parallel',/雙語|中英對照|中西對照/],['study',/研讀本|研讀聖經|啟導本|註釋聖經/],['learning',/注音聖經|拼音聖經|繪圖聖經/],['local',/族語聖經/],['foreign',/外文聖經|原文聖經/]];
  function resetChat(){chatActive=false;chatQuery='';chatTerms=[];chatBible=false;chatTurns=[];chatPending='';chatBudget=null;chatNeg={};chatSkipped.clear();}
  function chatParse(raw){
    const t=raw.normalize('NFKC').trim(),found={},neg={},groups=groupAliases.find(([,re])=>re.test(t))?.[0]||'';
    let work=t;
    // Match longest/most specific expression first; color and material may overlap.
    for(const [k,v,re] of aliases){
      if(found[k])continue;
      if(!re.test(t))continue;
      const hit=t.match(re);
      if(k==='size'&&v==='大字版'&&/特大字|超大字|最大字/.test(t))continue;
      if(k==='version'&&v==='和合本'&&/新標點|修訂版|2010/.test(t))continue;
      if(k==='language'&&v==='英語'&&/中英/.test(t))continue;
      const before=t.slice(Math.max(0,hit.index-5),hit.index);
      if(/(?:不要|不用|不需要|不必|無|没有|沒有|不含|不帶|不带)\s*(?:有|帶|带)?$/.test(before)){neg[k]=v;continue}
      found[k]=v;
    }
    const budget=t.match(/(?:預算|不超過|低於|最多)\s*(?:NT\$|\$)?\s*(\d{2,6})|(\d{2,6})\s*(?:元|塊)?\s*(?:以內|以下)/);
    const max=budget?Number(budget[1]||budget[2]):null;
    return {t,found,neg,groups,max,bible:/聖經|和合本|和修本|新標點|CU\d/i.test(t)||!!groups};
  }
  function isRefinement(a){
    if(!chatActive||!chatBible)return false;
    if(/^(?:重新|換找|另外|我還要|再找|清除|新查詢)/.test(a.t))return false;
    return !!(a.groups||Object.keys(a.found).length||Object.keys(a.neg).length||a.max!==null||/^(不限|都可以|都可|隨便|不拘|不用了)$/.test(a.t));
  }
  function stripBudget(t){return t.replace(/(?:預算|不超過|低於|最多)\s*(?:NT\$|\$)?\s*\d{2,6}\s*(?:元|塊)?\s*(?:以內|以下)?|\d{2,6}\s*(?:元|塊)?\s*(?:以內|以下)/g,'');}
  function genericTerms(t){
    let rest=stripBudget(t).replace(/^(?:請問|請幫我|幫我找|幫我|我想找|我想買|我要買|我要|想找|找一下|找)\s*/,'').replace(/[？?。]$/,'').trim();
    const found=[];
    const patterns=[['米色',/米色|奶茶色|杏色/],['藍色',/藍色/],['綠色',/綠色/],['紫色',/紫色/],['紅色',/紅色/],['黑色',/黑色/],['白色',/白色/],['帽子',/棒球帽|鴨舌帽|帽子|帽$/],['保溫瓶',/保溫杯|水壺|保溫瓶|水瓶/],['資料夾',/資料夾|樂譜夾|譜夾/],['狗狗',/狗狗|柴犬/],['鴿子',/鴿子/]];
    for(const [v,re] of patterns)if(re.test(rest)){found.push(v);rest=rest.replace(re,'');}
    rest=rest.replace(/^[有的\s]+|[有的\s]+$/g,'').trim();
    return [...found,...rest.split(/\s+/).filter(Boolean)];
  }
  function beginChat(raw,live=false){
    const a=chatParse(raw);if(!a.t){browse('');return;}
    const exact=products.some(p=>p.code.toLowerCase()===a.t.toLowerCase()||p.barcode.toLowerCase()===a.t.toLowerCase());
    const refine=!live&&!exact&&isRefinement(a);
    if(!refine){resetChat();Object.keys(filters).forEach(k=>filters[k]='');bibleGroup='';category='';}
    chatActive=true;chatQuery=a.t;chatTurns.push(a.t);chatTurns=chatTurns.slice(-4);
    chatBible=!exact&&(a.bible||(refine&&chatBible));
    if(chatBible){
      category='bible';
      if(a.groups){bibleGroup=a.groups;if(!a.found.version)filters.version=''}
      if(a.found.version&&!a.groups)bibleGroup='';
      if(/^(不限|都可以|都可|隨便|不拘|不用了)$/.test(a.t)&&chatPending){filters[chatPending]='';delete chatNeg[chatPending];chatSkipped.add(chatPending);}
      for(const [k,v] of Object.entries(a.found)){filters[k]=v;delete chatNeg[k];chatSkipped.delete(k)}
      for(const [k,v] of Object.entries(a.neg)){filters[k]='';chatNeg[k]=v;}
      if(a.max!==null)chatBudget=a.max;
      // Preserve unsupported terms rather than silently ignoring arbitrary requests.
      if(!refine)chatTerms=[];
      const leftovers=a.t.replace(/聖經|請問|請幫我|幫我|我想要|我想找|我想|想要|想找|我要|找一本|買一本|一本|有沒有|有嗎|有的|的|款|版|型|尺寸|封面|材質|顏色|需要|不要|不用|不需要|不必|沒有|无|無|有|請|嗎|呢|就好|即可|都可以|都可|不限|隨便|不拘|不用了|換成|改成|改|換|要|找|買|再|看|一下|傳統直排|傳統和合本/g,'');
      let rem=a.t;
      for(const [, , re] of aliases)rem=rem.replace(re,'');
      for(const [,re] of groupAliases)rem=rem.replace(re,'');
      rem=stripBudget(rem).replace(/聖經|請問|請幫我|幫我|我想要|我想找|我想|想要|想找|我要|找一本|買一本|一本|有沒有|有嗎|有的|的|款|版|型|尺寸|封面|材質|顏色|需要|不要|不用|不需要|不必|沒有|無|有|請|嗎|呢|就好|即可|都可以|都可|不限|隨便|不拘|換成|改成|改|換|要|找|買|再|看|一下|[，。！？、\s]+/g,'');
      if(rem&&rem.length>=2)chatTerms=[...new Set([...chatTerms,rem])];
    }else{
      chatTerms=genericTerms(a.t);
      if(a.max!==null)chatBudget=a.max;
    }
    resetOCR();state.query=a.t;state.activeCode='';detail=false;limit=12;if(!live)$('searchInput').value=a.t;render();
  }
  function chatHay(p){
    let h=(p.name+' '+p.code+' '+p.barcode+' '+p.spec+' '+summary(p)).normalize('NFKC').toLowerCase();
    if(/保溫瓶|水瓶|水壺/.test(h))h+=' 水壺 水瓶 保溫杯 保溫瓶';
    if(/靜謐藍|海鹽藍|藍桿|鴿子藍/.test(h))h+=' 藍色';
    if(/綠桿|森林綠/.test(h))h+=' 綠色';
    if(/鴿子紫/.test(h))h+=' 紫色';
    if(/棒球帽|鴨舌帽|帽沿/.test(h))h+=' 帽子 鴨舌帽';
    if(/大冰奶|奶茶|奶油杏/.test(h))h+=' 米色 奶茶色 杏色';
    if(/柴犬/.test(h))h+=' 狗狗 狗';
    if(/黑貓|貓咪/.test(h))h+=' 貓咪 小貓';
    if(/樂譜夾/.test(h))h+=' 資料夾 譜夾';
    return h;
  }
  function chatHits(){
    const q=chatQuery.toLowerCase();
    const codeTerms=q.split(/[\s,，、;；]+/).filter(Boolean);
    if(codeTerms.length>1&&codeTerms.every(x=>/^[a-z0-9][a-z0-9._/-]*$/i.test(x)&&products.some(p=>p.code.toLowerCase()===x||p.barcode.toLowerCase()===x))){
      return products.filter(p=>codeTerms.includes(p.code.toLowerCase())||codeTerms.includes(p.barcode.toLowerCase()));
    }
    const exact=products.filter(p=>p.code.toLowerCase()===q||p.barcode.toLowerCase()===q);
    if(exact.length)return exact.sort((a,b)=>Number(b.code.toLowerCase()===q)-Number(a.code.toLowerCase()===q));
    if(/^[a-z0-9][a-z0-9._/-]*$/i.test(q)){return products.filter(p=>p.code.toLowerCase().startsWith(q)||p.barcode.toLowerCase().startsWith(q)).sort((a,b)=>a.code.localeCompare(b.code,'zh-Hant',{numeric:true}));}
    const foundBooks=guideQuery(chatQuery);
    const rawTerm=stripBudget(chatQuery).trim();
    const directOthers=guide?products.filter(p=>!guide.isBook(p)&&eligible(p)&&guide.directScore(p,rawTerm)>=135&&(chatBudget===null||p.price<=chatBudget)):[];
    const explicitReading=bookOnly||/找書|推薦.*書|有關.*書|相關.*書|書籍|書單|讀什麼|讀一本|想讀|想看.*書|經卷|釋義|查經|講壇|講義/.test(chatQuery);
    const physicalGoods=/手機架|手機殼|手機繩|書套|書籤|書衣|保溫瓶|水壺|帽子|原子筆|禮品|傳單|月曆|週曆|周曆|桌曆|筆記本|資料夾|樂譜夾/.test(chatQuery);
    const physicalBible=chatBible&&(['size','material','color','zip','thumb','language','version'].some(k=>filters[k])||Object.keys(chatNeg).length>0||/^(聖經|買聖經|找聖經|我要聖經|和合本|聖經公會|新標點聖經)$/.test(chatQuery.trim()));
    const exactTitle=foundBooks.matches.filter(x=>x.score>=250);
    if(!forceAll&&exactTitle.length){for(const x of exactTitle)bookReasons.set(x.p.code,x.reason.join('・'));return exactTitle.map(x=>x.p)}
    const bookIntent=bookOnly||(!forceAll&&!physicalBible&&!physicalGoods&&(explicitReading||!directOthers.length)&&(foundBooks.hasIntent||foundBooks.matches.some(x=>x.score>=135)));
    if(bookIntent&&foundBooks.matches.length){
      for(const x of foundBooks.matches)bookReasons.set(x.p.code,x.reason.join('・'));
      if(bookOnly||foundBooks.hasIntent||chatBible)return foundBooks.matches.map(x=>x.p);
      // Keep exact titles first; other categories can still be found by their direct names.
      const ids=new Set(foundBooks.matches.map(x=>x.p.code));
      const others=products.filter(p=>!ids.has(p.code)&&eligible(p)&&guide.directScore(p,foundBooks.parsed.t)>=135&&(chatBudget===null||p.price<=chatBudget));
      return [...foundBooks.matches.map(x=>x.p),...others.sort((a,b)=>salesScore(b)-salesScore(a))];
    }
    if(bookOnly)return [];
    if(!physicalBible&&directOthers.length&&!explicitReading){const all=products.filter(p=>eligible(p)&&guide.directScore(p,rawTerm)>=135&&(chatBudget===null||p.price<=chatBudget));return all.sort((a,b)=>guide.directScore(b,rawTerm)-guide.directScore(a,rawTerm)||salesScore(b)-salesScore(a));}
    if(chatBible&&!forceAll)return products.filter(p=>isBible(p)&&(!bibleGroup||bs(p).group===bibleGroup)&&Object.entries(filters).every(([k,v])=>facetMatch(p,k,v))&&Object.entries(chatNeg).every(([k,v])=>{const val=bs(p)[k];return val==='無'||val==='沒有'||(k==='zip'&&/無拉[鍊鏈]|不帶拉[鍊鏈]|沒有拉[鍊鏈]/.test(p.name))||(k==='thumb'&&/無索引|沒有索引/.test(p.name));})&&(chatBudget===null||p.price<=chatBudget)&&chatTerms.every(t=>chatHay(p).includes(t.toLowerCase()))).sort((a,b)=>salesScore(b)-salesScore(a)||Number(b.qty>0)-Number(a.qty>0)||a.price-b.price);
    const text=forceAll?rawTerm:chatTerms.join(' ').trim();
    const tokens=text.split(/\s+/).filter(Boolean);
    let hits=products.filter(p=>eligible(p)&&tokens.length&&tokens.every(t=>chatHay(p).includes(t.toLowerCase()))&&(chatBudget===null||p.price<=chatBudget));
    if(hits.length){
      const score=p=>guide?guide.directScore(p,text):0;
      hits.sort((a,b)=>score(b)-score(a)||salesScore(b)-salesScore(a)||a.code.localeCompare(b.code,'zh-Hant',{numeric:true}));
    }
    if(!hits.length&&text&&window.FindOCR&&tokens.length===1){
      const ranked=window.FindOCR.rank(products,text);
      // Only use partial matches as candidates, never claim exact semantic matches.
      hits=ranked.items.filter(p=>chatBudget===null||p.price<=chatBudget);
    }
    return hits;
  }
  function nextQuestion(hits){
    if(!chatBible||hits.length<=5)return null;
    let best=null;
    for(const k of ['size','version','material','color','zip','thumb','language','feature']){
      if(filters[k]||chatNeg[k]||chatSkipped.has(k))continue;
      const vals=new Map();
      for(const p of hits)for(const v of [bs(p)[k]].flat())if(usableFacet(v))vals.set(v,(vals.get(v)||0)+1);
      if(vals.size<2)continue;
      const opts=[...vals].sort((a,b)=>b[1]-a[1]).slice(0,4);
      const coverage=[...vals.values()].reduce((a,b)=>a+b,0);
      const score=opts.length*10+Math.min(coverage,hits.length)/hits.length;
      if(!best||score>best.score)best={k,opts,score};
    }
    return best;
  }
  function chatPanel(result){
    const el=$('v5Conversation');
    el.hidden=true;el.style.display='';el.innerHTML='';
    if(!chatActive||!ready||!chatBible)return;
    const constraints=Object.entries(filters).filter(([,v])=>v).map(([k,v])=>v==='有'?facets[k][0]:v);
    if(bibleGroup)constraints.unshift(groupTitle(bibleGroup));
    if(chatBudget!==null)constraints.push(chatBudget+' 元以下');
    if(!result.totalHits){
      el.hidden=false;el.innerHTML='<div class="v6-assist"><strong>查無此款</strong><p>目前目錄沒有可確認符合全部條件的聖經。</p>'+(constraints.length?'<p>'+esc(constraints.join('、'))+'</p>':'')+'<div class="v6-refine">'+Object.keys(filters).filter(k=>filters[k]).map(k=>'<button type="button" data-v5-relax="'+k+'">取消'+esc(facets[k][0])+'</button>').join('')+Object.keys(chatNeg).map(k=>'<button type="button" data-v5-relax="'+k+'">取消'+esc(facets[k][0])+'限制</button>').join('')+(chatTerms.length?'<button type="button" id="v5RelaxWords">取消其他文字條件</button>':'')+(chatBudget!==null?'<button type="button" id="v5RelaxBudget">取消預算</button>':'')+'</div></div>';return;
    }
    const question=nextQuestion(chatHits());chatPending=question?.k||'';
    if(!question)return;
    el.hidden=false;el.innerHTML='<label class="v8-bible-label">再選'+esc(facets[question.k][0])+'<select id="v8Question" data-facet="'+esc(question.k)+'"><option value="">不限</option>'+question.opts.map(([v,n])=>'<option value="'+esc(v)+'">'+esc(v)+'（'+n+'）</option>').join('')+'<option value="__skip">暫不篩選</option></select></label>';
  }
  const oldFilter=getFiltered;
  getFiltered=function(){
    if(ocrRaw)return oldFilter();
    bookReasons=new Map();
    if(chatActive){const hits=chatHits();return {items:hits.slice(0,limit),totalHits:hits.length};}
    const q=state.query.trim().toLowerCase();
    if(!q&&!category)return {items:[],totalHits:0};
    const words=q.split(/\s+/).filter(Boolean);
    const hits=products.filter(p=>eligible(p)&&match(p)&&(!words.length||p.code.toLowerCase()===q||p.barcode.toLowerCase()===q||words.every(w=>(p.name+' '+p.code+' '+p.barcode+' '+p.spec+' '+summary(p)).toLowerCase().includes(w))));
    const score=p=>p.code.toLowerCase()===q?1000:p.barcode.toLowerCase()===q?500:q&&p.name.toLowerCase().includes(q)?40:0;
    hits.sort((a,b)=>score(b)-score(a)||salesScore(b)-salesScore(a)||a.code.localeCompare(b.code,'zh-Hant',{numeric:true}));
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
  // Only the document scrolls. No nested category/filter/product scroll areas.
  style.textContent+=`
html,body{height:auto;min-height:100%;overflow:visible}
.shell{height:auto;min-height:100dvh}
.stage{overflow:visible;flex:1 0 auto;min-height:0}
.idle-box,.stream,#stream,#recentList,.desktop-panel,.desktop-quote-list,.v4-nav,.v4-guide[open]{overflow:visible!important;max-height:none!important;scrollbar-width:auto}
.v4-nav{display:flex;flex-wrap:wrap;gap:6px;padding-bottom:0}
.v4-nav button{white-space:normal;line-height:1.4}
.v4-guide[open] summary{position:static!important}
.v4-facets select{height:40px}
.v4-facets label{color:var(--black);font-weight:700}
.v4-facets select{font-weight:400}
.v4-filter-status{font-size:13px;font-weight:700;line-height:1.5;color:var(--blue);margin:8px 0 0}
.v4-filter-status.zero{color:var(--red)}
.v4-filter-tools{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}
.v4-empty{padding:20px 16px;background:white;border:1px solid var(--line);border-radius:14px;display:flex;flex-direction:column;gap:9px;align-items:flex-start}
.v4-empty strong{font-size:20px;color:var(--red)}
.v4-empty p{font-size:13px;color:var(--gray);line-height:1.65}
.v4-empty .v4-close{text-align:left;white-space:normal}
.v4-condition{font-size:13px;color:var(--black);line-height:1.6;overflow-wrap:anywhere}
.v4-guide .size-row{margin:10px 0}
.v4-more{min-height:44px}
#stream{flex:0 0 auto}
.desktop-panel{align-self:start}
@media(max-width:899px){
 .shell{padding-bottom:0}
 .stage{display:flex;flex-direction:column;flex:1 0 auto}
 .v4-nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}
 .v4-nav button{padding:8px 3px;font-size:12px;min-height:40px}
 .dock-wrap{position:sticky;bottom:0;z-index:12;background:var(--bg);padding:9px 0 max(10px,env(safe-area-inset-bottom));box-shadow:0 -5px 12px rgba(245,246,248,.95)}
 .size-row button{flex:1;min-width:0;padding:4px 0}
 .v4-guide{padding:12px}
 .v4-guide .v4-note{margin-top:7px}
 .idle-box{flex:0 0 auto}
}
@media(min-width:900px){
 .stage{grid-template-rows:auto auto;align-content:start}
 .desktop-panel{grid-row:1 / 3}
 .desktop-quote{flex:0 0 auto;min-height:210px}
 .desktop-quote-list{flex:0 0 auto}
}
.mask.open{overflow-y:auto;align-items:flex-start;padding:12px 0}
.mask .sheet{max-height:none;overflow:visible;margin:auto 0;flex-shrink:0}
`;
  style.textContent+=`
.v4-bible-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:9px 0}
.v4-bible-groups button{border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--black);padding:12px;text-align:left;cursor:pointer;min-width:0;display:flex;flex-direction:column;gap:5px}
.v4-bible-groups button strong{font-size:14px;line-height:1.4;overflow-wrap:anywhere}
.v4-bible-groups button small{font-size:11px;color:var(--gray);line-height:1.5}
.v4-bible-groups button span{font-size:12px;font-weight:800;color:var(--blue)}
.v4-bible-group-head{background:var(--blue-soft);border:1px solid #bfdbfe;border-radius:11px;padding:11px;display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0}
.v4-bible-group-head strong{font-size:15px;color:var(--blue)}
.v4-bible-group-head small{font-size:11px;color:var(--gray);display:block;margin-top:4px}
.v4-bible-intro{font-size:13px;line-height:1.6;color:var(--gray);padding:3px}
@media(min-width:900px){.v4-bible-groups{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;
  style.textContent+=`
.v5-home{display:flex;flex-direction:column;gap:14px;padding:18px 5px 8px}
.v5-home h2{font-size:26px;font-weight:850;line-height:1.3}
.v5-home p{font-size:14px;line-height:1.7;color:var(--gray)}
.v5-examples{border-top:1px solid var(--line)}
.v5-examples button,.v5-answers button{display:block;width:100%;border:0;border-bottom:1px solid var(--line);padding:13px 4px;text-align:left;background:transparent;color:var(--blue);font-weight:700;cursor:pointer;font-size:14px;line-height:1.5}
.v5-examples button:after,.v5-answers button:after{content:' →';float:right;color:var(--gray)}
.v5-textlink{border:0;background:none;color:var(--blue);font-size:13px;font-weight:700;padding:8px 0;cursor:pointer;text-align:left}
.v5-secondary{border-top:1px solid var(--line);padding-top:10px}
.v5-secondary summary{font-size:13px;color:var(--gray);cursor:pointer}
.v5-secondary .v4-cats{margin-top:12px}
.v5-turns{display:flex;flex-direction:column;gap:6px;align-items:flex-end;margin:6px 0 12px}
.v5-user{background:var(--blue);color:white;padding:10px 14px;border-radius:15px 15px 3px 15px;font-size:14px;max-width:90%;overflow-wrap:anywhere}
.v5-reply{background:white;border:1px solid var(--line);border-radius:3px 15px 15px 15px;padding:14px;line-height:1.65;font-size:14px}
.v5-reply strong{font-size:12px;color:var(--blue)}
.v5-reply p{margin:5px 0;color:var(--black)}
.v5-reply .v5-conditions{font-size:12px;color:var(--gray)}
.v5-send{border:0;border-radius:10px;background:var(--blue);color:white;font-weight:800;min-width:52px;height:36px;padding:0 10px;cursor:pointer}
.v5-answers button{padding:9px 0;font-size:13px}
.v5-answers button:last-child{border-bottom:0}
@media(max-width:899px){.v5-home h2{font-size:23px}.v5-home{padding-top:15px}.big-search-box{gap:5px}.big-search-box input{font-size:16px}.v5-send{min-width:45px;padding:0 7px;font-size:13px}}
`;
  style.textContent+=`
/* V6: a single page scroll, instant search, and a full-page order list. */
html,body{height:auto!important;min-height:100%;overflow:visible!important}
.shell{height:auto!important;min-height:100dvh;overflow:visible!important}
.stage,.idle-box,.stream,#stream,#recentList,.desktop-panel,.desktop-quote-list,.v4-guide,.v4-nav{overflow:visible!important;max-height:none!important}
[hidden]{display:none!important}
.v5-home{padding:22px 3px 8px;gap:9px}.v5-home h2{font-size:23px}
.v5-home p{font-size:13px}
.v6-assist{font-size:13px;line-height:1.6;color:var(--gray);padding:8px 0}
.v6-assist strong{color:var(--red);font-size:16px}
.v6-assist summary{cursor:pointer;color:var(--blue);font-weight:700}
.v6-refine{display:flex;flex-wrap:wrap;gap:7px 13px;margin-top:5px}
.v6-refine button{border:0;background:none;color:var(--blue);padding:5px 0;text-decoration:underline;cursor:pointer;font-weight:600}
.v6-check{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:23px;height:23px;border:1.5px solid #9ca3af;border-radius:5px;background:#fff;color:transparent;font-size:17px;font-weight:800;cursor:pointer;padding:0}
.v6-check[aria-checked="true"]{background:var(--blue);border-color:var(--blue);color:#fff}
.item-card.v6-selected{background:var(--blue-soft);border-color:var(--blue)}
.v6-price{font-size:16px;font-weight:800;white-space:nowrap;color:var(--black)}
.v6-in-cart{font-size:11px;color:var(--blue);font-weight:700}
.v6-details{font-size:12px;color:var(--gray);line-height:1.5;margin-top:6px;overflow-wrap:anywhere}
.v6-order-page .shell{display:none!important}
.mask.v6-order{position:static;inset:auto;display:block;opacity:1;pointer-events:auto;background:transparent;backdrop-filter:none;overflow:visible!important;padding:0;transition:none}
.mask.v6-order .sheet{transform:none;max-width:850px;max-height:none!important;overflow:visible!important;margin:0 auto;min-height:100dvh;border-radius:0;background:var(--bg);padding:16px 14px 24px;transition:none}
.v6-order-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:4px 0 16px}
.v6-order-head strong{font-size:22px}
.v6-order-rows{background:white;border:1px solid var(--line);border-radius:12px;padding:0 12px}
.v6-order-rows .q-row{gap:8px}
.v6-order-rows .q-row:last-child{border-bottom:0}
.v6-order-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}
.v6-order-actions button{min-height:46px;font-weight:750}
.v6-order-foot{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--gray);margin-top:10px}
.v6-order-foot button{background:none;border:0;color:var(--red);font-size:13px;cursor:pointer}
.v6-order-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.6;border-top:1px solid var(--line);padding:12px 0;color:var(--gray)}
#ocrModelStatus{display:none!important}
@media(max-width:899px){
 .shell{display:flex;padding:8px 12px 14px;gap:8px}
 .top-bar{order:0;position:sticky;top:0;background:var(--bg);z-index:15;padding:6px 0;height:48px;min-height:48px}
 .dock-wrap{order:1;position:sticky!important;top:48px;bottom:auto;z-index:14;box-shadow:none;background:var(--bg);padding:0 0 7px}
 .ocr-banner{order:2}
 .stage{order:3;flex:1 0 auto;display:flex;flex-direction:column;min-height:0}
 .big-search-box{height:49px;border-width:1.5px;box-shadow:none}
 .action-grid{gap:6px}.big-act{height:37px;font-size:12px}
 .hero,.hero.show{display:none!important}
 .item-card{padding:12px 10px;gap:9px;border-radius:10px}
 .ic-name{font-size:14px}.v6-price{font-size:15px}
 .v4-end{gap:3px}
 .db-badge{display:none}
}
@media(min-width:900px){.stage{grid-template-rows:auto auto}.v6-price{font-size:18px}.v6-order-actions{grid-template-columns:1fr 1fr}}
`;
  style.textContent+=`
.v7-mode{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--gray);padding:2px 1px}
.v7-mode button,.v7-text{border:0;background:none;color:var(--blue);padding:4px 0;font-size:13px;font-weight:700;cursor:pointer;text-align:left}
.v7-home-title{font-size:14px;font-weight:750;color:var(--black);margin:13px 0 5px}
.v7-common{display:flex;flex-direction:column}
.v7-common-row{display:flex;align-items:center;gap:9px;padding:10px 0;border-bottom:1px solid var(--line)}
.v7-common-row .ic-main{min-width:0}
.v7-common-row button.v7-name{background:none;border:0;cursor:pointer;color:var(--black);padding:0;text-align:left;font-size:14px;line-height:1.45;font-weight:650}
.v7-common-row small,.v7-reason{font-size:11px;color:var(--gray);line-height:1.5;display:block;margin-top:3px}
.v7-book-quick{display:flex;flex-direction:column;margin-top:6px}
.v7-book-quick button{border:0;background:none;color:var(--blue);font-size:13px;font-weight:650;text-align:left;padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer}
.v7-related{padding:12px 5px;border-top:1px solid var(--line);margin-top:10px}
.v7-related summary{cursor:pointer;color:var(--blue);font-size:14px;font-weight:700}
.v7-shop{font-size:12px;color:var(--blue);font-weight:750;white-space:nowrap;text-decoration:none;border:0;background:none;padding:4px 0;cursor:pointer}
.v7-church{display:flex;flex-direction:column;gap:5px;margin:12px 0;font-size:12px;color:var(--gray)}
.v7-church input{font:inherit;font-size:16px;color:var(--black);border:1px solid var(--line);background:white;border-radius:9px;padding:10px 12px;width:100%;min-width:0}
.v7-church small{font-size:11px}
.v7-scope{font-size:12px;color:var(--gray);display:flex;align-items:center;justify-content:space-between;gap:8px}
.v7-scope button{border:0;background:none;color:var(--blue);font-size:12px;font-weight:700;cursor:pointer}
.v7-reader .quote-pill,.v7-reader #desktopQuote{display:none!important}
.v7-reader #heroAddBtn{display:none!important}
@media(max-width:899px){#v7Mode{order:2}.ocr-banner{order:3}.stage{order:4}.v7-home-title{margin-top:9px}.v7-mode{font-size:11px}} @media(min-width:900px){#v7Mode{order:2}.ocr-banner{order:3}.stage{order:4}}
`;
  style.textContent+=`
.v8-filter{order:2;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--gray);padding:2px 0}
.v8-filter select,.v8-bible-label select{font:inherit;color:var(--black);background:#fff;border:1px solid var(--line);border-radius:7px;padding:7px 9px;min-width:0;max-width:100%;flex:1}
.v8-filter select{max-width:260px}
.v8-bible-label{display:flex;align-items:center;gap:8px;color:var(--gray);font-size:13px;margin:3px 0}
.v8-example{font-size:12px!important;color:var(--gray)}
.v5-home{gap:5px;padding-top:16px}
.v7-related summary{font-size:13px}
.v4-end .v7-shop{font-size:11px;white-space:nowrap}
@media(max-width:899px){.ocr-banner{order:3}.stage{order:4}.v8-filter select{max-width:none}.v4-end{gap:4px}}
@media(min-width:900px){.ocr-banner{order:3}.stage{order:4}}
`;
  document.head.appendChild(style);
  $('idleBox').insertAdjacentHTML('afterbegin','<div class="v5-home"><h2>找商品，也找好書</h2><p>輸入品名、代碼、規格或閱讀主題。勾選商品即可製作訂單，也可前往商城。</p><p class="v8-example">例如：中型拉鍊聖經、家庭祭壇、C299</p></div>');
  document.querySelector('.dock-wrap').insertAdjacentHTML('afterend','<div id="v8Filter" class="v8-filter"><label for="v8Category">瀏覽</label><select id="v8Category" aria-label="瀏覽商品分類"><option value="">全部商品／搜尋</option><option value="publisher">腓利門書籍（C001–C300）</option>'+Object.entries(cats).filter(([k])=>k!=='all').map(([k,v])=>'<option value="'+k+'">'+esc(v)+'</option>').join('')+'<option value="all">全部商品清單</option></select></div>');
  function miniRow(p,reason=''){
    const chosen=state.quote.some(x=>x.code===p.code);
    return '<div class="v7-common-row">'+'<button type="button" class="v6-check" role="checkbox" aria-checked="'+chosen+'" aria-label="'+esc('訂購 '+p.name)+'" data-v6-toggle="'+esc(p.code)+'" '+(ready?'':'disabled')+'>✓</button>'+'<div class="ic-main"><button type="button" class="v7-name" data-v7-code="'+esc(p.code)+'">'+esc(p.name)+'</button><small>'+esc(p.code)+(reason?'・'+esc(reason):'')+'</small></div><div class="v4-end"><span class="v6-price">$'+p.price+'</span>'+(shopLink(p))+'</div></div>';
  }
  function renderHomeGuide(){document.body.classList.remove('v7-reader');}
  $('searchInput').placeholder='商品名稱、代碼、規格…';
  $('searchInput').setAttribute('enterkeyhint','search');
  $('searchInput').type='text';
  $('idleBox').querySelectorAll('.idle-title,.idle-sub').forEach(e=>e.remove());
  $('heroName').insertAdjacentHTML('afterend','<div id="v4HeroSpec" class="hero-spec"></div>');
  $('heroAddBtn').textContent='＋ 訂購';
  $('desktopQuote').querySelector('.desktop-quote-head strong').innerHTML='訂購清單 <small style="font-size:11px;color:var(--gray)">草稿</small>';
  $('desktopCopyQuote').textContent='確認及複製訂單';
  const oldHead=$('listHead').innerHTML;
  $('listHead').innerHTML='<div id="v5Conversation" style="display:none"></div><div id="v4Nav" class="v4-nav"></div><div id="v4BibleGroups" style="display:none"></div><details id="v4Guide" class="v4-guide" style="display:none"><summary>聖經規格篩選（展開／收合）</summary><div id="v4Sizes" class="size-row"></div><div id="v4Facets" class="v4-facets"></div><p class="v4-note">尺寸圖為相對大小示意。規格依名稱及已知型號推定；未標示不等於沒有。相同 ISBN 保留各自代碼。</p><div id="v4FilterStatus" class="v4-filter-status" role="status"></div><div class="v4-filter-tools"><button class="v4-close" type="button" id="v4Reset">清除規格</button><button class="v4-close" type="button" id="v4ViewResults">查看商品</button></div></details><div class="v4-list-summary">'+oldHead+'</div>';
  $('expandOcrBtn').addEventListener('click',()=>{ocrShowAll=true;render();});
  function renderNav(){
    $('v4Nav').innerHTML='<button type="button" data-v4-category="">首頁</button>'+Object.entries(cats).map(([k,v])=>'<button type="button" data-v4-category="'+k+'" class="'+(category===k?'active':'')+'">'+v+'</button>').join('');
    const g=$('v4Guide'), groupEl=$('v4BibleGroups');
    const choosing=category==='bible'&&!bibleGroup&&!state.query.trim();
    groupEl.style.display=category==='bible'?'block':'none';
    g.style.display=category==='bible'&&bibleGroup?'block':'none';
    if(category==='bible'){
      groupEl.innerHTML='<label class="v8-bible-label">聖經種類<select id="v8BibleGroup" aria-label="聖經種類"><option value="">請選種類</option>'+Object.entries(bibleGroups).map(([k,[title]])=>{const n=groupProducts(k).length;return n?'<option value="'+esc(k)+'" '+(bibleGroup===k?'selected':'')+'>'+esc(title)+'（'+n+'）</option>':''}).join('')+'</select></label>';
    }else groupEl.innerHTML='';
    if(category==='bible'&&bibleGroup){
      if(g.dataset.started!==bibleGroup){g.open=true;g.dataset.started=bibleGroup}
      $('v4Sizes').style.display='none';
      $('v4Sizes').innerHTML=[['輕便型',35,'CU5'],['中型',46,'CU6'],['大字版',57,'CU8'],['特大字版',72,'CU9']].map(([v,h,c])=>'<button type="button" data-v4-size="'+v+'" class="'+(filters.size===v?'active':'')+'"><i style="height:'+h+'px">聖經</i>'+v+'<small>'+c+'</small></button>').join('');
      $('v4Facets').innerHTML=visibleFacetKeys().map(k=>{
        const [label]=facets[k],opts=optionsFor(k);
        if(!opts.length)return '';
        return '<label>'+label+'<select data-v4-facet="'+k+'"><option value="">不限</option>'+opts.map(v=>'<option value="'+esc(v)+'" '+(filters[k]===v?'selected':'')+'>'+esc(v)+'（'+bibleCount(k,v)+'）</option>').join('')+'</select></label>';
      }).join('')||'<p class="v4-note">此系列目前以品名、語言及型號供選擇；未有可靠規格的欄位不顯示。</p>';
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
    if(q)q.qty=Math.min(9999,q.qty+1);else {state.quote.push({code,qty:1});guide?.note(findCode(code));}
    renderQuotePill();showToast('已加入訂購清單');
  }
  function toggleOrder(code){if(!ready||!findCode(code))return;const q=state.quote.find(x=>x.code===code);if(q){state.quote=state.quote.filter(x=>x!==q);render();}else{state.quote.push({code,qty:1});guide?.note(findCode(code));render();}}
  function qty(code,v){const q=state.quote.find(x=>x.code===code);if(!q)return;q.qty=Math.max(0,Math.min(9999,Math.floor(Number(v)||0)));if(!q.qty)state.quote=state.quote.filter(x=>x!==q);renderQuotePill()}
  function orderText(){
    return (churchName?'【'+churchName+' 書報組】\n':'')+rows().map(({q,p})=>p.code+' '+p.name+' × '+q.qty+(p.unit||'件')).join('\n');
  }
  function updatePreview(){if($('v4Preview'))$('v4Preview').value=orderText()}
  const oldPill=renderQuotePill;
  renderQuotePill=function(){
    oldPill();const r=rows();
    $('quotePill').style.display='inline-flex';
    $('quotePillTxt').textContent='訂單 '+r.reduce((s,{q})=>s+q.qty,0)+' 件';
    $('desktopCopyQuote').disabled=!r.length||!ready;
    $('desktopCopyQuote').textContent='複製訂單';
    $('desktopClearQuote').disabled=!state.quote.length;
    if(!r.length&&desktopMedia.matches)$('desktopQuoteList').innerHTML='<div class="desktop-quote-empty">勾選商品即可加入訂單。</div>';
    save();
  };
  function browse(c){discoveryList=null;bookOnly=false;forceAll=false;resetChat();resetOCR();category=c;bibleGroup='';state.query='';state.activeCode='';$('searchInput').value='';detail=false;limit=12;Object.keys(filters).forEach(k=>filters[k]='');render();window.scrollTo(0,0)}
  render=function(){
    document.body.classList.remove('v7-reader');
    $('v8Category').value=bookOnly?'publisher':(category||'');
    const q=state.query.trim(),home=!chatActive&&!q&&!category&&!state.activeCode&&!bookOnly;
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
      renderHomeGuide();
      renderHero(null);
      const r=state.recent.map(findCode).filter(Boolean);
      $('recentWrap').style.display='none';
      $('recentList').innerHTML=r.map(p=>'<div class="item-card" data-recent="'+esc(p.code)+'"><div class="ic-main"><div class="ic-name">'+esc(p.name)+'</div><div class="ic-sub">'+esc(p.code)+' · '+stock(p)+'</div></div><div class="ic-price">$'+p.price+'</div></div>').join('');
      renderQuotePill();return;
    }
    renderNav();
    $('v4Nav').hidden=true;
    $('v4BibleGroups').hidden=chatActive||category!=='bible';
    $('v4Guide').hidden=chatActive||category!=='bible'||!bibleGroup;
    $('v5Conversation').hidden=true;
    if(category==='bible'&&!bibleGroup&&!q&&!chatActive){renderHero(null);$('stream').style.display='none';$('countLabel').textContent=groupProducts('').length+' 款・請選種類';$('expandOcrBtn').style.display='none';renderQuotePill();return;}
    if(bookOnly&&!q)bookReasons=new Map();
    if(bookOnly&&!q&&!discoveryList)discoveryList=guide?.discoveryOrder(products,audience)||[];
    const result=bookOnly&&!q?{items:discoveryList.slice(0,limit),totalHits:discoveryList.length}:getFiltered();
    chatPanel(result);
    if(bookOnly&&!q){const el=$('v5Conversation');el.hidden=false;el.style.display='';el.innerHTML='<div class="v7-scope"><span>探索腓利門書籍</span><button type="button" id="v72Refresh">換個順序</button></div>';}
    else if(bookOnly||bookReasons.size){const el=$('v5Conversation');if(result.totalHits){el.hidden=false;el.style.display='';el.innerHTML='<div class="v7-scope"><span>'+(bookOnly?'腓利門書籍':'書籍主題與經卷搜尋')+'</span><button type="button" id="v7AllSearch">查全部商品</button></div>';}else if(bookOnly){el.hidden=false;el.style.display='';el.innerHTML='<div class="v7-scope"><span>書籍查無結果</span><button type="button" id="v7AllSearch">查全部商品</button></div>';}}
    if(category==='bible'&&bibleGroup&&!chatActive){
      const n=result.totalHits;
      const status=$('v4FilterStatus');status.textContent=ready?(n?'符合條件：'+n+' 款':'查無此款｜目前商品資料沒有符合全部條件的聖經'):'商品資料載入中或未載入';status.classList.toggle('zero',ready&&n===0);
      $('v4ViewResults').textContent=n?'查看 '+n+' 款商品':'查看查詢結果';
      $('v4Guide').querySelector('summary').textContent='聖經規格篩選'+(ready?'（'+(n?n+' 款':'查無此款')+'）':'');
    }
    let items=result.items;
    if(!q&&!category&&state.activeCode){const p=findCode(state.activeCode);items=p?[p]:[];result.totalHits=items.length}
    let active=items.find(p=>p.code===state.activeCode)||null;
    if(!active&&!ocrRaw&&q&&items.length===1&&desktopMedia.matches){active=items[0];state.activeCode=active.code}
    if(!active&&!ocrRaw&&q&&desktopMedia.matches&&items.length>1&&!category&&!items.some(p=>p.barcode.toLowerCase()===q.toLowerCase())){active=items[0];state.activeCode=active.code}
    if(active&&(!ocrRaw||ocrConfirmed))recordRecent(active.code);
    renderHero(ocrRaw&&!ocrConfirmed?null:active);
    const expand=$('expandOcrBtn');expand.style.display=ocrRaw&&!ocrShowAll&&result.allHits>result.totalHits?'inline-block':'none';
    $('countLabel').textContent=items.length<result.totalHits?'顯示 '+items.length+'／'+result.totalHits+' 筆':result.totalHits+' 筆';
    $('stream').innerHTML=items.map(p=>{
      const selected=state.quote.find(x=>x.code===p.code);
      return '<div class="item-card'+(selected?' v6-selected':'')+'" data-code="'+esc(p.code)+'">'+'<button type="button" role="checkbox" aria-checked="'+!!selected+'" aria-label="'+esc('訂購 '+p.name)+'" class="v6-check" data-v6-toggle="'+esc(p.code)+'" '+(ready?'':'disabled')+'>✓</button>'+'<div class="ic-main"><div class="ic-name">'+esc(p.name)+'</div>'+(bookReasons.has(p.code)?'<span class="v7-reason">'+esc(bookReasons.get(p.code))+'</span>':'')+(isBible(p)?'<div class="v4-note">'+esc(summary(p))+'</div>':'')+'<div class="ic-sub"><span class="mono">'+esc(p.code)+'</span><span style="color:'+(p.qty<=0?'var(--red)':'var(--gray)')+'">'+stock(p)+'</span></div>'+(detail&&active?.code===p.code?'<div class="v6-details">條碼／ISBN：'+esc(p.barcode)+(p.spec?'　規格：'+esc(p.spec):'')+'</div>':'')+'</div><div class="v4-end"><div class="v6-price">$'+p.price+'</div>'+(selected?'<span class="v6-in-cart">已選 '+selected.qty+'</span>':'')+shopLink(p)+'</div></div>';
    }).join('')||'<div class="v4-note" style="padding:25px;text-align:center">'+(ready?'查無商品，請換個品名或代碼。':'商品資料尚未載入，請重新整理。')+'</div>';
    if(ready&&category==='bible'&&!items.length&&!chatActive){
      const selected=Object.entries(filters).filter(([,v])=>v);
      const suggestions=selected.map(([k,v])=>({k,v,n:bibleCount(k,'')})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
      $('stream').innerHTML='<div class="v4-empty" role="status"><strong>查無此款</strong><p>目前商品目錄中，沒有完全符合你所選條件的聖經。這不代表聖經公會沒有出版此款，也不等同於缺貨。</p>'+
        (selected.length?'<div class="v4-condition">已選條件：'+selected.map(([k,v])=>esc(facets[k][0]+'：'+v)).join('、')+'</div>':'')+
        (q?'<div class="v4-condition">搜尋文字：'+esc(q)+'</div>':'')+
        (suggestions.length?'<p>放寬以下一項即可找到其他候選商品：</p>'+suggestions.map(x=>'<button type="button" class="v4-close" data-v4-relax="'+esc(x.k)+'">取消'+esc(facets[x.k][0])+'條件（'+x.n+' 款）</button>').join(''):'')+
        '<button type="button" class="v4-close" id="v4EditFilters">調整聖經規格</button><button type="button" class="v4-close" id="v4ResetAll">清除條件及搜尋文字</button></div>';
    }
    if(chatActive&&chatBible&&!items.length&&!bookOnly&&!forceAll)$('stream').innerHTML='';
    const focused=items.length===1?items[0]:(detail?active:null);
    if(guide&&focused&&(!ocrRaw||ocrConfirmed)){const related=guide.related(products,focused,audience).filter(x=>!items.some(p=>p.code===x.p.code)&&eligible(x.p)).slice(0,3);if(related.length)$('stream').insertAdjacentHTML('beforeend','<details class="v7-related"><summary>相關商品（'+related.length+'）</summary>'+related.map(x=>miniRow(x.p)).join('')+'</details>');}
    if(!ocrRaw&&items.length<result.totalHits)$('stream').insertAdjacentHTML('beforeend','<button type="button" class="v4-more" id="v4More">顯示更多商品</button>');
    renderQuotePill();
  };
  const previousClose=closeMask;
  closeMask=function(){
    if(orderPage){orderPage=false;document.body.classList.remove('v6-order-page');$('mask').classList.remove('v6-order','open');render();window.scrollTo(0,returnScroll);return}
    previousClose();
  };
  openQuoteSheet=function(){
    if(!orderPage){returnScroll=window.scrollY;orderPage=true;document.body.classList.add('v6-order-page');$('mask').classList.add('v6-order','open');window.scrollTo(0,0)}
    const r=rows(),total=r.reduce((n,{p,q})=>n+p.price*q.qty,0);
    const html=r.map(({q,p})=>'<div class="q-row"><div style="flex:1;min-width:0"><strong style="font-size:14px;overflow-wrap:anywhere">'+esc(p.name)+'</strong><div class="ic-sub">'+esc(p.code)+' · $'+p.price+'</div></div><div class="q-step"><button type="button" data-v4-q="'+esc(p.code)+'" data-delta="-1" aria-label="減少">−</button><input class="v4-qty" type="number" min="0" max="9999" inputmode="numeric" data-v4-qty="'+esc(p.code)+'" value="'+q.qty+'" aria-label="數量"><button type="button" data-v4-q="'+esc(p.code)+'" data-delta="1" aria-label="增加">+</button></div></div>').join('');
    const churchField='<label class="v7-church">教會名稱（選填）<input id="v7ChurchName" type="text" list="v7ChurchNames" autocomplete="off" placeholder="輸入教會名稱" value="'+esc(churchName)+'"><datalist id="v7ChurchNames">'+(guideData?.churchNames||[]).map(n=>'<option value="'+esc(n)+'"></option>').join('')+'</datalist><small>只帶入所選教會名稱，不記錄個人或聯絡資料。</small></label>';
    $('sheet').innerHTML='<div class="v6-order-head"><strong>訂購清單</strong><button type="button" class="v4-close" data-close="1">繼續選購</button></div>'+churchField+(r.length?'<div class="v6-order-rows">'+html+'</div>':'<p class="v4-note">尚未勾選商品。</p>')+(state.quote.length>r.length?'<p class="v4-note">部分草稿商品不在目前目錄，請重新核對。</p>':'')+'<div class="desktop-quote-total"><span>共 '+r.length+' 款／'+r.reduce((n,{q})=>n+q.qty,0)+' 件</span><strong class="num" style="color:var(--blue)">NT$ '+total.toLocaleString()+'</strong></div><div class="v6-order-actions"><button class="btn-full" type="button" id="v4Copy" '+(!ready||!r.length?'disabled':'')+'>複製訂單</button><button class="btn-outline" type="button" id="v4Line" '+(!ready||!r.length?'disabled':'')+'>傳 LINE</button></div><div class="v6-order-foot"><span>參考金額，實際供貨由書房確認。</span><button type="button" id="v4Clear">清空</button></div>'+(r.length?'<div class="v6-order-text">'+esc(orderText())+'</div>':'');
  };
  // Capture handlers replace only order-related original listeners.
  document.addEventListener('click',e=>{
    const t=e.target.closest('#v72Refresh,[data-v7-store],[data-v7-code],[data-v7-bookquery],#v7AllSearch,[data-v6-toggle],[data-v5-query],[data-v5-facet],[data-v5-relax],#v5Send,#v5New,#v5Skip,#v5RelaxWords,#v5RelaxBudget,[data-v4-category],[data-v4-bgroup],#v4ChangeGroup,[data-v4-size],[data-v4-add],[data-v4-relax],#v4Reset,#v4ResetAll,#v4EditFilters,#v4ViewResults,#v4More,#heroAddBtn,#quotePill,#desktopCopyQuote,#desktopClearQuote,[data-desktop-code],[data-v4-q],#v4Copy,#v4Line,#v4Clear');
    if(!t)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(t.dataset.v7Store){copyText(t.dataset.v7Store,'商品代碼');window.open('https://www.pbooks.com.tw/','_blank','noopener,noreferrer');return}
    if(t.id==='v72Refresh'){if(guide&&discoveryList){discoveryList=guide.discoveryOrder(products,audience);const n=Math.min(12,discoveryList.length);if(n>1)discoveryList=[...discoveryList.slice(n),...discoveryList.slice(0,n)];limit=12;render();window.scrollTo(0,0);}return;}
    if(t.id==='v7AllSearch'){bookOnly=false;forceAll=true;const val=$('searchInput').value;if(val.trim())beginChat(val,true);else browse('');return}
    if(t.dataset.v7Code){guide?.note(findCode(t.dataset.v7Code));bookOnly=false;forceAll=false;$('searchInput').value=t.dataset.v7Code;beginChat(t.dataset.v7Code,true);window.scrollTo(0,0);return}
    if(t.dataset.v7Bookquery){forceAll=false;const val=t.dataset.v7Bookquery;if(val==='__all'){browse('');bookOnly=true;render();return}bookOnly=true;$('searchInput').value=val;beginChat(val,true);return}
    if(t.dataset.v6Toggle){const code=t.dataset.v6Toggle,pos=window.scrollY;toggleOrder(code);window.scrollTo(0,pos);return}
    if(t.id==='v5Send')return beginChat($('searchInput').value);
    if(t.dataset.v5Query){$('searchInput').value=t.dataset.v5Query;return beginChat(t.dataset.v5Query,true)}
    if(t.id==='v5New')return browse('');
    if(t.id==='v5Skip'){if(chatPending)chatSkipped.add(chatPending);return render()}
    if(t.dataset.v5Facet){const k=t.dataset.v5Facet,v=t.dataset.v5Value;filters[k]=v;delete chatNeg[k];chatSkipped.delete(k);chatTurns.push(v);chatTurns=chatTurns.slice(-4);state.activeCode='';detail=false;limit=6;return render()}
    if(t.dataset.v5Relax){filters[t.dataset.v5Relax]='';delete chatNeg[t.dataset.v5Relax];state.activeCode='';detail=false;return render()}
    if(t.id==='v5RelaxWords'){chatTerms=[];state.activeCode='';return render()}
    if(t.id==='v5RelaxBudget'){chatBudget=null;state.activeCode='';return render()}
    if(t.hasAttribute('data-v4-category'))return browse(t.dataset.v4Category);
    if(t.dataset.v4Bgroup){bibleGroup=t.dataset.v4Bgroup;state.activeCode='';detail=false;limit=12;Object.keys(filters).forEach(k=>filters[k]='');render();$('v4BibleGroups').scrollIntoView({block:'start',behavior:'auto'});return}
    if(t.id==='v4ChangeGroup')return browse('bible');
    if(t.dataset.v4Size){filters.size=filters.size===t.dataset.v4Size?'':t.dataset.v4Size;state.activeCode='';detail=false;limit=12;return render()}
    if(t.id==='v4Reset'||t.id==='v4ResetAll'){Object.keys(filters).forEach(k=>filters[k]='');if(t.id==='v4ResetAll'){resetOCR();state.query='';$('searchInput').value='';}state.activeCode='';detail=false;limit=12;$('v4Guide').open=true;return render()}
    if(t.id==='v4EditFilters'){$('v4Guide').open=true;$('v4Guide').scrollIntoView({block:'start',behavior:'auto'});return}
    if(t.id==='v4ViewResults'){$('v4Guide').open=false;$('listHead').scrollIntoView({block:'start',behavior:'auto'});return}
    if(t.dataset.v4Relax){filters[t.dataset.v4Relax]='';state.activeCode='';detail=false;limit=12;render();return}
    if(t.id==='v4More'){const pos=window.scrollY;limit+=12;render();window.scrollTo(0,pos);return}
    if(t.dataset.v4Add)return add(t.dataset.v4Add);
    if(t.id==='heroAddBtn'){if(state.activeCode&&(!ocrRaw||ocrConfirmed))add(state.activeCode);return}
    if(t.id==='quotePill')return openQuoteSheet();
    if(t.id==='desktopCopyQuote'){const txt=orderText();if(ready&&txt)copyText(txt,'訂購內容');return}
    if(t.id==='desktopClearQuote'||t.id==='v4Clear'){if(confirm('確定清空訂購草稿？')){state.quote=[];renderQuotePill();if(t.id==='v4Clear')openQuoteSheet()}return}
    const code=t.dataset.v4Q||t.dataset.desktopCode;
    if(code){const q=state.quote.find(x=>x.code===code);if(q)qty(code,q.qty+Number(t.dataset.delta));if(t.dataset.v4Q)openQuoteSheet();return}
    if(t.id==='v4Copy'){const txt=orderText();if(ready&&txt)copyText(txt,'訂購內容');return}
    if(t.id==='v4Line'){const txt=orderText('name',false);if(!ready||!txt)return;if(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent))window.open('https://line.me/R/share?text='+encodeURIComponent(txt),'_blank','noopener,noreferrer');else copyText(txt,'商品明細，請貼到 LINE')}
  },true);
  $('v8Category').addEventListener('change',e=>{const value=e.target.value;if(value==='publisher'){browse('');bookOnly=true;render();}else browse(value);});
  $('listHead').addEventListener('change',e=>{
    if(e.target.id==='v8BibleGroup'){bibleGroup=e.target.value;Object.keys(filters).forEach(k=>filters[k]='');state.activeCode='';detail=false;limit=12;render();}
    if(e.target.id==='v8Question'){const k=e.target.dataset.facet,v=e.target.value;if(v==='__skip')chatSkipped.add(k);else if(v){filters[k]=v;delete chatNeg[k];chatSkipped.delete(k);}state.activeCode='';detail=false;limit=12;render();}
  });
  $('v4Facets').addEventListener('change',e=>{const k=e.target.dataset.v4Facet;if(k){filters[k]=e.target.value;state.activeCode='';detail=false;limit=12;render()}});
  $('mask').addEventListener('input',e=>{if(e.target.id==='v7ChurchName'){churchName=e.target.value.trim().slice(0,50);const preview=$('sheet').querySelector('.v6-order-text');if(preview)preview.textContent=orderText();return;}const k=e.target.dataset.v4Info;if(k&&Object.prototype.hasOwnProperty.call(info,k)){info[k]=e.target.value;updatePreview()}});
  $('mask').addEventListener('change',e=>{if(e.target.id==='v4Format'){info.format=e.target.value;updatePreview()}if(e.target.dataset.v4Qty){qty(e.target.dataset.v4Qty,e.target.value);openQuoteSheet()}});
  $('stream').addEventListener('click',e=>{const card=e.target.closest('[data-code]');if(card){guide?.note(findCode(card.dataset.code));detail=true;$('v4Guide').open=false}},true);
  $('recentList').addEventListener('click',e=>{if(e.target.closest('[data-recent]')){detail=true;$('v4Guide').open=false}},true);
  $('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();clearTimeout(searchTimer);beginChat($('searchInput').value,true);$('searchInput').blur()}},true);
  let searchTimer=null;
  $('searchInput').addEventListener('input',e=>{e.stopImmediatePropagation();clearTimeout(searchTimer);forceAll=false;const value=e.target.value;if(e.isComposing)return;if(!value.trim()){browse('');return;}searchTimer=setTimeout(()=>beginChat(value,true),/^[a-z0-9][a-z0-9._/-]*$/i.test(value)?0:100);},true);
  $('searchInput').addEventListener('compositionend',e=>{clearTimeout(searchTimer);if(e.target.value.trim())beginChat(e.target.value,true);},true);
  for(const id of ['clearBtn','clearOcrBtn','ocrBtn','barcodeBtn'])$(id).addEventListener('click',()=>{clearTimeout(searchTimer);bookOnly=false;resetChat();category='';bibleGroup='';detail=false;limit=12},true);
  const oldBarcode=onBarcodeHit;
  onBarcodeHit=function(raw){bookOnly=false;resetChat();category='';bibleGroup='';detail=true;limit=12;oldBarcode(raw);const val=String(raw||'').trim().toLowerCase();const matches=products.filter(p=>p.code.toLowerCase()===val||p.barcode.toLowerCase()===val);if(matches.length>1){state.activeCode='';detail=false;render();showToast('同一條碼有多個品項，請核對商品代碼')}};
  window.FindOrderQuery=raw=>{bookOnly=false;$('searchInput').value=raw;beginChat(raw,true);};
  render();
})();
