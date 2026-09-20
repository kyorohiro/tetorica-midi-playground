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
