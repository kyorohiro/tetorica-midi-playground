import test from 'node:test';
import assert from 'node:assert/strict';
import {channels,toNativeNote} from '../ui/midi-channels.js';
import {createMidiHelpers} from '../ui/runtime.js';
import {createMidiPrimitives} from '../ui/midi-primitives.js';
import {voiceSysEx} from '../ui/ym2612-voice.js';
import {mergeExamples} from '../ui/example-migrations.js';
import {legacyChannelExamples} from '../ui/legacy-channel-examples.js';
import {bundledExamples} from '../ui/example-files.js';
test('all 16 numeric/constant channels reach the same wire channel and native note slot',async()=>{
 for(let i=0;i<16;i++) {
  assert.equal(channels[`CH${i+1}`],i);
  let note,message;
  const api=createMidiHelpers({send:async p=>{note=toNativeNote(p);},sleep:async()=>{},log(){}});
  await api.play(60,{channel:i});assert.equal(note.channel,i+1);
  await createMidiPrimitives({transmit:async p=>{message=p.bytes;}}).noteOn(60,{channel:i});assert.equal(message[0],0x90|i);
  assert.equal(voiceSysEx({},i)[7],i);
 }
 assert.equal(voiceSysEx({},null)[7],127);
 for(const n of [-1,16,NaN,1.5])assert.throws(()=>toNativeNote({channel:n}));
});
test('only untouched bundled channel examples migrate',()=>{
 const path='/examples/06_multi_channel.js';
 assert.equal(mergeExamples({[path]:legacyChannelExamples[path]},bundledExamples)[path],bundledExamples[path]);
 const edited=legacyChannelExamples[path]+'\n// my notes';
 assert.equal(mergeExamples({[path]:edited},bundledExamples)[path],edited);
});
