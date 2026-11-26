(function(root){const create=function makeBookSearch(data,relations={purchase:{},content:{}}){
  const norm=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const cleanTitle=s=>norm(String(s).replace(/^\s*\d+折\s*\/?/,'').replace(/\([^)]*\)|（[^）]*）/g,''));
  const isBook=p=>/^C\d{3}$/i.test(p.code)&&Number(p.code.slice(1))>=1&&Number(p.code.slice(1))<=300;
  const rankMap=xs=>new Map(xs.map((x,i)=>[x,1-i/Math.max(1,xs.length)]));
  const church=rankMap(data.churchTop), other=rankMap(data.otherTop), recent=rankMap(data.recent),bc=rankMap(data.bookChurch),bo=rankMap(data.bookOther);
  function popularity(p,mode){
    const c=p.code.toUpperCase(), m=mode==='reader'?other:church,b=mode==='reader'?bo:bc;
    const shared=(Math.max(church.get(c)||0,bc.get(c)||0)+Math.max(other.get(c)||0,bo.get(c)||0))/2;
    return shared*5.5+(recent.get(c)||0)*2+(p.qty>0?1:0);
  }
  const topics=data.topics.map(t=>({...t,re:new RegExp(t.pattern,'i'),primarySet:new Set(t.primary),tocSet:new Set(t.toc)}));
  const scriptures=data.scripture.map(t=>({...t,re:new RegExp(t.pattern,'i'),set:new Set(t.codes)}));
  // Ephemeral, per-page recommendation signals. No identifiers, storage or network.
  const seed=Math.floor(Math.random()*2147483647);
  const interests=new Map(), visited=new Set();
  function jitter(key){let h=seed>>>0;for(const c of String(key))h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h/4294967296;}
  function labels(p){
    const c=p.code.toUpperCase();
    return [...topics.filter(t=>t.primarySet.has(c)).map(t=>t.title),...scriptures.filter(t=>t.set.has(c)).map(t=>t.title)];
  }
  function note(p){
    if(!p||!isBook(p)||visited.has(p.code))return;
    visited.add(p.code);
    for(const tag of labels(p))interests.set(tag,Math.min(3,(interests.get(tag)||0)+1));
  }
  function affinity(p){return Math.min(5,labels(p).reduce((n,t)=>n+(interests.get(t)||0),0));}
  function discoveryOrder(products,mode='church'){
    const pool=products.filter(p=>isBook(p)&&p.qty>0&&!/絕版/.test(p.name));
    const ranked=pool.map(p=>({p,tags:labels(p),score:affinity(p)*2+popularity(p,mode)*.65+jitter('discover:'+p.code)*7-(visited.has(p.code)?4:0)}));
    const counts=new Map(),result=[];
    while(ranked.length){
      let best=0,bestScore=-Infinity;
      for(let i=0;i<ranked.length;i++){const x=ranked[i],penalty=Math.max(0,...x.tags.map(t=>counts.get(t)||0))*2;
        const score=x.score-penalty;if(score>bestScore){bestScore=score;best=i;}}
      const [x]=ranked.splice(best,1);result.push(x.p);for(const t of x.tags)counts.set(t,(counts.get(t)||0)+1);
    }
    return [...result,...products.filter(p=>isBook(p)&&!pool.includes(p))];
  }
  function parse(q){
    const raw=String(q||'').normalize('NFKC').trim();
    const t=raw.replace(/^(?:我想找|我想買|請幫我找|幫我找|想找|我要|推薦|請推薦|有沒有|找一本|找書|找)\s*/,'').replace(/(?:有關的書|相關的書|的書籍|的書|書籍推薦|推薦書籍|推薦|有什麼書|書單|有哪些書|有嗎)[。？?！!]*$/,'').trim();
    const ss=scriptures.filter(x=>x.re.test(t)||norm(x.title)===norm(t));
    const ts=topics.filter(x=>x.re.test(t)||norm(x.title)===norm(t));
    const ser=data.series.filter(x=>norm(t).includes(norm(x.title)));
    const toc=Object.entries(data.tocKeywords||{}).filter(([k])=>t.includes(k)).sort((a,b)=>b[0].length-a[0].length);
    return {raw,t,ss,ts,ser,toc};
  }
  function directScore(p,q){
    const n=norm(q);if(!n)return 0;
    const title=cleanTitle(p.name),full=norm(p.name),code=norm(p.code),barcode=norm(p.barcode);
    if(code===n||barcode===n)return 1000;
    if(title===n||full===n)return 250;
    if(title.includes(n))return 150;
    if(full.includes(n))return 135;
    return 0;
  }
  function relevance(p,parsed){
    const code=p.code.toUpperCase();
    const direct=directScore(p,parsed.t);
    let scripture=0,theme=0,series=0,reason=[];
    for(const x of parsed.ss){
      const i=x.codes.indexOf(code);if(i<0)continue;
      // In ordered editorial lists, first entries are dedicated treatments; series volumes follow.
      scripture=Math.max(scripture,110-Math.min(i,8)*4);
      reason.push(x.title+'相關經卷');
    }
    for(const x of parsed.ts){
      if(x.primarySet.has(code)){theme=Math.max(theme,95);reason.push(x.title);}
      else if(x.tocSet.has(code)){theme=Math.max(theme,48);reason.push('目錄涉及'+x.title);}
    }
    for(const [term,codes] of parsed.toc||[])if(codes.includes(code)){theme=Math.max(theme,70+Math.min(term.length,5));reason.push('目錄：'+term);}
    for(const x of parsed.ser)if(x.codes.includes(code)){series=105;reason.push(x.title+'系列');}
    if(direct>=135)reason.unshift('品名相符');
    return {score:Math.max(direct,scripture,theme,series),reason:[...new Set(reason)].slice(0,2)};
  }
  function search(products,q,mode='church',budget=null){
    const parsed=parse(q);
    const found=[];
    for(const p of products){
      if(!isBook(p)||budget!==null&&p.price>budget)continue;
      const r=relevance(p,parsed);
      if(r.score)found.push({p,score:r.score,reason:r.reason});
    }
    const tie=x=>popularity(x.p,mode)+(x.score<135?jitter(parsed.t+':'+x.p.code)*3:0);
    found.sort((a,b)=>b.score-a.score||tie(b)-tie(a)||a.p.code.localeCompare(b.p.code));
    return {matches:found,hasIntent:!!(parsed.ss.length||parsed.ts.length||parsed.ser.length||parsed.toc.length),parsed};
  }
  function related(products,p,mode='unified'){
    if(!p)return [];
    const code=p.code.toUpperCase(),purchase=relations.purchase?.[code]||[],content=relations.content?.[code]||[];
    return products.filter(x=>x.code!==p.code&&x.qty>0&&!/絕版/.test(x.name)).map(x=>{
      const c=x.code.toUpperCase(),reasons=[];
      let editorial=0;
      if(isBook(p)&&isBook(x)){
        for(const s of scriptures)if(s.set.has(code)&&s.set.has(c)){editorial=Math.max(editorial,82);reasons.push(s.title);}
        for(const s of data.series)if(s.codes.includes(code)&&s.codes.includes(c)){editorial=Math.max(editorial,76);reasons.push(s.title+'系列');}
        for(const t of topics)if(t.primarySet.has(code)&&t.primarySet.has(c)){editorial=Math.max(editorial,54);reasons.push(t.title);}
      }
      const i=content.indexOf(c),j=purchase.indexOf(c);
      const text=i<0?0:48-i*7, basket=j<0?0:32-j*5;
      // Co-purchase is separate evidence, not a claim of content similarity.
      if(i>=0)reasons.push('型錄文字相關');
      if(j>=0)reasons.push('曾共同訂購');
      const score=editorial+text+basket;
      return {p:x,score,reason:[...new Set(reasons)].slice(0,2)};
    }).filter(x=>x.score).sort((a,b)=>b.score-a.score||(popularity(b.p,mode)*.5+affinity(b.p)+jitter(code+':'+b.p.code)*3)-(popularity(a.p,mode)*.5+affinity(a.p)+jitter(code+':'+a.p.code)*3)||a.p.code.localeCompare(b.p.code)).slice(0,4);
  }
  function common(products,mode='church',books=false){
    const map=new Map(products.map(p=>[p.code,p]));
    const list=books?(mode==='reader'?data.bookOther:data.bookChurch):(mode==='reader'?data.otherTop:data.churchTop);
    const now=new Date(),m=now.getMonth()+1;
    const seasonal=m>=9||m<=1;
    return list.map(c=>map.get(c)).filter(p=>p&&p.qty>0&&(seasonal||!/(月曆|週曆|周曆|桌曆|年曆)/.test(p.name))).slice(0,6);
  }
  return {isBook,search,related,popularity,common,parse,directScore,note,discoveryOrder};
};if(typeof module==='object'&&module.exports)module.exports=create;else if(root.FindCatalogGuide)root.FindBookSearch=create(root.FindCatalogGuide,root.FindCatalogRelations);})(typeof globalThis!=='undefined'?globalThis:this);
