import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClockWait} from '../ui/clock-wait.js';
import {createClockReceiver} from '../ui/clock-receiver.js';
test('external waits follow pulses and halt on Stop, reset and timeout',async()=>{
 for(const end of ['stop','reset','timeout']){
  let time=0,sequence=0,stops=[];
  const wait=createClockWait(createClockReceiver(1),{now:()=>time,sleep:async()=>{time+=10;send(0xf8);},onStop:s=>stops.push(s)});
  function send(byte){wait.receive({runId:1,sequence:++sequence,byte,timestampMs:time});}
  send(0xfa);await wait.ready();await wait.beat(0.5);assert.equal(sequence,13);
  await wait.nextBeat();assert.equal(sequence,25);
  if(end==='timeout')time+=1000;else send(end==='stop'?0xfc:0xfa);
  assert.throws(()=>wait.check());await assert.rejects(wait.beat());assert.equal(stops.length,1);
 }
});
test('external loop waits check cancellation and reject invalid beat counts',async()=>{
 let sequence=0;
 const wait=createClockWait(createClockReceiver(1),{sleep:async()=>{},onStop:()=>{}});
 wait.receive({runId:1,sequence:++sequence,byte:0xfb,timestampMs:0});
 await assert.rejects(wait.beat(1,()=>{throw new Error('cancelled');}),/cancelled/);
 for(const count of [0,-1,Infinity,'1'])await assert.rejects(wait.beat(count));
});
