import {createMidiHelpers} from './runtime.js';
import {installPlaygroundExecutionGuards} from './shared/playground_execution.js';
installPlaygroundExecutionGuards(globalThis);
let sequence=0;
const pending=new Map();
const send=payload=>new Promise((resolve,reject)=>{
  if(pending.size>=64){reject(new Error('Too many concurrent MIDI requests'));return;}
  const id=++sequence;pending.set(id,{resolve,reject});postMessage({type:'note',id,payload});
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
onmessage=async ({data})=>{
  if(data.type==='reply'){
    const p=pending.get(data.id);pending.delete(data.id);
    if(p)data.error?p.reject(new Error(data.error)):p.resolve();return;
  }
  if(data.type!=='run')return;
  let logCount=0;
  const log=(...args)=>logCount++<1000 && postMessage({type:'log',text:args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')});
  const api=createMidiHelpers({send,sleep,log,bpm:data.bpm});
  const loops=new Map();
  function liveLoop(name,fn){
    if(typeof name!=='string'||typeof fn!=='function')throw new Error('liveLoop(name, callback) required');
    if(loops.size>=16)throw new Error('At most 16 loops');
    const token={};loops.set(name,token);
    (async()=>{try{while(loops.get(name)===token){await fn();await sleep(1);}}catch(e){postMessage({type:'error',text:String(e)});}})();
  }
  try {
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFunction(...Object.keys(api),'liveLoop','console',data.code)(...Object.values(api),liveLoop,{log,warn:log,error:log});
    postMessage({type:loops.size?'looping':'done'});
  } catch(e){postMessage({type:'error',text:String(e)});}
};
