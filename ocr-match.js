(function(root){
function norm(s){return String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');}
function distance(a,b){let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=row;}return prev[b.length];}
function rank(products,raw){
 const lines=String(raw||'').slice(0,1600).split(/\r?\n/).map(norm).filter(Boolean).slice(0,32);
 const candidates=[];
 for(const order of [lines,[...lines].reverse()]){
   for(let i=0;i<order.length;i++){
     let q='';
     for(let j=i;j<Math.min(i+8,order.length);j++){
       q+=order[j]; if(q.length>80)break;
       if(q.length>=2)candidates.push(q);
     }
   }
 }
 const phrases=[...new Set(candidates)].sort((a,b)=>b.length-a.length).slice(0,240);
 const matches=[];
 for(const p of products){
 const name=norm(p.name), code=norm(p.code), bar=norm(p.barcode), spec=norm(p.spec);
 let best=0;
 for(const q of phrases){
 if(q===code||q===bar){best=1000;break;}
 if(!name)continue;
 if(q===name)best=Math.max(best,200);
 else if(q.length>=3&&q.includes(name)&&name.length>=3)best=Math.max(best,150+Math.min(name.length,30));
 else if(q.length>=3&&name.includes(q))best=Math.max(best,65+70*q.length/name.length+Math.min(q.length,20));
 else if(q.length>=4&&name.length>=4&&Math.abs(q.length-name.length)<=Math.max(2,Math.ceil(name.length*.25))){
 const sim=1-distance(q,name)/Math.max(q.length,name.length);if(sim>=.72)best=Math.max(best,sim*115);
 }
 if(q.length>=4&&spec.includes(q))best=Math.max(best,45);
 }
 if(best>=45)matches.push({p,score:best});
 }
 matches.sort((a,b)=>b.score-a.score||String(a.p.code).localeCompare(String(b.p.code)));
 return {items:matches.slice(0,8).map(x=>x.p),totalHits:matches.length};
}
const api={norm,rank};if(typeof module==='object'&&module.exports)module.exports=api;else root.FindOCR=api;
})(typeof globalThis!=='undefined'?globalThis:this);
