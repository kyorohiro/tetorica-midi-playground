import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindLoopContext} from '../ui/loop-context.js';
test('inline callbacks retain closures and bind helpers across await',async()=>{
 const code=bindLoopContext('const value=7; liveLoop("a",async (/*hello*/) => {await beat(1);return [cycle([value]),value];});');
 let fn;new Function('liveLoop',code)((name,callback)=>fn=callback);
 assert.deepEqual(await fn({beat:async()=>{},cycle:a=>a[0]}),[7,7]);
});
test('explicit callback helpers, strings and locally declared helpers are preserved',()=>{
 const code='liveLoop("a",async ({play})=>{await play(60);});';assert.equal(bindLoopContext(code),code);
 const local=bindLoopContext('liveLoop("a",async()=>{const play=1;return play;});');
 let fn;new Function('liveLoop',local)((name,callback)=>fn=callback);assert.ok(!local.includes('{play,'));
 assert.equal(bindLoopContext('const s="liveLoop(a,async()=>{})";'),'const s="liveLoop(a,async()=>{})";');
});
test('expression callbacks bind tween and livePrepare to their own lifetime',async()=>{
 for(const helper of ['tween','livePrepare']){
  const code=bindLoopContext(`liveLoop('a',async()=>${helper}('argument',()=>{}));`);
  let fn;new Function('liveLoop',code)((name,callback)=>fn=callback);
  let called=false;
  await fn({[helper]:async value=>{called=true;assert.equal(value,'argument');}});
  assert.ok(called,helper);
 }
});
