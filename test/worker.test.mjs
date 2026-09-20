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
