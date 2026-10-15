// Actual workspace, iframe and decoders; isolated API fixtures and synthetic
// camera stream. Never calls production or accesses a user's real camera.
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { code39Bits, productEANBits } from './fixtures/carrier-code39.mjs';
const {chromium}=await import(process.env.POS_PLAYWRIGHT_MODULE || pathToFileURL(path.resolve(path.dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const catalog={products:[{code:'C001',barcode:'4006381333931',name:'相機載具測試商品',price:100,legacyPrice:100,defaultDiscount:100,ntaxFlag:'1',unitCode:'1'}],customers:[{code:'0002',name:'書展'},{code:'305',name:'個人'},{code:'AA01',name:'台北教會'}],units:{1:'本'},classes:{},kinds:{},pricingRules:{groups:[]}};
const portProbe=net.createServer();
await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));
const port=portProbe.address().port,origin='http://127.0.0.1:'+port;
await new Promise(resolve=>portProbe.close(resolve));
const worker=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','dist/server/wrangler.json','--port',String(port),'--persist-to','work/carrier-browser-db'],{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}});
let logs='',browser,debugPage,debugErrors=[];
worker.stdout.on('data',x=>logs=(logs+x).slice(-4000));worker.stderr.on('data',x=>logs=(logs+x).slice(-4000));
try {
  let ready=false;
  for(let n=0;n<40;n++){try{ready=(await fetch(origin+'/pos/')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,1000));}
  assert.ok(ready,'Local worker failed: '+logs);
  browser=await chromium.launch({channel:'msedge',headless:true});
  for (const portal of ['admin','aa01']) for(const width of [1440,390]) {
    const event={id:'carrier-fixture',tenant:portal==='admin'?'':'aa01',organizer:portal==='admin'?'bookstore':'church',name:'載具測試書展',date:'2026-10-15',status:'open',state:{},revision:0,numbers:{}};
    const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390,serviceWorkers:'block'});
    await context.addInitScript(({bits})=>{
      // Force the actual shipped WASM / JS fallback path, even on Chrome.
      Object.defineProperty(window,'BarcodeDetector',{value:undefined,configurable:true});
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
      const ctx=canvas.getContext('2d');
      const fixture=window.__carrierFixture={denied:false,streams:[],show(name){
        fixture.active=name;
        ctx.fillStyle='white';ctx.fillRect(0,0,1280,720);
        const code=bits[name];if(!code)return;
        const size=4,start=Math.round((1280-code.length*size)/2);
        ctx.fillStyle='black';for(let i=0;i<code.length;i++)if(code[i]==='1')ctx.fillRect(start+i*size,260,size,200);
      }};
      fixture.show('blank');
      fixture.workerMessages=[];
      const RealWorker=window.Worker;
      window.Worker=class extends RealWorker {
        constructor(...args){super(...args);this.addEventListener('message',e=>{fixture.workerMessages.push(e.data);if(fixture.workerMessages.length>20)fixture.workerMessages.shift();});}
      };
      // A real camera produces new frames even when the subject is stationary.
      setInterval(()=>fixture.show(fixture.active),100);
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
        if(fixture.denied)throw new DOMException('Denied fixture','NotAllowedError');
        const stream=canvas.captureStream(15);fixture.streams.push(stream);return stream;
      }});
    },{bits:{carrier:code39Bits('/AB+12-.'),other:code39Bits('C001'),product:productEANBits()}});
    await context.route('**/pos/api/**',async route=>{
      const req=route.request(),endpoint=new URL(req.url()).pathname.slice('/pos/api/'.length),body=req.postDataJSON();
      let result={ok:true};
      if(endpoint==='bootstrap')result={me:{role:portal==='admin'?'admin':'church',tenant:event.tenant},catalog,events:[{...event,state:undefined}]};
      else if(endpoint==='catalog')result=catalog;
      else if(endpoint==='catalog/version')result={version:'fixture'};
      else if(endpoint==='me')result={role:portal==='admin'?'admin':'church',tenant:event.tenant};
      else if(endpoint==='churches')result=[];
      else if(endpoint.startsWith('church-stock/'))result={quantities:{},sold:{},remaining:{}};
      else if(endpoint==='events/carrier-fixture')result=event;
      else if(endpoint==='events/carrier-fixture/sync'){
        for(const p of body.changes||[]){if(p.after===null)delete event.state[p.key];else event.state[p.key]=p.after;}
        event.revision++;result=event;
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    await context.route('**/pos/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      const relative=pathname.startsWith('/pos/_next/')?pathname.slice(1):pathname.replace(/^\/pos\//,'');
      const file=path.resolve('dist/client',relative);
      if(!file.startsWith(path.resolve('dist/client')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fallback();
      const contentType=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.wasm')?'application/wasm':'application/octet-stream';
      await route.fulfill({status:200,contentType,body:fs.readFileSync(file)});
    });
    const page=await context.newPage(),errors=[];debugPage=page;debugErrors=errors;page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/pos/'+(portal==='admin'?'':portal)+'?event=carrier-fixture&view=checkout');
    const frame=page.frameLocator('iframe[data-event-id="carrier-fixture"]');
    await frame.locator('#scan-carrier-btn').waitFor();
    assert.equal(await frame.locator('body').getAttribute('data-audience'),portal==='admin'?'bookstore':'church');
    await frame.locator('#product-code').fill('C001');await frame.locator('#product-code').press('Enter');
    await frame.locator('.quantity-value').filter({hasText:'1'}).waitFor();
    await frame.locator('#invoice-tax-id').fill('23101590');
    const bounds=await frame.locator('#scan-carrier-btn').boundingBox();assert.ok(bounds.width>=44&&bounds.height>=44);
    if(width===390){
      await frame.locator('#scan-carrier-btn').scrollIntoViewIfNeeded();
      await page.screenshot({path:'work/carrier-'+portal+'-mobile.png'});
    }
    if(portal==='admin'&&width===1440){
      await page.evaluate(()=>{__carrierFixture.denied=true;});
      await frame.getByRole('button',{name:'相機掃描載具'}).click();
      await page.getByRole('status').filter({hasText:'相機權限尚未允許'}).waitFor();
      await page.evaluate(()=>{__carrierFixture.denied=false;});
      await page.getByRole('button',{name:'重試啟動相機'}).click();
    } else await frame.getByRole('button',{name:'相機掃描載具'}).click();
    await page.getByRole('dialog').filter({hasText:'掃描載具'}).waitFor();
    await page.getByRole('status').filter({hasText:'辨識成功後自動填入'}).waitFor();
    // A product in view must not alter the invoice or shopping cart.
    await page.evaluate(()=>__carrierFixture.show('other'));
    await page.getByRole('status').filter({hasText:'請掃描以 / 開頭'}).waitFor({timeout:20000});
    assert.equal(await frame.locator('#invoice-donate-carrier').inputValue(),'');
    assert.equal(await frame.locator('#invoice-tax-id').inputValue(),'23101590');
    assert.equal(await frame.locator('.quantity-value').innerText(),'1');
    await page.evaluate(()=>__carrierFixture.show('carrier'));
    await page.getByRole('dialog').waitFor({state:'hidden',timeout:20000});
    assert.equal(await frame.locator('#invoice-donate-carrier').inputValue(),'/AB+12-.');
    assert.equal(await frame.locator('#invoice-tax-id').inputValue(),'');
    assert.equal(await frame.locator('#invoice-customer-status').innerText(),'個人客戶 · 載具');
    assert.equal(await frame.locator('.quantity-value').innerText(),'1');
    await page.waitForFunction(()=>__carrierFixture.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
    await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.activeElement?.id==='product-code');
    // Cancel leaves the existing carrier and cart intact.
    await page.evaluate(()=>__carrierFixture.show('blank'));
    await frame.getByRole('button',{name:'相機掃描載具'}).click();
    await page.getByRole('status').filter({hasText:'辨識成功後自動填入'}).waitFor();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await frame.locator('#invoice-donate-carrier').inputValue(),'/AB+12-.');
    // The existing product scanner must still scan continuously into the cart.
    await frame.locator('#scan-form .scan-camera-btn').click();
    await page.getByRole('dialog').filter({hasText:'連續掃描'}).waitFor();
    await page.getByRole('status').filter({hasText:'辨識後移開再掃下一件'}).waitFor();
    await page.evaluate(()=>__carrierFixture.show('product'));
    await frame.locator('.quantity-value').filter({hasText:'2'}).waitFor({timeout:20000});
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.waitForFunction(()=>__carrierFixture.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
    await page.reload();
    await frame.locator('#scan-carrier-btn').waitFor();
    assert.equal(await frame.locator('#invoice-donate-carrier').inputValue(),'/AB+12-.');
    assert.equal(await frame.locator('.quantity-value').innerText(),'2');
    assert.deepEqual(errors,[]);
    console.log('PASS: '+portal+' '+width+'px; real synthetic-camera decoding, invoice routing, persistence, cancel and product scanner.');
    await context.close();
  }
} catch(error) {
  if(debugPage&&!debugPage.isClosed()){
    console.error('Camera fixture status:',await debugPage.locator('.camera-status').allTextContents());
    console.error('Camera fixture errors:',debugErrors);
    console.error('Decoder workers:',await debugPage.evaluate(()=>__carrierFixture.workerMessages));
    console.error('Direct decode:',await debugPage.evaluate(()=>{
      try {const v=document.querySelector('video'),c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return new POSBarcodeDecoder.BrowserMultiFormatReader().decodeFromCanvas(c).getText();}catch(e){return String(e);}
    }));
    console.error('Video readiness:',await debugPage.locator('video').evaluateAll(videos=>videos.map(v=>({ready:v.readyState,width:v.videoWidth,height:v.videoHeight,paused:v.paused}))));
    await debugPage.screenshot({path:'work/carrier-browser-failure.png'});
  }
  throw error;
} finally {
  await browser?.close();
  if(process.platform==='win32') {
    try {execFileSync('taskkill',['/PID',String(worker.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});} catch {}
  } else worker.kill();
}
