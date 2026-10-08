import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {parseVariantPrices,parseShop} from '../lib/shop.mjs';
import {applyHanBibleDiscount} from '../lib/shop-collection.mjs';
import {syncShopStep} from '../lib/shop-sync.mjs';
import {repairVerifiedShopPrices} from '../lib/shop-repair.mjs';
import {repairWebsiteZeroCart} from '../lib/pos-core.mjs';

// Observed Cyberbiz get_product_variants(): column 2 = price, column 6 = max_usable_bonus.
const info='65455090,FBJH4102-04,60.0,,65.0,deny,50.0,藍蝶,經文25K - 藍蝶,,0';
test('A positive loyalty cap must never override notebook selling price, even when productData differs',()=>{
 assert.equal(parseVariantPrices(info).get('FBJH4102-04').websitePrice,60);
 const html='<script type="application/ld+json">{"@type":"Product"}</script><script>var productData = '+JSON.stringify([{sku:'FBJH4102-04',price:60,compare_at_price:65,currency:'TWD'}])+';const x={productVariantsInfo: "1,FBJH4102-04,999,,999,deny,50"};</script>';
 assert.equal(parseShop(html,'https://www.pbooks.com.tw/products/fbjh4102')[0].websitePrice,60);
 assert.equal(applyHanBibleDiscount({websitePrice:330,listPrice:330}).websitePrice,297);
 assert.equal(applyHanBibleDiscount({websitePrice:1350,listPrice:1500}).websitePrice,1350);
});

function d1(initial,beforeBatch){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE shop(code TEXT PRIMARY KEY,data TEXT)');
 for(const [code,data] of Object.entries(initial))sqlite.prepare('INSERT INTO shop VALUES(?,?)').run(code,JSON.stringify(data));
 const db={prepare(sql){let values=[];return{bind(...v){values=v;return this},async all(){return{results:sqlite.prepare(sql).all(...values)}},async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}}}}},async batch(qs){beforeBatch?.(sqlite);return Promise.all(qs.map(q=>q.run()))}};
 return{db,sqlite,read(code){return JSON.parse(sqlite.prepare('SELECT data FROM shop WHERE code=?').get(code).data)}};
}
test('Verified repair handles nonzero errors and unavailable SKUs, while protecting concurrent and newer prices',async()=>{
 const old={websitePrice:50,listPrice:65,syncedAt:'2026-10-08T13:00:00Z'};
 const d=d1({A:old,B:old,MISSING:old,NEWER:{...old,syncedAt:'2026-10-09T00:00:00Z'},UNVERIFIED:old},sql=>sql.prepare('UPDATE shop SET data=? WHERE code=?').run(JSON.stringify({...old,websitePrice:99,syncedAt:'2026-10-09T00:00:00Z'}),'B'));
 const checked={priceSchemaVersion:2,syncedAt:'2026-10-08T14:00:00Z',websitePrice:60,listPrice:65};
 const r=await repairVerifiedShopPrices(d.db,{A:checked,B:checked,NEWER:checked,UNVERIFIED:{websitePrice:60},MISSING:{...checked,websitePrice:null,websitePricingUnavailable:true}});
 assert.deepEqual(r,{repaired:2,checked:5,remainingPriceMismatch:0,remainingInvalidZero:0});
 assert.equal(d.read('A').websitePrice,60);assert.equal(d.read('B').websitePrice,99);
 assert.equal(d.read('MISSING').websitePrice,null);assert.equal(d.read('NEWER').websitePrice,50);
 assert.equal(d.read('UNVERIFIED').websitePrice,50);d.sqlite.close();
});
test('Only unfinished lines matching documented corrupt prices recover; manual edits and unrelated historic prices survive',()=>{
 const lines=[{code:'N',price:50,discount:100,quantity:3,priceSource:'website'},
 {code:'N',price:50,discount:100,quantity:1,priceSource:'website',isManual:true},
 {code:'N',price:55,discount:100,quantity:1,priceSource:'website'},
 {code:'N',price:50,discount:0,quantity:1,priceSource:'website',promotionGift:true}];
 const result=repairWebsiteZeroCart(lines,{N:{price:60,defaultDiscount:100,priceSource:'website',websitePriceCorrectionFrom:[50]}});
 assert.equal(result[0].price,60);assert.equal(result[0].quantity,3);assert.equal(lines[0].price,50);
 result.slice(1).forEach((p,i)=>assert.equal(p,lines[i+1]));
});
test('HTML background sync preserves Hanyu collection price after fetching productData',async()=>{
 const job={urls:['https://www.pbooks.com.tw/products/cat6991'],cursor:0,matched:0,failed:0,promotionsAttempted:true,collectionPricesAttempted:true,collectionPrices:{codes:['CAT6991']}};
 const writes=[];
 const db={prepare(sql){let values=[];return{sql,bind(...v){values=v;this.values=v;return this},async first(){return{value:JSON.stringify(job)}},async run(){return{meta:{changes:1}}}}},async batch(qs){writes.push(...qs)}};
 const html='<script type="application/ld+json">{"@type":"Product"}</script><script>var productData = '+JSON.stringify([{sku:'CAT6991',price:330,compare_at_price:330,currency:'TWD'}])+';</script>';
 const r=await syncShopStep(db,{products:[{code:'CAT6991'}]}, {},async()=>new Response(html));
 assert.equal(r.matched,1);assert.equal(JSON.parse(writes.find(q=>q.sql.includes('INSERT INTO shop')).values[1]).websitePrice,297);
});
test('Verified baseline covers all existing cached products and 25K colors match official selling price',()=>{
 const shop=JSON.parse(fs.readFileSync('data/shop-cache.json','utf8'));
 const report=JSON.parse(fs.readFileSync('data/shop-price-field-repair-report.json','utf8'));
 assert.ok(report.checked>=1333);assert.deepEqual(report.remainingUnverified,[]);
 for(const suffix of ['04','05','06']){assert.equal(shop['FBJH4102-'+suffix].websitePrice,60);assert.equal(shop['FBJH4102-'+suffix].listPrice,65)}
 assert.equal(shop.CAT6991.websitePrice,297);assert.equal(shop.CCT12901.websitePrice,1350);
 assert.ok(Object.values(shop).every(p=>p.priceSchemaVersion===2));
 assert.ok(report.unavailableVariants.every(code=>shop[code].websitePrice===null));
});
