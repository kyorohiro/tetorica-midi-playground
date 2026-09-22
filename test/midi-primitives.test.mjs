import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMidiPrimitives,validateMidiMessage} from '../ui/midi-primitives.js';

test('MIDI primitives encode channels, note names, pressure and bend endpoints',async()=>{
 const messages=[];const api=createMidiPrimitives({transmit:async payload=>messages.push(payload)});
 await api.noteOn('C4',{channel:16,velocity:100});await api.noteOff(60,{channel:16});
 await api.cc(1,64,{channel:2});await api.programChange(30);
 await api.channelPressure(80,{channel:3});await api.polyPressure('C#4',81,{channel:4});
 for(const bend of [-1,0,0.5,1])await api.pitchBend(bend);
 assert.deepEqual(messages.map(m=>m.bytes),[[0x9f,60,100],[0x8f,60,0],[0xb1,1,64],[0xc0,30],[0xd2,80],[0xa3,61,81],[0xe0,0,0],[0xe0,0,64],[0xe0,0,96],[0xe0,127,127]]);
 assert.ok(messages.every(m=>m.tracked));
 await api.send(new Uint8Array([0xf8]));assert.deepEqual(messages.at(-1),{bytes:[0xf8],tracked:false});
});
test('invalid primitive values never reach transport',()=>{
 const api=createMidiPrimitives({transmit:()=>assert.fail('sent invalid MIDI')});
 for(const bad of [-1,128,1.5,NaN,Infinity,'12',null]){
  assert.throws(()=>api.cc(bad,0));assert.throws(()=>api.cc(1,bad));
  assert.throws(()=>api.programChange(bad));assert.throws(()=>api.channelPressure(bad));
  assert.throws(()=>api.polyPressure(60,bad));assert.throws(()=>api.noteOn(60,{velocity:bad}));assert.throws(()=>api.noteOff(60,{velocity:bad}));
 }
 for(const channel of [0,17,1.5,NaN,'1',null]){
  for(const [name,args] of [['noteOn',[60]],['noteOff',[60]],['cc',[1,1]],['programChange',[1]],['pitchBend',[0]],['channelPressure',[1]],['polyPressure',[60,1]]])assert.throws(()=>api[name](...args,{channel}));
 }
 for(const value of [-1.1,1.1,NaN,Infinity,'0',null])assert.throws(()=>api.pitchBend(value));
 assert.throws(()=>api.noteOn(60,{velocity:0}));assert.throws(()=>api.noteOn('H4'));assert.throws(()=>api.polyPressure(128,1));
});
test('raw messages include system common, realtime and framed SysEx but reject malformed data',()=>{
 for(const bytes of [[0xf1,0],[0xf2,0,1],[0xf3,127],[0xf6],[0xf8],[0xfa],[0xfb],[0xfc],[0xfe],[0xff],[0xf0,0x7d,1,0xf7],[0x90,60,0]])assert.deepEqual(validateMidiMessage(bytes),bytes);
 for(const bytes of [[],[60,100],[0x90,60],[0x90,60,128],[0xc0,128],[0xf4],[0xf5],[0xf7],[0xf9],[0xfd],[0xf0,1],[0xf0,0xff,0xf7],[0xf8,0xfa],[0x90,60,1,0x80,60,0],[256],[-1],[0xc0,1.5],new Uint16Array([0xf8]),'abc'])assert.throws(()=>validateMidiMessage(bytes));
 assert.throws(()=>validateMidiMessage(new Uint8Array(65537)));
});
test('fire-and-forget errors remain observable and cancellation prevents later sends',async()=>{
 const errors=[];const api=createMidiPrimitives({transmit:async()=>{throw Error('disconnected');},onError:e=>errors.push(e.message)});
 await assert.rejects(api.noteOn(60),/disconnected/);assert.deepEqual(errors,['disconnected']);
 const cancelled=Symbol('cancelled');let active=true,sent=0,release;
 const scoped=createMidiPrimitives({check:()=>{if(!active)throw cancelled;},transmit:()=>{sent++;return new Promise(resolve=>{release=resolve;});},onError:()=>assert.fail('cancellation reported as failure')});
 const pending=scoped.noteOn(60);active=false;release();await assert.rejects(pending,e=>e===cancelled);
 assert.throws(()=>scoped.cc(1,64),e=>e===cancelled);assert.equal(sent,1);
});

test('bundled bend and CC examples emit balanced notes and restore their controllers',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {bundledExamples}=await import('../ui/example-files.js');
 for(const name of ['11_midi_pitch_bend.js','12_midi_cc.js']){
  const code=bundledExamples['/examples/'+name];
  assert.equal(code,await readFile(new URL('../ui/examples/'+name,import.meta.url),'utf8'));
  const messages=[];const api=createMidiPrimitives({transmit:async payload=>messages.push(payload.bytes)});
  const helpers={...api,setBpm:()=>{},beat:async()=>{}};
  await new (Object.getPrototypeOf(async()=>{}).constructor)(...Object.keys(helpers),code)(...Object.values(helpers));
  assert.ok(messages.some(m=>m[0]===0x90&&m[1]===60));assert.ok(messages.some(m=>m[0]===0x80&&m[1]===60));
  if(name.startsWith('11')){assert.deepEqual(messages[0],[0xc0,30]);assert.deepEqual(messages.at(-1),[0xe0,0,64]);}
  else {assert.deepEqual(messages.at(-2),[0xb0,64,0]);assert.deepEqual(messages.at(-1),[0xb0,1,0]);}
 }
});
