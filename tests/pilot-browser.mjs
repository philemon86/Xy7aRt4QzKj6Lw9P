// Isolated local worker + fixture database. No production accounts or orders.
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.POS_PLAYWRIGHT_MODULE || pathToFileURL(path.resolve(path.dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE events(id TEXT PRIMARY KEY,state TEXT); CREATE TABLE audit(id TEXT PRIMARY KEY,state TEXT);');
for (const file of ['drizzle/0002_puzzling_sauron.sql','drizzle/0003_cute_the_professor.sql']) sqlite.exec(fs.readFileSync(file,'utf8'));
const db = {
  prepare(sql) {
    let values=[];
    const q={bind(...v){values=v;return q;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){return sqlite.prepare(sql).run(...values);}};
    return q;
  },
  async batch(qs) {sqlite.exec('BEGIN');try{const results=[];for(const q of qs)results.push(await q.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
};
globalThis.__pilotBrowserEnv={DB:db};
const hooks=registerHooks({resolve(s,c,next){return s==='cloudflare:workers'?{url:'data:text/javascript,export const env=globalThis.__pilotBrowserEnv;',shortCircuit:true}:next(s,c);}});
const { previewPilot, confirmPilot, listPilotExports, downloadPilot } = await import('../lib/pilot-service.ts');
hooks.deregister();
const catalog={products:[{code:'T',name:'匯出測試商品',price:100,legacyPrice:100,defaultDiscount:100,ntaxFlag:'0',unitCode:'1'}],customers:[{code:'0002',name:'書展'},{code:'305',name:'個人'}],units:{1:'本'},classes:{},kinds:{},pricingRules:{groups:[]}};
const order={id:'fixture-order',transactionId:'fixture-order',createdAt:'2026-10-11T01:00:00Z',isValid:true,amount:100,invoiceInfo:{},paymentMethod:'LINE PAY',paymentRecords:[{method:'LINE PAY',amount:100}],items:[{code:'T',name:'匯出測試商品',price:100,discount:100,quantity:1}]};
const event={id:'fixture-fair',tenant:'',organizer:'bookstore',name:'匯出測試書展',date:'2026-10-11',status:'open',state:{'order:fixture-order':order},revision:0,numbers:{'fixture-order':'PF202610110001'}};
sqlite.exec('BEGIN');
const insert=sqlite.prepare('INSERT INTO audit(id,state) VALUES(?,?)');
for(let n=0;n<1600;n++) insert.run(String(n),JSON.stringify({...event.state,'draft:device:bulk':'草稿'.repeat(2000)}));
sqlite.exec('COMMIT');
const port=31850,origin='http://127.0.0.1:'+port;
const worker=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','dist/server/wrangler.json','--port',String(port),'--persist-to','work/v50-browser-db'],{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}});
let logs='';worker.stdout.on('data',x=>logs=(logs+x).slice(-4000));worker.stderr.on('data',x=>logs=(logs+x).slice(-4000));
let browser;
try {
  let ready=false;
  for(let n=0;n<40;n++){try{ready=(await fetch(origin+'/pos/')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,1000));}
  assert.ok(ready,'Local worker failed: '+logs);
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],downloads=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('download',d=>downloads.push(d));
  let delay=true, failNext=false;
  await context.route('**/pos/api/**',async route=>{
    const req=route.request(),endpoint=new URL(req.url()).pathname.slice('/pos/api/'.length),body=req.postDataJSON();
    try {
      let result={ok:true};
      if(endpoint==='bootstrap')result={me:{role:'admin',tenant:''},catalog,events:[{...event,state:undefined}]};
      else if(endpoint==='catalog')result=catalog;
      else if(endpoint==='catalog/version')result={version:'fixture'};
      else if(endpoint==='me')result={role:'admin',tenant:''};
      else if(endpoint==='churches')result=[];
      else if(endpoint.endsWith('/pilot-exports'))result=await listPilotExports(event);
      else if(endpoint.endsWith('/pilot-download'))result=await downloadPilot(event,body.id);
      else if(endpoint==='events/fixture-fair')result=event;
      else if(endpoint==='events/fixture-fair/sync') {
        for(const p of body.changes||[]) {if(p.after===null)delete event.state[p.key];else event.state[p.key]=p.after;}
        event.revision++;result=event;
      } else if(endpoint.endsWith('/pilot-preview')) {
        if(failNext){failNext=false;throw Error('測試匯出錯誤：請重新預覽');}
        if(delay){await new Promise(r=>setTimeout(r,15000));delay=false;}
        result=await previewPilot({...event,state:JSON.stringify(event.state)},catalog,body,event.numbers);
      } else if(endpoint.endsWith('/pilot-confirm'))result=await confirmPilot({...event,state:JSON.stringify(event.state)},body.id);
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    } catch(error){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:error.message})});}
  });
  // Sites mounts public assets under /pos; local Wrangler needs the same mapping.
  await context.route('**/pos/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    const relative=pathname.startsWith('/pos/_next/')?pathname.slice(1):pathname.replace(/^\/pos\//,'');
    const file=path.resolve('dist/client',relative);
    if(!file.startsWith(path.resolve('dist/client')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fallback();
    await route.fulfill({status:200,contentType:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(file)});
  });
  await page.goto(origin+'/pos/?event=fixture-fair&view=history');
  const frame=page.frameLocator('iframe[data-event-id="fixture-fair"]');
  try { await frame.locator('#export-pilot-btn').waitFor(); }
  catch (error) {
    console.error('Fixture errors:',errors);
    console.error('Fixture workspace:',await page.locator('body').innerText());
    console.error('Fixture frames:',page.frames().map(f=>f.url()));
    throw error;
  }
  // Entry must not wait silently on cloud.flush before showing parameter inputs.
  await frame.locator('body').evaluate(()=>{const flush=POSCloud.flush;window.originalFlush=flush;POSCloud.flush=()=>new Promise(r=>setTimeout(r,1500)).then(()=>flush());});
  await frame.locator('#export-pilot-btn').click();
  assert.equal(await frame.locator('#export-pilot-btn').innerText(),'匯出pilot');
  await page.locator('#pilot-code').waitFor({timeout:1000});
  await page.locator('#pilot-code').isEnabled();
  await page.getByRole('status').filter({hasText:'正在讀取已保存匯出'}).waitFor({state:'hidden'});
  await page.locator('#pilot-code').fill('999000001');
  await page.locator('#pilot-invoice').fill('ZZ00100001');
  const savedDate=await page.locator('#pilot-date').inputValue();
  await page.getByRole('button',{name:'產生匯出預覽',exact:true}).click();
  await page.getByRole('status').filter({hasText:'正在同步交易'}).waitFor();
  await page.getByRole('button',{name:'確認正式匯出，下載三個 CSV'}).waitFor({timeout:30000});
  assert.equal(await page.locator('.pilot-preview').first().locator('tbody tr').count(),2);
  assert.equal(await page.getByRole('alert').count(),0);
  await page.getByRole('button',{name:'確認正式匯出，下載三個 CSV'}).click();
  await page.getByText('正式匯出已完成',{exact:true}).waitFor();
  await page.waitForTimeout(300);
  assert.deepEqual(downloads.map(d=>d.suggestedFilename()).sort(),['STKSALE1.csv','STKSALE2.csv','VCHRPLUS_SALE1.csv']);
  for(const download of downloads){const bytes=fs.readFileSync(await download.path());assert.ok(bytes.length>20);assert.equal(bytes[0],34);}
  const originalFiles=await Promise.all(downloads.map(async d=>[d.suggestedFilename(),fs.readFileSync(await d.path())]));
  // Reloading simulates a fresh workspace session; re-download must use the saved
  // export even when current transactions differ and a device sync is blocked.
  event.state['order:fixture-order'].note='匯出後修改';
  await page.reload();
  await frame.locator('#export-pilot-btn').click();
  await page.getByRole('button',{name:'下載三個已保存 CSV',exact:true}).waitFor();
  assert.equal(await page.locator('#pilot-code').inputValue(),'999000001');
  assert.equal(await page.locator('#pilot-invoice').inputValue(),'ZZ00100001');
  assert.equal(await page.locator('#pilot-code').isDisabled(),true);
  assert.equal(await page.locator('#pilot-date').inputValue(),savedDate);
  const eriCount=sqlite.prepare('SELECT count(*) n FROM pilot_eris').get().n;
  await frame.locator('body').evaluate(()=>{POSCloud.flush=async()=>{throw Error('測試：待同步，不應阻擋下載已保存檔案');};});
  await page.evaluate(()=>{window.savedSyncGate=POSOffline.requireSynced;POSOffline.requireSynced=async()=>{throw Error('待同步不應阻擋已保存檔案');};});
  await page.getByRole('button',{name:'下載三個已保存 CSV',exact:true}).click();
  await page.waitForTimeout(300);
  assert.equal(downloads.length,6);
  for(const d of downloads.slice(3)){const original=originalFiles.find(([name])=>name===d.suggestedFilename());assert.deepEqual(fs.readFileSync(await d.path()),original[1]);}
  assert.equal(sqlite.prepare('SELECT count(*) n FROM pilot_eris').get().n,eriCount);
  await frame.locator('body').evaluate(()=>{POSCloud.flush=async()=>{};});
  await page.evaluate(()=>{POSOffline.requireSynced=window.savedSyncGate;});
  await page.getByRole('button',{name:'建立新的匯出',exact:true}).click();
  await page.locator('#pilot-code').fill('999000100');
  await page.locator('#pilot-invoice').fill('ZZ00200001');
  failNext=true;
  await page.getByRole('button',{name:'產生匯出預覽',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'測試匯出錯誤'}).waitFor();
  await page.getByRole('button',{name:'產生匯出預覽',exact:true}).click();
  await page.getByRole('button',{name:'確認正式匯出，下載三個 CSV'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: export opens, 15-second preview survives, CSV bytes/settings persist across reload and source edits, saved downloads bypass sync and reuse ERIs, new export/retry works.');
} finally {await browser?.close();worker.kill();sqlite.close();}
