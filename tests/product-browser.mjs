// Real frontend + real API handler, isolated in-memory DB and test sessions.
import {spawn,execFileSync} from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {sqlite,requestAPI} from './product-server-fixture.mjs';
const {chromium}=await import(process.env.POS_PLAYWRIGHT_MODULE || pathToFileURL(path.resolve(path.dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin='http://127.0.0.1:'+port;
const worker=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','dist/server/wrangler.json','--port',String(port),'--persist-to','work/product-browser-db'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}});
let logs='',browser,debugPage;const errors=[];worker.stdout.on('data',x=>logs=(logs+x).slice(-4000));worker.stderr.on('data',x=>logs=(logs+x).slice(-4000));
async function open(portal,width,fair){
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390,serviceWorkers:'block'});
  await context.route('**/pos/api/**',async route=>{
    const req=route.request(),endpoint=new URL(req.url()).pathname.slice('/pos/api/'.length);
    const result=await requestAPI(endpoint,req.method()==='GET'?undefined:req.postDataJSON(),portal);
    await route.fulfill({status:result.status,contentType:'application/json',body:await result.text()});
  });
  await context.route('**/pos/**',async route=>{
    const pathname=new URL(route.request().url()).pathname,relative=pathname.startsWith('/pos/_next/')?pathname.slice(1):pathname.replace(/^\/pos\//,'');
    const file=path.resolve('dist/client',relative);
    if(!file.startsWith(path.resolve('dist/client')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fallback();
    await route.fulfill({status:200,contentType:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.wasm')?'application/wasm':'application/octet-stream',body:fs.readFileSync(file)});
  });
  const page=await context.newPage();debugPage=page;page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/pos/'+(portal==='admin'?'':portal)+'?event='+fair.id+'&view=checkout');
  await page.frameLocator('iframe').locator('#product-code').waitFor();
  return {context,page,frame:page.frameLocator('iframe')};
}
async function catalogTab(page){
  const trigger=page.locator('[data-slot="sidebar-trigger"]').first();
  await trigger.waitFor();
  const menu=page.getByRole('button',{name:'商品資料',exact:true});
  if(page.viewportSize().width>=768){
    const sidebar=page.locator('[data-slot="sidebar"][data-state]');
    await sidebar.waitFor({state:'attached'});
    if(await sidebar.getAttribute('data-state')==='collapsed')await trigger.click();
  }else if(!(await page.locator('[data-slot="sidebar"][data-mobile="true"]').count()))await trigger.click();
  await menu.click();
  if(page.viewportSize().width<768)await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:'商品列表',exact:true}).waitFor();
}
try {
  let ready=false;for(let n=0;n<40;n++){try{ready=(await fetch(origin+'/pos/')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,1000));}assert.ok(ready,logs);
  browser=await chromium.launch({channel:'msedge',headless:true});
  const catalog=await(await requestAPI('catalog')).json();
  for(const width of [1440,390]){
    const code='FIXTURENEW'+width,barcode='0000999000'+width;
    const created=await requestAPI('events',{name:'新增商品測試場',date:'2026-10-15',pricing:'website'});assert.equal(created.status,200);const fair=await created.json();
    const admin=await open('admin',width,fair);
    const scan=admin.frame.getByRole('button',{name:'相機掃描商品'});assert.equal(await scan.innerText(),'');assert.equal(await scan.locator('svg').count(),1);
    await catalogTab(admin.page);
    await admin.page.getByRole('tab',{name:'＋ 新增商品',exact:true}).click();
    await admin.page.getByLabel('商品代碼',{exact:true}).fill(catalog.products[0].code);
    await admin.page.getByLabel('商品名稱',{exact:true}).fill('新增測試商品'+width);
    await admin.page.getByLabel('條碼（選填）',{exact:true}).fill(barcode);
    await admin.page.getByLabel('商品類別',{exact:true}).selectOption(Object.keys(catalog.classes)[0]);
    await admin.page.getByLabel('品項',{exact:true}).selectOption(Object.keys(catalog.kinds)[0]);
    await admin.page.getByLabel('單位',{exact:true}).selectOption(Object.keys(catalog.units)[0]);
    await admin.page.getByLabel('原價（元）',{exact:true}).fill('24');
    await admin.page.getByLabel('售價方式',{exact:true}).selectOption('discount');
    await admin.page.getByLabel('售價比例（%）',{exact:true}).fill('79.5');
    await admin.page.getByRole('button',{name:'儲存商品',exact:true}).click();
    await admin.page.getByRole('alert').filter({hasText:'商品代碼已存在'}).waitFor();
    assert.equal(await admin.page.getByLabel('商品名稱',{exact:true}).inputValue(),'新增測試商品'+width);
    await admin.page.getByLabel('商品代碼',{exact:true}).fill(code);
    if(width===390){await admin.page.locator('.product-create').scrollIntoViewIfNeeded();await admin.page.screenshot({path:'work/product-create-mobile.png',fullPage:true});}
    await admin.page.getByRole('button',{name:'儲存商品',exact:true}).click();
    await admin.page.getByRole('status').filter({hasText:'商品 '+code+' 已新增'}).waitFor();
    const row=admin.page.locator('#price-row-products-'+code);await row.waitFor();assert.match(await row.innerText(),/19/);
    await admin.page.reload();
    // Opening the catalog after a full reload must read the persisted product.
    if(await admin.page.getByRole('tab',{name:'商品列表',exact:true}).count()===0)await catalogTab(admin.page);
    await admin.page.getByLabel('搜尋商品',{exact:true}).fill(code);
    await admin.page.locator('#price-row-products-'+code).waitFor();
    const churchFairResponse=await requestAPI('events',{name:'教會新增商品測試',date:'2026-10-15',pricing:'website'},'aa01');assert.equal(churchFairResponse.status,200);
    const church=await open('aa01',width,await churchFairResponse.json());
    await church.frame.locator('#product-code').fill(barcode);await church.frame.locator('#product-code').press('Enter');
    await church.frame.locator('#cart-table').getByText('新增測試商品'+width,{exact:true}).waitFor();
    assert.equal(await church.frame.locator('#total-amount').innerText(),'19');
    assert.equal(await church.frame.getByRole('button',{name:'相機掃描商品'}).innerText(),'');
    await catalogTab(church.page);assert.equal(await church.page.getByRole('tab',{name:'＋ 新增商品',exact:true}).count(),0);
    assert.deepEqual(errors,[]);console.log('PASS: '+width+'px new product form, duplicate protection, persisted reload, church barcode checkout with 79.5% rounded unit price, icon-only camera.');
    await church.context.close();await admin.context.close();
  }
}catch(error){if(debugPage&&!debugPage.isClosed()){console.error((await debugPage.locator('body').innerText()).slice(-3500));console.error(errors);await debugPage.screenshot({path:'work/product-browser-failure.png'});}throw error;}
finally{await browser?.close();if(process.platform==='win32'){try{execFileSync('taskkill',['/PID',String(worker.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}else worker.kill();sqlite.close();}
