import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTween} from '../ui/tween.js';
import {createMidiHelpers} from '../ui/runtime.js';
import {createClockReceiver} from '../ui/clock-receiver.js';
import {createClockWait} from '../ui/clock-wait.js';

test('seconds tween emits monotonic endpoints, accepts numeric seconds and awaits callbacks serially',async()=>{
 for(const duration of [{seconds:0.05},0.05]){
  let time=0,active=0;const values=[],waits=[];
  const tween=createTween({seconds:()=>time/1000,beats:()=>0,sleep:async ms=>{waits.push(ms);time+=ms;}});
  await tween(duration,async value=>{
   assert.equal(active++,0);values.push(value);await Promise.resolve();active--;
  });
  assert.equal(values[0],0);assert.equal(values.at(-1),1);
  assert.equal(values.filter(n=>n===1).length,1);
  assert.ok(values.every((n,i)=>i===0||n>values[i-1]));
  assert.ok(waits.every(ms=>ms>=0&&ms<=1000/60));assert.ok(Math.abs(time-50)<0.0001);
 }
});

test('zero duration calls only one, and invalid durations never call the callback',async()=>{
 const tween=createTween({seconds:()=>0,beats:()=>0,sleep:async()=>assert.fail('zero must not wait')});
 const values=[];await tween({beats:0},async n=>values.push(n));assert.deepEqual(values,[1]);
 for(const duration of [null,[],{},'1',{seconds:1,beats:1},{seconds:1,other:2},{beats:-1},Infinity,NaN])await assert.rejects(tween(duration,()=>assert.fail('invalid callback')));
 await assert.rejects(tween(0,null),/callback/);
});

test('beat tweens follow BPM changes on the shared runtime clock',async()=>{
 let time=0,changed=false,api;const values=[];
 api=createMidiHelpers({now:()=>time,send:async()=>{},log:()=>{},sleep:async ms=>{
  time+=ms;if(!changed){changed=true;api.setBpm(60);}
 }});
 await api.tween({beats:1},n=>values.push(n));
 // 1/30 beat at 120 BPM, then the remaining 29/30 at 60 BPM.
 assert.ok(time>=983.3&&time<=1000.1,`${time}ms`);
 assert.equal(values[0],0);assert.equal(values.at(-1),1);
 assert.ok(!Object.keys(api).includes('createTween'));
});

test('cancellation before/after waits or async callbacks never forces the final value',async()=>{
 for(const when of ['initial','sleep','callback']){
  let time=0,cancelled=when==='initial';const values=[];
  const tween=createTween({seconds:()=>time/1000,beats:()=>0,
   sleep:async ms=>{time+=ms;if(when==='sleep')cancelled=true;},
   check:()=>{if(cancelled)throw Error('cancelled');},
  });
  await assert.rejects(tween({seconds:1},async n=>{values.push(n);await Promise.resolve();if(when==='callback')cancelled=true;}),/cancelled/);
  assert.deepEqual(values,when==='initial'?[]:[0]);
 }
 let time=0;const values=[];
 const tween=createTween({seconds:()=>time/1000,beats:()=>0,sleep:async ms=>time+=ms});
 await assert.rejects(tween({seconds:1},async n=>{values.push(n);if(n>0)throw Error('callback failed');}),/callback failed/);
 assert.ok(values.length>1);assert.ok(!values.includes(1));
});

test('external beat tween advances only with Clock pulses and halts on transport Stop',async()=>{
 for(const stop of [false,true]){
  let time=0,sequence=0;const receiver=createClockReceiver(1),values=[];
  const wait=createClockWait(receiver,{now:()=>time,sleep:async()=>{},onStop:()=>{}});
  const pulse=byte=>wait.receive({runId:1,sequence:++sequence,byte,timestampMs:time});
  pulse(0xfa);
  const tween=createTween({seconds:()=>time/1000,beats:()=>receiver.state.beat,check:wait.check,sleep:async ms=>{
   time+=ms;
   // Timer time alone cannot advance the beat tween.
   if(time<100)return;
   pulse(stop&&sequence===4?0xfc:0xf8);
  }});
  const task=tween({beats:0.25},n=>values.push(n));
  if(stop){await assert.rejects(task,/stopped/);assert.ok(!values.includes(1));}
  else {await task;assert.equal(values.at(-1),1);assert.equal(sequence,7);}
  assert.equal(values[0],0);assert.ok(time>=100);
 }
});
