import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {voiceBytes,voiceSysEx,pack7,unpack7} from '../ui/ym2612-voice.js';
import {createOutputApi} from '../ui/midi-output.js';
import {createMidiHelpers} from '../ui/runtime.js';
import {binaryFile,readVoiceFile,fileBytes,filePreview} from '../ui/project-assets.js';
import {exportProject,importProject} from '../ui/project-cassette.js';
const fixture=name=>readFile(new URL('./fixtures/fm2612-bell.'+name,import.meta.url));
const preset=JSON.parse(await fixture('json'));

test('existing FM2612 preset and upstream-exported TFI/VGI preserve distinct logical operators',async()=>{
  const expected=voiceBytes(preset);
  assert.deepEqual(voiceBytes({...preset,operators:[undefined,...preset.operators]}),expected);
  assert.deepEqual(voiceBytes({...preset,operators:Object.fromEntries(preset.operators.map((v,i)=>[i+1,v]))}),expected);
  for(const format of ['tfi','vgi'])assert.deepEqual(voiceBytes(await fixture(format),{format}),expected);
  assert.deepEqual(Uint8Array.from(voiceSysEx(preset,null)),new Uint8Array(await fixture('syx')));
  assert.equal(expected[4],6);assert.equal(expected[14+2],16);assert.equal(expected[24+2],127);
});
test('transport preserves SSG, raw detune, AM, B4 and sr alias without lossy TFI conversion',()=>{
  const voice={algorithm:7,b4:0xf7,operators:[{dt:4,ssg:15,am:true,sr:25}, {}, {}, {}]};
  const bytes=voiceBytes(voice);
  assert.equal(bytes[2],0xf7);assert.equal(bytes[3],1);assert.equal(bytes[5],4);assert.equal(bytes[10],25);assert.equal(bytes[13],15);
  const message=voiceSysEx(voice,16);assert.equal(message[7],15);assert.ok(message.slice(1,-1).every(n=>n<128));
  assert.deepEqual(unpack7(message.slice(9,-1)),bytes);
  assert.equal(voiceBytes({...voice,pan:{left:false}})[2],0x77);
  const allBytes=Uint8Array.from({length:256},(_,i)=>i);assert.deepEqual(unpack7(pack7(allBytes)),allBytes);
  assert.throws(()=>unpack7([4,1,2]));
});
test('invalid and unsupported fields are rejected before transport',()=>{
  for(const value of [{lfo:3},{operators:[{ssg:16}]},{operators:[{am:1}]},{algorithm:8},{pan:{left:1}},{b4:8},{operators:[{typo:1}]},{operators:[{},{},{},{},{}]}])assert.throws(()=>voiceBytes(value));
  for(const format of ['tfi','vgi'])assert.throws(()=>voiceBytes(new Uint8Array(4),{format}));
  assert.throws(()=>voiceBytes('binary',{format:'tfi'}));
  assert.throws(()=>voiceBytes(new Uint8Array(42),{format:'unknown'}));
  for(const channel of [0,17,undefined,-1])assert.throws(()=>voiceSysEx({},channel));
});
test('handle voice and notes use the same route; omitted channel sets all while notes use CH1',async()=>{
  const events=[];
  const api=createOutputApi({request:async(type,payload)=>{events.push({type,...payload});return 42;},send:async payload=>events.push({type:'note',...payload}),play:createMidiHelpers({sleep:async()=>{},log:()=>{}}).play,onError:()=>{}});
  const all=api.midi.output('tetorica-ym2612',{}),ch2=api.midi.output('tetorica-ym2612',{channel:2});
  await all.setVoice(preset);await all.play('C4');await ch2.setVoice(preset);await ch2.play('E4');
  assert.deepEqual(events.map(e=>e.type),['output','midi','note','midi','note']);
  assert.deepEqual(events.filter(e=>e.type==='midi').map(e=>[e.route,e.bytes[7],e.tracked]),[[42,127,false],[42,1,false]]);
  assert.deepEqual(events.filter(e=>e.type==='note').map(e=>[e.route,e.channel]),[[42,1],[42,2]]);
  const previous=events.length;
  await assert.rejects(api.midi.output('tetorica-sega-psg').setVoice(preset),/YM2612/);
  await assert.rejects(all.setVoice({operators:[{ssg:16}]}));assert.equal(events.length,previous);
});
test('binary assets survive JSON local save and cassette roundtrip and load relative to Run file',async()=>{
  const tfi=await fixture('tfi'),vgi=await fixture('vgi');
  const project={files:{'/examples/main.js':'await lead.loadVoice("../voices/bell.tfi");','/voices/bell.tfi':binaryFile(tfi),'/voices/bell.vgi':binaryFile(vgi)},runPath:'/examples/main.js',selected:'/voices/bell.tfi',bpm:120,clockMode:'internal'};
  const restored=importProject(exportProject(JSON.parse(JSON.stringify(project))));assert.deepEqual(restored,project);
  assert.deepEqual(fileBytes(restored.files['/voices/bell.vgi']),new Uint8Array(vgi));assert.match(filePreview(restored.files['/voices/bell.tfi']),/42 bytes/);
  assert.equal(readVoiceFile(restored.files,'../voices/bell.tfi',project.runPath).format,'tfi');
  assert.throws(()=>readVoiceFile(restored.files,'../../escape.tfi',project.runPath),/escapes/);
  assert.throws(()=>readVoiceFile(restored.files,'./missing.tfi'),/not found/);
  const messages=[];
  const api=createOutputApi({request:async(type,payload)=>{if(type==='midi')messages.push(payload.bytes);return 1;},readVoice:path=>readVoiceFile(restored.files,path,project.runPath),onError:()=>{}});
  await api.midi.output('tetorica-ym2612').loadVoice('../voices/bell.tfi');
  assert.deepEqual(messages[0],voiceSysEx(preset,null));
});

test('unawaited load failures are reported and cancelled voice loads send nothing',async()=>{
 const errors=[],sent=[];
 const api=createOutputApi({request:async(...args)=>sent.push(args),readVoice:()=>{throw Error('Missing voice');},onError:e=>errors.push(e)});
 const lead=api.midi.output('tetorica-ym2612');
 lead.loadVoice('./missing.tfi');await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(errors[0].message,/Missing voice/);assert.equal(sent.length,0);
 assert.throws(()=>api.midi.output('tetorica-ym2612',{channel:null}),/channel/);
 const cancelled=Symbol();
 const scoped=createOutputApi({request:async(...args)=>sent.push(args),check:()=>{throw cancelled;},onError:e=>errors.push(e)});
 await assert.rejects(scoped.midi.output('tetorica-ym2612').setVoice(preset),e=>e===cancelled);
 assert.equal(sent.length,0);assert.equal(errors.length,1);
});
