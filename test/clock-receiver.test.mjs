import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClockReceiver} from '../ui/clock-receiver.js';
test('Clock receiver rejects previous runs, duplicate and malformed events',()=>{
 const receiver=createClockReceiver(4);
 const event={runId:4,sequence:1,byte:0xfa,timestampMs:100};
 assert.equal(receiver.receive({...event,runId:3}),null);
 assert.equal(receiver.receive(event).running,true);
 assert.equal(receiver.receive(event),null);
 assert.equal(receiver.receive({...event,sequence:2,timestampMs:99}),null);
 assert.equal(receiver.receive({...event,sequence:2,byte:0x90}),null);
 assert.equal(receiver.receive({...event,sequence:2,byte:0xf8,timestampMs:120}).pulses,1);
 assert.equal(receiver.receive({...event,sequence:1,byte:0xfa,timestampMs:121}),null);
 assert.equal(receiver.state.pulses,1);
});
test('Clock receiver preserves every pulse, stop and continue across UI poll intervals',()=>{
 const receiver=createClockReceiver(9);let sequence=0;
 const send=(byte,time)=>receiver.receive({runId:9,sequence:++sequence,byte,timestampMs:time});
 send(0xfa,0);
 for(let i=1;i<=24;i++)send(0xf8,i*10);
 assert.equal(receiver.state.beat,1);
 send(0xfc,241);send(0xf8,242);assert.equal(receiver.state.pulses,24);
 send(0xfb,243);send(0xf8,250);assert.equal(receiver.state.pulses,25);
 const copy=receiver.state;copy.pulses=0;assert.equal(receiver.state.pulses,25);
 assert.equal(createClockReceiver().receive({runId:undefined,sequence:1,byte:0xfa,timestampMs:0}),null);
});
