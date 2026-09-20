import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAudition} from '../ui/audition.js';
test('keyboard releases queue after pending On and repeats do not retrigger',async()=>{
 const calls=[];let ready;const gate=new Promise(r=>ready=r);
 const a=createAudition(async(cmd,args)=>{calls.push([cmd,args]);if(cmd==='keyboard_on')await gate;});
 a.press('a',60,1,90);a.press('a',60,1,90);a.release('a');await Promise.resolve();assert.equal(calls.length,1);
 ready();await a.releaseAll();assert.deepEqual(calls.map(c=>c[0]),['keyboard_on','keyboard_off']);assert.equal(calls[0][1].id,calls[1][1].id);
});
test('release all preserves captured channel and releases all held notes after send failures',async()=>{
 const calls=[],errors=[];const a=createAudition(async(cmd,args)=>{calls.push([cmd,args]);if(cmd==='keyboard_on'&&args.note===60)throw Error('no output');},e=>errors.push(e));
 a.press('a',60,2,90);a.press('b',64,3,80);await a.releaseAll();assert.equal(errors.length,1);assert.equal(calls.length,4);assert.equal(calls[1][1].channel,3);
});
