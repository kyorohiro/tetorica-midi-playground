import {test} from 'node:test';
import assert from 'node:assert/strict';
import {outputSlots,cleanMappings,resolveOutput,mappingAvailable,createMappingStore} from '../ui/output-mappings.js';
import {createOutputApi} from '../ui/midi-output.js';
import {createMidiHelpers} from '../ui/runtime.js';
test('mapping storage restores only valid assignments, preserves missing devices and fails atomically',()=>{
 let saved='invalid';const storage={getItem:()=>saved,setItem:(k,v)=>saved=v};
 const store=createMappingStore(storage);assert.deepEqual(store.snapshot(),{});
 const port={kind:'port',id:'42',name:'Synth'};store.set('MIDI_OUTPUT_01',port);
 const restored=createMappingStore(storage);assert.deepEqual(restored.snapshot(),{MIDI_OUTPUT_01:port});
 assert.equal(mappingAvailable(port,[{id:'43',name:'Synth'}]),false);
 assert.equal(mappingAvailable(port,[{id:'42',name:'Other'}]),false);
 assert.equal(mappingAvailable(port,[{id:'42',name:'Synth'}]),true);
 storage.setItem=()=>{throw Error('disk full');};assert.throws(()=>store.set('MIDI_OUTPUT_01',null),/disk full/);
 assert.deepEqual(store.snapshot(),restored.snapshot());
 assert.deepEqual(cleanMappings({MIDI_OUTPUT_02:{kind:'internal',name:'bad'}}),{});
 assert.throws(()=>resolveOutput(outputSlots.MIDI_OUTPUT_02,{}),/MIDI_OUTPUT_02/);
 assert.deepEqual(resolveOutput('MIDI_OUTPUT_02',{}),{name:'MIDI_OUTPUT_02'}); // literal name is not a slot
});
test('run snapshots are immutable and two slots targeting one port share routing',async()=>{
 const target={kind:'port',id:'42',name:'Synth'};
 const mappings={MIDI_OUTPUT_01:target,MIDI_OUTPUT_02:target};let requests=0;const sent=[];
 const api=createOutputApi({mappings,request:async(type,p)=>{requests++;assert.deepEqual(p,{name:'Synth',portId:'42'});return 9;},
   play:createMidiHelpers({sleep:async()=>{},log:()=>{}}).play,send:async p=>sent.push(p),onError:assert.fail});
 mappings.MIDI_OUTPUT_01=null;target.id='changed';
 const a=api.midi.output(outputSlots.MIDI_OUTPUT_01),b=api.midi.output(outputSlots.MIDI_OUTPUT_02,{channel:1});
 await Promise.all([a.play('C4'),b.play('C4')]);
 assert.equal(requests,1);assert.deepEqual(sent.map(n=>[n.route,n.channel]),[[9,0],[9,1]]);
});

test('assignment UI stops before saving and retains unavailable ports',async()=>{
 const {mountOutputMappings}=await import('../ui/output-mappings.js');
 const previous=globalThis.document;
 const element=()=>({children:[],value:'',disabled:false,append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;}});
 globalThis.document={createElement:element};
 try{
  const order=[];let finish;
  const root=element();const storage={getItem:()=>null,setItem:()=>order.push('saved')};
  const ui=mountOutputMappings(root,{storage,beforeChange:()=>{order.push('stop');return new Promise(r=>finish=r);},onError:assert.fail});
  ui.refresh([{id:'port-id',name:'Synth'}]);
  const select=root.children[0].children[0];select.value='3';
  const change=select.onchange();assert.deepEqual(order,['stop']);assert.equal(select.disabled,true);
  finish();await change;assert.deepEqual(order,['stop','saved']);
  assert.deepEqual(ui.snapshot().MIDI_OUTPUT_01,{kind:'port',id:'port-id',name:'Synth'});
  ui.refresh([]);assert.match(select.children.at(-1).textContent,/unavailable/);
  assert.equal(select.disabled,false);
 }finally{globalThis.document=previous;}
});
