import {createLoops} from './loops.js';
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
  const loops=createLoops({sleep,onError:e=>postMessage({type:'error',text:String(e)}),createApi:check=>{
    // Share the Run clock; keep cancellation and cycle state local to this loop.
    let slot=0;const cycles=new Map();
    const helpers={...api};
    for(const key of ['play','beat','nextBeat'])helpers[key]=async(...args)=>{
      check();await api[key](...args);check();
    };
    helpers.cycle=(keyOrValues,maybeValues)=>{
      check();const values=maybeValues===undefined?keyOrValues:maybeValues;
      if(!Array.isArray(values)||!values.length)throw new Error('cycle needs a nonempty array');
      const key=maybeValues===undefined?'slot:'+slot++:'key:'+String(keyOrValues);
      const index=cycles.get(key)||0;cycles.set(key,index+1);return values[index%values.length];
    };
    return {helpers,resetCycleSlots:()=>{slot=0;}};
  }});
  Object.assign(api,{stopLoop:loops.stopLoop,stopAllLoops:loops.stopAllLoops});
  const liveLoop=loops.liveLoop;
  try {
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFunction(...Object.keys(api),'liveLoop','console',data.code)(...Object.values(api),liveLoop,{log,warn:log,error:log});
    postMessage({type:loops.size?'looping':'done'});
  } catch(e){postMessage({type:'error',text:String(e)});}
};
