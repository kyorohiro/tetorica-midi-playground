import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLivePrepare} from '../ui/live-prepare.js';

test('livePrepare deduplicates pending work and retains successful values including undefined',async()=>{
 const api={context:{},midi:{}};const prepare=createLivePrepare(api);
 let calls=0,finish;
 const first=prepare('lead',async received=>{assert.equal(received,api);calls++;return new Promise(resolve=>finish=resolve);});
 const second=prepare('lead',()=>assert.fail('duplicate factory'));
 assert.equal(first,second);await Promise.resolve();assert.equal(calls,1);
 const output={play(){}};finish(output);assert.equal(await first,output);
 assert.equal(await prepare('lead',()=>assert.fail('cached factory')),output);
 assert.equal(await prepare('empty',()=>{calls++;}),undefined);
 assert.equal(await prepare('empty',()=>assert.fail('undefined must be cached')),undefined);
 assert.equal(calls,2);
});

test('livePrepare retries caught failures and separates names and Run caches',async()=>{
 const prepare=createLivePrepare({});let calls=0;
 for(const factory of [()=>{throw Error('sync');},async()=>{throw Error('async');}]){
  await assert.rejects(prepare('retry',factory));
 }
 assert.equal(await prepare('retry',()=>++calls),1);
 assert.equal(await prepare('other',()=>++calls),2);
 assert.equal(await createLivePrepare({})('retry',()=>++calls),3);
 for(const [name,factory] of [['',()=>{}],['  ',()=>{}],[1,()=>{}],['name',null]])await assert.rejects(prepare(name,factory),TypeError);
});
