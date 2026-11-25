(function(root){
const api=(function buildFindOCR(){
  const cache=new WeakMap();
  const norm=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  function grams(s){const out=new Set();for(let n=2;n<=4;n++)for(let i=0;i+n<=s.length;i++){const k=s.slice(i,i+n);if(!/^\d+$/.test(k))out.add(k);}return out;}
  function index(products){
    if(cache.has(products))return cache.get(products);
    const postings=new Map(), exact=new Map(), names=[];
    products.forEach((p,i)=>{
      const name=norm(p.name);names.push(name);
      for(const k of [norm(p.code),norm(p.barcode)])if(k){if(!exact.has(k))exact.set(k,[]);exact.get(k).push(i);}
      for(const k of grams(name)){if(!postings.has(k))postings.set(k,[]);postings.get(k).push(i);}
    });
    const weights=new Map();
    for(const [k,ids] of postings)weights.set(k,(Math.log((products.length+1)/(ids.length+1))+1)*({2:1,3:1.35,4:1.65}[k.length]));
    const idx={postings,exact,names,weights};cache.set(products,idx);return idx;
  }
  const prune=function prune(ranked){
  if(!ranked.length)return ranked;
  const top=ranked[0];
  // Never suppress equally plausible variants. Only prune when strong evidence exists.
  if(top.exact)return ranked.filter(x=>x.exact);
  const strong=top.longest>=4 || (top.distinct>=2 && top.rare>=1);
  const cutoff=top.score*(strong?.42:.22);
  return ranked.filter(x=>x.score>=cutoff || (strong && x.longest>=4 && x.score>=top.score*.30));
};
  function rank(products,raw){
    const idx=index(products);
    const lines=String(raw||'').slice(0,1600).split(/\r?\n/).map(norm).filter(Boolean).slice(0,32);
    const phrases=new Set(lines);
    for(const order of [lines,[...lines].reverse()])for(let i=0;i<order.length;i++){let q='';for(let j=i;j<Math.min(i+8,order.length);j++){q+=order[j];if(q.length>80)break;if(q.length>=2)phrases.add(q);}}
    const scores=new Map(), evidence=new Map(), exactHits=new Set(), tokens=new Set();
    for(const q of phrases){
      for(const id of idx.exact.get(q)||[])exactHits.add(id);
      for(const k of grams(q))if(idx.postings.has(k))tokens.add(k);
    }
    for(const k of tokens){
      const ids=idx.postings.get(k), w=idx.weights.get(k);
      for(const id of ids){
        scores.set(id,(scores.get(id)||0)+w);
        if(!evidence.has(id))evidence.set(id,[]);
        evidence.get(id).push(k);
      }
    }
    for(const id of exactHits)scores.set(id,10000+(scores.get(id)||0));
    const ranked=[];
    for(const [id,base] of scores){
      const matched=evidence.get(id)||[], name=idx.names[id];
      const distinct=matched.filter(k=>!matched.some(t=>t.length>k.length&&t.includes(k)));
      let score=base;
      for(const q of phrases)if(q===name){score+=120;break;}
      const best=distinct.reduce((m,k)=>Math.max(m,idx.weights.get(k)||0),0);
      if(!exactHits.has(id)&&!matched.some(k=>idx.postings.get(k).length<=12||k.length>=3)&&distinct.length<2)continue;
      if(!exactHits.has(id)&&best<3&&distinct.length<2&&!matched.some(k=>idx.postings.get(k).length===1))continue;
      // Only a tiny stock tiebreaker; out-of-stock items remain searchable.
      ranked.push({p:products[id],score:score+(Number(products[id].qty)>0?.05:0),exact:exactHits.has(id),longest:Math.max(0,...matched.map(k=>k.length)),distinct:distinct.length,rare:distinct.filter(k=>idx.postings.get(k).length<=3).length});
    }
    ranked.sort((a,b)=>b.score-a.score||String(a.p.code).localeCompare(String(b.p.code)));
    const visible=prune(ranked);
    return {items:visible.slice(0,8).map(x=>x.p),totalHits:visible.length,allItems:ranked.slice(0,8).map(x=>x.p),allHits:ranked.length};
  }
  return {norm,rank,index};
})();
if(typeof module==='object'&&module.exports)module.exports=api;else root.FindOCR=api;
})(typeof globalThis!=='undefined'?globalThis:this);
