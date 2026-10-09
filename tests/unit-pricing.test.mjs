import test from 'node:test';
import assert from 'node:assert/strict';
import { discountedUnitPrice, itemTotal, cartTotal, editCartItem } from '../lib/pos-core.mjs';
import { validateOrder } from '../lib/state.mjs';
import { orderTotal } from '../lib/orders.mjs';
import { applyPromotions } from '../lib/promotions.mjs';
import { preparePilotSources, finalizePilotExport } from '../lib/pilot-finalize.mjs';
const item = (quantity=1000, price=20, discount=95.5) => ({ code:'E',name:'商品',price,quantity,discount });
const sale = (id, roundingMode, amount) => ({ id,transactionId:id,createdAt:'2026-10-09T01:00:00Z',items:[item()],amount,isValid:true,roundingMode,paymentMethod:'LINE PAY',paymentRecords:[{method:'LINE PAY',amount}],invoiceInfo:{} });
test('discount percentage rounds each physical unit before quantity and before cart aggregation', () => {
  assert.equal(discountedUnitPrice(item()),19);
  assert.equal(itemTotal(item()),19000);
  assert.equal(cartTotal([item(),item(1000,20,97.5)]),39000);
  assert.equal(cartTotal([item(1,10,44),item(1,10,44)]),8);
  assert.equal(orderTotal([item()], 'unit-v1'),19000);
  assert.equal(cartTotal([item(1000,39,50)]),20000);
  assert.equal(cartTotal([item(1000,3,50)]),2000);
});
test('one-decimal percentage is explicit, preserves free lines and refunds with equal magnitude', () => {
  assert.equal(editCartItem(item(),{price:20,quantity:1000,discount:'95.5'}).discount,95.5);
  assert.throws(()=>editCartItem(item(),{price:20,quantity:1,discount:'95.55'}),/一位小數/);
  assert.throws(()=>editCartItem(item(),{price:20,quantity:1,discount:'100.1'}),/0～100/);
  assert.equal(itemTotal(item(1000,20,0)),0);
  assert.equal(itemTotal(item(-1000,20,97.5)),-20000);
  assert.equal(itemTotal(item(1000,-20,97.5)),-20000);
});
test('new order validation rejects quantity-first rounding; unstamped historic orders retain original accounting', () => {
  assert.equal(validateOrder(sale('new','unit-v1',19000)).amount,19000);
  assert.throws(()=>validateOrder(sale('wrong','unit-v1',19100)),/明細不符/);
  const historic=sale('old',undefined,19100);
  assert.equal(validateOrder(historic).amount,19100);
  assert.equal(orderTotal(historic.items),19100);
  assert.equal(itemTotal(item(),'legacy'),19100);
});
test('quantity groups use rounded unit prices, while BOGO gifts remain free physical items', () => {
  const p={ E:{ code:'E',name:'商品',legacyPrice:20,price:20 } };
  const group={id:'tier',type:'tiers',name:'數量活動',codes:['E'],priority:0,tiers:[{quantity:1,mode:'discount',value:95.5}]};
  assert.equal(cartTotal(applyPromotions([item(1000,20,100)],p,[group])),19000);
  const bogo={id:'bogo',type:'bogo',name:'買一送一',codes:['E'],giftCodes:['E'],priority:0};
  const lines=applyPromotions([item(2,20,100)],p,[bogo]);
  assert.equal(lines.length,2);
  assert.equal(lines.find(i=>i.promotionGift).discount,0);
  assert.equal(cartTotal(lines),20);
});
test('PILOT applies unit-rounded prices to export copies only, preserving old transactions and tax/payment grouping', () => {
  const clients={new:sale('new','unit-v1',19000),old:sale('old',undefined,19100)};
  const before=JSON.stringify(clients);
  const prepared=preparePilotSources({clients,products:{ E:{code:'E',name:'商品',ntaxFlag:'1',cost:1,unitCode:'1'} },customerMap:{'0002':{code:'0002',name:'書展',invoiceName:'書展'}},unitMap:{1:'本'},context:{date:'2026/10/09',firstCode:'1153001',firstInvoice:'FR13230001'}});
  let n=0;const final=finalizePilotExport(prepared,{generateERI:type=>({master:'0H5',detail:'0H8',pay:'01E'})[type]+'0010LU0'+String(++n).padStart(6,'0')});
  const objects=rows=>rows.slice(1).map(row=>Object.fromEntries(rows[0].map((k,i)=>[k,row[i]])));
  const masters=objects(final.rows.stkSale1), details=objects(final.rows.stkSale2), vouchers=objects(final.rows.vchrplus);
  assert.equal(masters.reduce((s,m)=>s+Number(m.AMT),0),38100);
  assert.equal(details.reduce((s,d)=>s+Number(d.AMT),0),38100);
  assert.ok(details.some(d=>Number(d.AMT)===19000&&Number(d.QTY)===1000));
  assert.ok(details.some(d=>Number(d.AMT)===19100&&Number(d.QTY)===1000));
  assert.equal(vouchers.reduce((s,v)=>s+Number(v.AMT),0),-38100);
  assert.equal(JSON.stringify(clients),before);
});
