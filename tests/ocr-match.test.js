const test = require('node:test');
const assert = require('node:assert/strict');
const {rank,norm}=require('../ocr-match.js');
const products=[
{code:'C297',barcode:'9781234567890',name:'我的心哪，你為何憂悶？',spec:''},
{code:'C298',barcode:'9781234567891',name:'預見・遇見・癒見',spec:''},
{code:'C299',barcode:'9781234567892',name:'洗腳禮論－教義專論',spec:''}
];
test('normalizes punctuation and full-width characters',()=>assert.equal(norm('Ｃ２９７？'),'c297'));
test('extra lines do not prevent title match',()=>assert.equal(rank(products,'腓利門書房\n我的心哪 你為何憂悶\n作者').items[0].code,'C297'));
test('split lines form title',()=>assert.equal(rank(products,'我的心哪\n你為何憂悶').items[0].code,'C297'));
test('single typo',()=>assert.equal(rank(products,'我的心哪你為何優悶').items[0].code,'C297'));
test('exact code beats fuzzy match',()=>assert.equal(rank(products,'C299\n預見遇見癒見').items[0].code,'C299'));
test('unrelated text returns no result',()=>assert.equal(rank(products,'完全不相干的文字').totalHits,0));
