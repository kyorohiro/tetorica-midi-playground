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
