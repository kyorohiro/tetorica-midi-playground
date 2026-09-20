import {outputSlots} from './output-mappings.js';
import {createOutputApi} from './midi-output.js';
import {bindLoopContext} from './loop-context.js';
import {createClockWait} from './clock-wait.js';
import {createClockReceiver} from './clock-receiver.js';
import {prepareModules} from './modules.js';
import {createKeyboardHandlers} from './keyboard.js';
import {createLoops} from './loops.js';
import {createMidiHelpers,noteNumber} from './runtime.js';
import {installPlaygroundExecutionGuards} from './shared/playground_execution.js';
installPlaygroundExecutionGuards(globalThis);
let sequence=0,evaluate=null,evaluating=false;
let keyboard=null,clockReceiver=null,external=null;
const pending=new Map();
const request=(type,payload)=>new Promise((resolve,reject)=>{
  if(pending.size>=64){reject(new Error('Too many concurrent MIDI requests'));return;}
  const id=++sequence;pending.set(id,{resolve,reject});postMessage({type,id,payload});
});
const send=payload=>request('note',payload);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
onmessage=async ({data})=>{
  if(data.type==='clock'){if(external)external.receive(data.event);else clockReceiver?.receive(data.event);return;}
  if(data.type==='keyboard'){await keyboard?.dispatch(data.event);return;}
  if(data.type==='reply'){
    const p=pending.get(data.id);pending.delete(data.id);
    if(p)data.error?p.reject(new Error(data.error)):p.resolve(data.value);return;
  }
  if(data.type==='update'){if(evaluate&&!evaluating)await evaluate(data);else postMessage({type:'log',text:'Apply skipped: previous script evaluation is still running.'});return;}
  if(data.type!=='run')return;
  clockReceiver=createClockReceiver(data.runId);
  external=data.externalClock?createClockWait(clockReceiver,{sleep,onStop:text=>postMessage({type:'error',text})}):null;
  if(external)setInterval(()=>{try{external.check();}catch{}},25);
  let logCount=0;
  const log=(...args)=>logCount++<1000 && postMessage({type:'log',text:args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')});
  const api=createMidiHelpers({send,sleep,log,bpm:data.bpm});
  if(external){
    api.beat=count=>external.beat(count);api.nextBeat=()=>external.nextBeat();
    api.play=async(note,{duration=0.5,channel=1,velocity=90}={},sender=send)=>{
      if(!Number.isFinite(duration)||duration<=0||duration>128||!Number.isInteger(channel)||channel<1||channel>16||!Number.isInteger(velocity)||velocity<1||velocity>127)throw new Error('Invalid external MIDI note options');
      external.check();
      await sender({note:noteNumber(note),channel,velocity,durationMs:10000,durationBeats:duration});
      await external.beat(Math.ceil(duration*24)/24);
    };
  }
  const outputs=createOutputApi({mappings:data.outputMappings,request,play:(...args)=>api.play(...args),send,onError:e=>postMessage({type:'error',text:String(e)})});
  Object.assign(api,{...outputSlots,midi:outputs.midi,enableSoundChip:outputs.enableSoundChip,playOutput:outputs.playOutput});
  keyboard=createKeyboardHandlers(e=>postMessage({type:'error',text:String(e)}));
  Object.assign(api,{onKeyboardPressKey:keyboard.onKeyboardPressKey,onKeyboardReleaseKey:keyboard.onKeyboardReleaseKey});
  const loops=createLoops({sleep,onError:e=>postMessage({type:'error',text:String(e)}),onStop:owner=>postMessage({type:'release',owner}),createApi:(check,owner)=>{
    // Share the Run clock; keep cancellation and cycle state local to this loop.
    let slot=0;const cycles=new Map();
    const helpers={...api,playOutput:outputs.scoped(check,owner)};
    Object.assign(helpers,external?{beat:count=>external.beat(count,check),nextBeat:()=>external.nextBeat(check)}:api.createLoopTiming(check));
    helpers.play=async(note,options)=>{
      check();
      await api.play(note,options,payload=>{check();return send({...payload,owner});});
      check();
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
  evaluate=async(data)=>{
  evaluating=true;
  try {
    if(external){postMessage({type:'waiting-clock'});await external.ready();}
    const modules=await prepareModules(data.files||{},data.code,data.path||'/index.js');
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFunction(...Object.keys(api),'liveLoop','console',bindLoopContext(modules.code))(...Object.values(api),liveLoop,{log,warn:log,error:log});
    postMessage({type:loops.size?'looping':keyboard.size?'listening':'done'});
  } catch(e){postMessage({type:'error',text:String(e)});}finally{evaluating=false;}
  };
  await evaluate(data);
};
