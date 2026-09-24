import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOutputApi} from '../ui/midi-output.js';
import {createMidiHelpers} from '../ui/runtime.js';
test('output handles share a connection and route channel/owner independently',async()=>{
 const requests=[],notes=[],errors=[];
 const play=createMidiHelpers({send:()=>{},sleep:async()=>{},log:()=>{}}).play;
 const api=createOutputApi({request:async(type,payload)=>{requests.push({type,payload});return payload.name==='tetorica-ym2612'?1:2;},play,send:async p=>notes.push(p),onError:e=>errors.push(e)});
 await api.enableSoundChip('ym2612');
 const a=api.midi.output('tetorica-ym2612',{channel:0});
 const b=api.midi.output('tetorica-ym2612',{channel:1});
 const c=api.midi.output('tetorica-sega-psg',{channel:9});
 await Promise.all([api.scoped(()=>{},11)(a,'C4'),api.scoped(()=>{},12)(b,'C4'),c.play('C4')]);
 assert.deepEqual(notes.map(n=>[n.route,n.channel,n.owner]),[[1,0,11],[1,1,12],[2,9,undefined]]);
 assert.equal(requests.filter(r=>r.type==='output').length,2);
 assert.equal(errors.length,0);
 assert.throws(()=>api.midi.output('x',{channel:17}));
 await assert.rejects(api.enableSoundChip('bad'),/Unknown/);
 await assert.rejects(a.play('C4',{channel:1}),/channel/);
});
test('stop while output opens prevents late Note On; send failures are reported without awaiting play',async()=>{
 let finish,active=true;const cancelled=Symbol(),notes=[],errors=[];
 const api=createOutputApi({request:()=>new Promise(r=>finish=r),play:createMidiHelpers({sleep:async()=>{},log:()=>{}}).play,send:async p=>notes.push(p),onError:e=>errors.push(e)});
 const handle=api.midi.output('x');
 const pending=api.scoped(()=>{if(!active)throw cancelled;},1)(handle,'C4');
 active=false;finish(4);await assert.rejects(pending,e=>e===cancelled);
 assert.equal(notes.length,0);assert.equal(errors.length,0);
 const bad=createOutputApi({request:async()=>{throw Error('missing port');},play:createMidiHelpers({sleep:async()=>{},log:()=>{}}).play,send:async()=>{},onError:e=>errors.push(e)});
 bad.midi.output('missing').play('C4');
 await new Promise(r=>setTimeout(r,0));assert.match(errors[0].message,/missing port/);
});

test('handle primitives send to their own output/channel and share the opened connection',async()=>{
 const requests=[];
 const api=createOutputApi({request:async(type,payload)=>{requests.push({type,payload});return type==='output'?71:undefined;},play:()=>{},send:()=>{},onError:()=>{}});
 const out=api.midi.output('External MIDI',{channel:4});
 await out.noteOn('C4');await out.pitchBend(1);await out.cc(64,127);await out.noteOff('C4');
 assert.equal(requests.filter(r=>r.type==='output').length,1);
 const messages=requests.filter(r=>r.type==='midi').map(r=>r.payload);
 assert(messages.every(p=>p.route===71&&p.tracked===true));
 assert.deepEqual(messages.map(p=>p.bytes),[[0x94,60,100],[0xe4,127,127],[0xb4,64,127],[0x84,60,0]]);
});

test('handle primitives do not send after cancellation during connection opening',async()=>{
 let finish,active=true;const cancelled=Symbol('cancelled'),sent=[];
 const api=createOutputApi({check:()=>{if(!active)throw cancelled;},request:(type,payload)=>type==='output'?new Promise(resolve=>finish=resolve):sent.push(payload),play:()=>{},send:()=>{},onError:()=>{}});
 const task=api.midi.output('External MIDI').noteOn(60);
 active=false;finish(9);await assert.rejects(task,error=>error===cancelled);assert.deepEqual(sent,[]);
});

test('enableSoundChip accepts allocation options through both public entry points',async()=>{
 const requests=[];
 const api=createOutputApi({request:async(type,payload)=>requests.push({type,payload}),onError:()=>{}});
 await api.midi.enableSoundChip('tetorica-ym2612',{roundRobin:false});
 await api.enableSoundChip('ym2612',{roundRobin:true});
 assert.deepEqual(requests,[{type:'enable-chip',payload:{chip:'ym2612',roundRobin:false}},{type:'enable-chip',payload:{chip:'ym2612',roundRobin:true}}]);
 await assert.rejects(api.midi.enableSoundChip('ym2612',{roundRobin:0}),/boolean/);
 await assert.rejects(api.midi.enableSoundChip('sega-psg',{roundRobin:false}),/YM2612/);
 assert.equal(requests.length,2);
});
