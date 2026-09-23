import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {bundledExamples} from '../ui/example-files.js';
import {mergeExamples} from '../ui/example-migrations.js';

const assigned={MIDI_OUTPUT_01:{kind:'internal',name:'tetorica-ym2612'},MIDI_OUTPUT_02:{kind:'internal',name:'tetorica-sega-psg'}};
async function execute(name,mappings={}) {
 const path='/examples/'+name,code=bundledExamples[path];
 assert.equal(code,await readFile(new URL('../ui/examples/'+name,import.meta.url),'utf8'));
 const notes=[],released=[],outputs=[],chips=[];
 const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
 try {return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Example timed out')),4000);
  const finish=(error)=>{clearTimeout(timer);error?reject(error):resolve({notes,released,outputs,chips});};
  w.on('error',finish);
  w.on('message',m=>{
   if(m.type==='ready')w.postMessage({type:'run',bpm:120,path,outputMappings:mappings,code:code+'\nawait beat(0.1);stopAllLoops();'});
   if(m.type==='enable-chip'){chips.push(m.payload.chip);w.postMessage({type:'reply',id:m.id});}
   if(m.type==='output'){outputs.push(m.payload);w.postMessage({type:'reply',id:m.id,value:m.payload.name==='tetorica-sega-psg'?2:1});}
   if(m.type==='note'){notes.push(m.payload);w.postMessage({type:'reply',id:m.id});}
   if(m.type==='release')released.push(m.owner);
   if(m.type==='error')finish(Error(m.text));
   if(m.type==='done')finish();
  });
 });}finally{await w.terminate();}
}
for(const [name,expected,owners] of [
 ['04_first_note.js',[[1,0,60]],[]],
 ['05_live_loop.js',[[1,0,60]],[1]],
 ['06_multi_channel.js',[[1,0,60],[1,1,48]],[1,2]],
 ['07_external_output.js',[[1,0,60]],[]],
 ['08_output_slots.js',[[1,0,60],[2,1,67]],[]],
])test(`${name}: routes, channels, notes and loop release`,async()=>{
 const result=await execute(name,assigned);
 assert.deepEqual(result.notes.map(n=>[n.route,n.channel,n.note]).sort(),expected);
 assert.deepEqual(result.released.sort(),owners);
 assert.deepEqual(result.notes.filter(n=>n.owner!==undefined).map(n=>n.owner).sort(),owners);
 if(name==='07_external_output.js') {
  assert.equal(result.outputs[0].name,'REPLACE WITH YOUR MIDI OUTPUT NAME');
  assert.deepEqual(result.chips,[]);
 }else assert.ok(result.chips.includes('ym2612'));
});
test('slot example explains missing setup and preserves user-edited examples',async()=>{
 await assert.rejects(execute('08_output_slots.js'),/Set the destination for MIDI_OUTPUT_01/);
 const custom=Object.fromEntries(Object.keys(bundledExamples).map(path=>[path,'// custom '+path]));
 assert.deepEqual(mergeExamples(custom,bundledExamples),custom);
 assert.deepEqual(mergeExamples({},bundledExamples),bundledExamples);
});
