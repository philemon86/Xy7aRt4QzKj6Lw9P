import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateNewProduct,defaultPricing,composeCatalogProduct} from '../lib/catalog.mjs';
import {mergePricingRules,deletePricingRule} from '../lib/pricing-rules.mjs';
import {resolveProductPricing,itemTotal} from '../lib/pos-core.mjs';
const catalog={classes:{'01':'書籍'},kinds:{'B':'書'},units:{'1':'本'},products:[{code:'OLD',barcode:'00123',webBarcode:'00999'}]};
const input={code:' new01 ',name:'手動新增<上>',barcode:'00001234',class:'01',kind:'B',unitCode:'1',ntaxFlag:'1',price:'24',cost:'10',priceMode:'discount',priceValue:'79.5',start:'',end:''};
test('New product normalizes code, keeps barcode leading zeros and stores its initial price rule with the product',()=>{
  const p=validateNewProduct({...input,productRule:{value:0},websitePrice:0,isAdmin:true},catalog);
  assert.equal(p.code,'NEW01');assert.equal(p.barcode,'00001234');assert.equal(p.price,24);
  assert.equal(p.unitCode,'1');assert.equal(p.unit,'1');assert.equal(p.ntaxFlag,'1');
  assert.deepEqual(p.initialPriceRule,{mode:'discount',value:79.5,start:'',end:'',origin:'custom'});
  assert.equal(p.productRule,undefined);assert.equal(p.websitePrice,undefined);assert.equal(p.isAdmin,undefined);
  const rules=mergePricingRules(defaultPricing([], [p]), [], {});
  const priced=resolveProductPricing(composeCatalogProduct(p,{websitePrice:22},rules));
  assert.equal(priced.priceSource,'product');assert.equal(itemTotal({...priced,quantity:1000,discount:priced.defaultDiscount}),19000);
});
test('New product price joins existing editable rules; deletion and later edits never resurrect initial discounts',()=>{
  const p=validateNewProduct(input,catalog),defaults=defaultPricing([], [p]);
  const saved=mergePricingRules(defaults,[],{});deletePricingRule(saved,'products',p.code);
  const after=mergePricingRules(defaults,[],JSON.parse(JSON.stringify(saved)));
  assert.equal(resolveProductPricing(composeCatalogProduct(p,{websitePrice:22},after)).price,22);
  const changed=mergePricingRules(defaults,[],{products:{NEW01:{mode:'price',value:15}}});
  assert.equal(resolveProductPricing(composeCatalogProduct(p,null,changed)).price,15);
  const original=validateNewProduct({...input,priceMode:'default',price:'-10'},catalog);
  assert.equal(original.initialPriceRule,undefined);assert.equal(original.price,-10);
});
test('Duplicate codes/barcodes, malicious fields and invalid catalog choices cannot be created',()=>{
  for(const patch of [{code:'old'},{code:'00999'},{barcode:'00123'},{barcode:'00999'},{barcode:'NEW01'},
    {code:'constructor'},{name:'<img src=x onerror=alert(1)>'},{barcode:'\" onerror=\"x'},
    {class:'__proto__'},{kind:'NO'},{unitCode:'NO'},{price:''},{price:true},{price:'NaN'},
    {ntaxFlag:'2'},{priceMode:'discount',priceValue:'100.1'},{priceValue:'79.55'},
    {start:'2026-02-30'},{start:'2026-10-20',end:'2026-10-19'},{image:'javascript:alert(1)'}])
    assert.throws(()=>validateNewProduct({...input,...patch},catalog),undefined,JSON.stringify(patch));
  const fixed=validateNewProduct({...input,priceMode:'price',priceValue:'19'},catalog);
  assert.equal(fixed.initialPriceRule.mode,'price');assert.equal(fixed.initialPriceRule.value,19);
});
