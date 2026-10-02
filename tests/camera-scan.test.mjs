import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanFrame, decodeScanFrame } from '../lib/camera-scan.mjs';

test('Native misses and failures still use the fallback; a native success avoids duplicate decoding', async () => {
  let calls = 0;
  const reader = { decodeFromCanvas: () => { calls++; return {getText:()=> '9786263293786'}; } };
  for (const native of [null,{detect:async()=>[]},{detect:async()=>{throw Error('unsupported frame');}}])
    assert.equal(await decodeScanFrame({},native,reader),'9786263293786');
  assert.equal(calls,3);
  assert.equal(await decodeScanFrame({},{detect:async()=>[{rawValue:'4006381333931'}]},reader),'4006381333931');
  assert.equal(calls,3);
  assert.equal(await decodeScanFrame({},null,{decodeFromCanvas:()=>{throw Error('not found');}}),null);
});

test('Bounded frames cover full landscape and portrait images, with overlapping top/middle/bottom detail and rotation', () => {
  for(const [width,height] of [[1920,1080],[1080,1920]]) {
    const frames=Array.from({length:6},(_,i)=>scanFrame(width,height,i));
    assert.equal(frames[4].sourceHeight,height);
    assert.equal(frames[4].tryHarder,true);
    assert.equal(frames[1].width,width);
    assert.equal(frames[3].rotate,true);
    assert.equal(frames[1].y,0);
    assert.equal(frames[2].y+frames[2].sourceHeight,height);
    assert.equal(frames[5].sourceHeight,height);
    assert.ok(frames[1].y+frames[1].sourceHeight>=frames[0].y);
    assert.ok(frames[0].y+frames[0].sourceHeight>=frames[2].y);
    for(const f of frames) {
      assert.ok(f.width<=1920&&f.height<=1920);
      assert.ok(f.sourceHeight<=height&&f.sourceWidth===width);
    }
  }
});
