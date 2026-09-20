import {test} from 'node:test';
import assert from 'node:assert/strict';
import {noteNumber,createMidiHelpers} from '../ui/runtime.js';
test('note spelling and bounds',()=>{assert.equal(noteNumber('C4'),60);assert.equal(noteNumber('Bb3'),58);assert.equal(noteNumber('C-1'),0);for(const v of ['C99','no',128,-1])assert.throws(()=>noteNumber(v));});
test('play sends bounded MIDI with BPM duration; beat is rest',async()=>{const sent=[],waits=[];const api=createMidiHelpers({send:async p=>sent.push(p),sleep:async ms=>waits.push(ms),log:()=>{}});await api.play('E4',{duration:0.5,channel:2});api.setBpm(60);await api.beat(1);assert.deepEqual(sent,[{note:64,channel:2,velocity:90,durationMs:250}]);assert.deepEqual(waits,[250,1000]);for(const options of [{channel:0},{velocity:128},{duration:100},{duration:NaN}])await assert.rejects(api.play(60,options));assert.equal(sent.length,1);});
test('pentatonic scale and cycle support the lead pattern',()=>{
 const make=()=>createMidiHelpers({send:async()=>{},sleep:async()=>{},log:()=>{}});
 const api=make();
 assert.deepEqual(api.scale('E4','minorPentatonic',2),['E4','G4','A4','B4','D5','E5','G5','A5','B5','D6']);
 assert.deepEqual(Array.from({length:4},()=>api.cycle([0.04,0.04,0.08])),[0.04,0.04,0.08,0.04]);
 assert.equal(api.cycle('other',[1,2]),1);
 assert.equal(make().cycle([0.04,0.04,0.08]),0.04);
 assert.throws(()=>api.scale('G9','major',2));
 assert.throws(()=>api.scale('E4','unknown',2));
 assert.throws(()=>api.cycle([]));
});

test('nextBeat uses a shared origin and advances past exact boundaries',async()=>{
 let time=0;const waits=[];
 const api=createMidiHelpers({send:async()=>{},sleep:async ms=>{waits.push(ms);time+=ms;},now:()=>time,log:()=>{}});
 time=125;await api.nextBeat();assert.ok(Math.abs(time-500)<0.001);
 await api.nextBeat();assert.ok(Math.abs(time-1000)<0.001);
 assert.ok(waits.every(ms=>ms>0&&ms<=25));
});
test('tempo changes preserve beat phase and affect a pending nextBeat',async()=>{
 let time=0,changed=false,api;
 api=createMidiHelpers({send:async()=>{},sleep:async ms=>{time+=ms;if(!changed){changed=true;api.setBpm(60);}},now:()=>time,log:()=>{}});
 time=225;await api.nextBeat();assert.ok(Math.abs(time-750)<0.001);
 const before=time;assert.throws(()=>api.setBpm(0));
 await api.nextBeat();assert.ok(Math.abs(time-before-1000)<0.001);
});
test('chord spelling matches FM chord types and enforces MIDI range',()=>{
 const api=createMidiHelpers({send:async()=>{},sleep:async()=>{},log:()=>{}});
 const expected={major:['C4','E4','G4'],minor:['C4','D#4','G4'],major7:['C4','E4','G4','B4'],minor7:['C4','D#4','G4','A#4'],dominant7:['C4','E4','G4','A#4']};
 for(const [name,notes] of Object.entries(expected))assert.deepEqual(api.chord('C4',name),notes);
 assert.deepEqual(api.chord('Bb3','major'),['A#3','D4','F4']);
 assert.throws(()=>api.chord('C4','unknown'));
 assert.throws(()=>api.chord('G9','major'));
});
test('random helpers cover endpoints, numeric coercion and interpolation',()=>{
 let value=0;
 const api=createMidiHelpers({send:async()=>{},sleep:async()=>{},log:()=>{},random:()=>value});
 assert.equal(api.rand(),0);assert.equal(api.randInt(2,5),2);
 value=0.999999;assert.equal(api.randInt(2,5),5);
 value=0.5;assert.equal(api.rrange('2','6'),4);assert.equal(api.rrange(6,2),4);
 assert.equal(api.randInt(2.2,3.8),3);
 assert.equal(api.lerp('2','6',0.25),3);assert.equal(api.lerp(2,6,2),10);
 for(const [min,max] of [[4,2],[2.2,2.8],[NaN,2],[0,Infinity]])assert.throws(()=>api.randInt(min,max));
 assert.throws(()=>api.lerp(0,1,NaN));
});

test('noteLerp rounds to playable MIDI notes and checks range before rounding',async()=>{
 const sent=[];
 const api=createMidiHelpers({send:async note=>sent.push(note),sleep:async()=>{},log:()=>{}});
 assert.equal(api.noteLerp('C4','C5',0),60);
 assert.equal(api.noteLerp('C4','C5',1),72);
 assert.equal(api.noteLerp('C4','C5',0.5),66);
 assert.equal(api.noteLerp(60,61,0.5),61);
 assert.equal(api.noteLerp(61,60,0.5),61);
 assert.equal(api.noteLerp('Bb3','C4',0.5),59);
 assert.equal(api.noteLerp(60,72,2),84);
 assert.equal(api.noteLerp(60,72,-1),48);
 for(const args of [[0,1,-0.1],[126,127,1.1],[60,72,NaN],[60,72,Infinity],['invalid',60,0.5]])assert.throws(()=>api.noteLerp(...args));
 await api.play(api.noteLerp('C4','C5',0.5),{duration:0.1});
 assert.equal(sent[0].note,66);
});
