import test from 'node:test';
import assert from 'node:assert/strict';
import { requestTimeout, requestFailure } from '../lib/request-timeout.mjs';
import { OfflineEngine } from '../lib/offline-engine.mjs';

test('PILOT gets its own timeout without slowing checkout or catalog failure fallback',()=>{
  assert.equal(requestTimeout('events/fair/pilot-preview',{}),60000);
  assert.equal(requestTimeout('events/fair/pilot-confirm',{}),60000);
  assert.equal(requestTimeout('events/fair/pilot-download',{}),60000);
  assert.equal(requestTimeout('events/fair/sync',{}),12000);
  assert.equal(requestTimeout('catalog'),2500);
  assert.equal(requestTimeout('session-renew',{}),2500);
});

test('Export timeout is visible and does not incorrectly switch the cashier to offline mode',async()=>{
  const failure=requestFailure(new DOMException('expired','TimeoutError'),'events/fair/pilot-preview');
  const engine=new OfflineEngine({store:{get:async()=>null},lock:async(_,fn)=>fn(),network:async()=>{throw failure;}});
  await assert.rejects(engine.request('admin','events/fair/pilot-preview',{}),/匯出處理逾時/);
  assert.equal(engine.disconnected,false);
  const offline=TypeError('Failed to fetch');
  assert.equal(requestFailure(offline,'events/fair/pilot-preview'),offline);
});
