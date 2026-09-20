import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
test('editor worker runs async MIDI code and reports completion',async()=>{
  const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
  try{await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Worker timeout')),3000);
    w.on('error',e=>{clearTimeout(timer);reject(e);});
    let notes=0;
    w.on('message',m=>{
      if(m.type==='ready')w.postMessage({type:'run',bpm:120,code:'await play("C4", {duration:0.002}); log("ok");'});
      if(m.type==='note'){notes++;assert.equal(m.payload.note,60);w.postMessage({type:'reply',id:m.id});}
      if(m.type==='error'){clearTimeout(timer);reject(new Error(m.text));}
      if(m.type==='done'){clearTimeout(timer);try{assert.equal(notes,1);resolve();}catch(e){reject(e);}}
    });
  });}finally{await w.terminate();}
});
test('default index lead runs repeatedly through MIDI worker',async()=>{
 const {leadExample}=await import('../ui/examples.js');
 const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Lead timeout')),3000);
  const fail=e=>{clearTimeout(timer);reject(e);};
  w.on('error',fail);
  let notes=0;
  w.on('message',m=>{
   try{
    if(m.type==='ready')w.postMessage({type:'run',bpm:120,code:leadExample});
    if(m.type==='error')throw new Error(m.text);
    if(m.type==='note'){
     assert.ok([64,67,69,71,74,76,79,81,83,86].includes(m.payload.note));
     assert.equal(m.payload.durationMs,40);
     w.postMessage({type:'reply',id:m.id});
     if(++notes===4){clearTimeout(timer);resolve();}
    }
   }catch(e){fail(e);}
  });
 });}finally{await w.terminate();}
});
async function runLoopScript(code){
 const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
 const logs=[],notes=[];
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Loop timeout')),3000);
  const fail=e=>{clearTimeout(timer);reject(e);};
  w.on('error',fail);
  w.on('message',m=>{
   if(m.type==='ready')w.postMessage({type:'run',bpm:120,code});
   if(m.type==='note'){notes.push(m.payload);w.postMessage({type:'reply',id:m.id});}
   if(m.type==='log')logs.push(m.text);
   if(m.type==='error')fail(new Error(m.text));
   if(m.type==='done'){clearTimeout(timer);resolve();}
  });
 });return {logs,notes};}finally{await w.terminate();}
}
test('scoped loops keep cycle slots separate across awaits and cancel waiting notes',async()=>{
 const result=await runLoopScript(`
 let a=0,b=0;
 liveLoop('a',async({cycle,beat})=>{
   log('a',cycle([1,2])); await beat(0.004); log('a2',cycle([8,9]));
   if(++a===2)stopLoop('a');
 });
 liveLoop('b',async({cycle,beat})=>{
   log('b',cycle([1,2])); await beat(0.006);
   if(++b===2)stopLoop('b');
 });
 liveLoop('cancel',async({beat,play})=>{await beat(0.1);await play('C4');});
 await beat(0.04);stopLoop('cancel');await beat(0.16);
 stopAllLoops();
 `);
 assert.deepEqual(result.logs.filter(x=>x.startsWith('a ')),['a 1','a 2']);
 assert.deepEqual(result.logs.filter(x=>x.startsWith('a2 ')),['a2 8','a2 9']);
 assert.deepEqual(result.logs.filter(x=>x.startsWith('b ')),['b 1','b 2']);
 assert.equal(result.notes.length,0);
});
test('same-name replacement cancels old scoped callback and all loops stop',async()=>{
 const result=await runLoopScript(`
 liveLoop('x',async({beat,play})=>{await beat(0.1);await play('C4');});
 liveLoop('x',async({play})=>{await play('E4',{duration:0.002});stopLoop('x');});
 await beat(0.02);
 liveLoop('y',async({beat,play})=>{await beat(0.1);await play('G4');});
 stopAllLoops();await beat(0.2);
 `);
 assert.deepEqual(result.notes.map(x=>x.note),[64]);
});
test('music helpers are available in scripts and loop-local APIs',async()=>{
 const result=await runLoopScript(`
 log(lerp(0,10,0.5));
 if(rand()<0||rand()>=1)throw new Error('rand bounds');
 if(rrange(2,2)!==2)throw new Error('rrange');
 liveLoop('chords',async({play,chord,randInt})=>{
   for(const note of chord('E4','minor'))await play(note,{duration:0.002,velocity:randInt(90,90)});
   stopLoop('chords');
 });
 await beat(0.1);
 `);
 assert.deepEqual(result.notes.map(x=>x.note),[64,67,71]);
 assert.deepEqual(result.logs,['5']);
});
