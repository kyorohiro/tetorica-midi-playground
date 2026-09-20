import {test} from 'node:test';
import assert from 'node:assert/strict';
import {noteNumber,createMidiHelpers} from '../ui/runtime.js';
test('note spelling and bounds',()=>{assert.equal(noteNumber('C4'),60);assert.equal(noteNumber('Bb3'),58);assert.equal(noteNumber('C-1'),0);for(const v of ['C99','no',128,-1])assert.throws(()=>noteNumber(v));});
test('play sends bounded MIDI with BPM duration; beat is rest',async()=>{const sent=[],waits=[];const api=createMidiHelpers({send:async p=>sent.push(p),sleep:async ms=>waits.push(ms),log:()=>{}});await api.play('E4',{duration:0.5,channel:2});api.setBpm(60);await api.beat(1);assert.deepEqual(sent,[{note:64,channel:2,velocity:90,durationMs:250}]);assert.deepEqual(waits,[250,1000]);for(const options of [{channel:0},{velocity:128},{duration:100},{duration:NaN}])await assert.rejects(api.play(60,options));assert.equal(sent.length,1);});
