// Real API handler + isolated in-memory D1 adapter. No production credentials/data writes.
import {DatabaseSync} from 'node:sqlite';
import {registerHooks} from 'node:module';
import fs from 'node:fs';
import {build} from 'esbuild';
export const sqlite=new DatabaseSync(':memory:');
for(const file of ['0000_cooing_makkari.sql','0001_modern_white_tiger.sql','0002_puzzling_sauron.sql','0003_cute_the_professor.sql'])sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8'));
const db={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){const query=sqlite.prepare(sql);if(query.columns().length)return {results:query.all(...args),meta:{changes:0}};const result=query.run(...args);return {meta:{changes:Number(result.changes)}};}};},async batch(queries){sqlite.exec('BEGIN');try{const results=[];for(const query of queries)results.push(await query.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
globalThis.__productServerEnv={DB:db};
const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env = globalThis.__productServerEnv;',shortCircuit:true};return next(specifier,context);}});
const bundled=await build({entryPoints:['lib/server.ts'],bundle:true,platform:'node',format:'esm',write:false,external:['cloudflare:workers']});
const {handle}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
hooks.deregister();
const sha=async text=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
for(const portal of ['admin','aa01'])sqlite.prepare('INSERT INTO sessions(token,role,tenant,expires) VALUES(?,?,?,?)').run(await sha('fixture-'+portal),portal==='admin'?'admin':'church',portal==='admin'?'':'aa01',Date.now()+86400000);
export async function requestAPI(path,body,portal='admin') {
  const headers={Cookie:'pos_session_'+portal+'=fixture-'+portal,'X-POS-Portal':portal,Origin:'http://fixture.test',...(body===undefined?{}:{'Content-Type':'application/json'})};
  try {
    return await handle(new Request('http://fixture.test/pos/api/'+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),path.split('/'));
  } catch(error){return Response.json({error:error.message},{status:error.status||400});}
}
