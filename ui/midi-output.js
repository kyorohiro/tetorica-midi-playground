import {voiceSysEx} from './ym2612-voice.js';
import {resolveOutput,cleanMappings} from './output-mappings.js';
// Handles are immutable routing descriptions; connections open lazily on first play.
export function createOutputApi({request,play,send,onError,check=()=>{},owner,mappings={},readVoice=()=>{throw Error("Voice files are unavailable");}}) {
  const assignments=cleanMappings(mappings);
  const handles=new WeakMap(), connections=new Map();
  function output(name,{channel}={}) {
    const destination=resolveOutput(name,assignments);
    const ym2612=['tetorica-ym2612','Tetorica YM2612'].includes(destination.name);
    const voiceChannel=channel===undefined&&ym2612?null:channel??0;
    if(channel===undefined)channel=0;
    if(!Number.isInteger(channel)||channel<0||channel>15)throw new Error('MIDI channel must be 0–15');
    const handle=Object.freeze({play:(note,options)=>playOutput(handle,note,options),
      setVoice:(input,options)=>observe(setVoice(handle,input,options)),
      loadVoice:path=>observe((async()=>{check();const {data,format}=readVoice(path);return setVoice(handle,data,{format});})())});
    handles.set(handle,{destination,channel,voiceChannel,ym2612});return handle;
  }
  function playOutput(handle,note,options={},scope={check,owner}) {
    const task=(async()=>{
      scope.check();
      const target=handles.get(handle);
      if(!target)throw new Error('Expected a midi.output() handle');
      if(Object.hasOwn(options,'channel')&&options.channel!==target.channel)throw new Error('Set the channel on midi.output(), not play()');
      await play(note,{...options,channel:target.channel},async payload=>{
        scope.check();
        const route=await routeFor(target);scope.check();
        await send({...payload,route,...(scope.owner===undefined?{}:{owner:scope.owner})});
      });
      scope.check();
    })();
    // Fire-and-forget play remains observable; cancellation belongs to the loop.
    task.catch(e=>{if(typeof e!=='symbol')onError(e);});
    return task;
  }
  function routeFor(target){
    const key=JSON.stringify(target.destination);
    if(!connections.has(key))connections.set(key,request('output',target.destination));
    return connections.get(key);
  }
  function observe(task){
    task.catch(e=>{if(typeof e!=='symbol')onError(e);});return task;
  }
  async function setVoice(handle,input,options){
      check();const target=handles.get(handle);
      if(!target?.ym2612)throw Error('setVoice requires a Tetorica YM2612 output');
      const bytes=voiceSysEx(input,target.voiceChannel,options);
      const route=await routeFor(target);check();
      await request('midi',{route,bytes,tracked:false});check();
  }
  async function enableSoundChip(chip){
    if(!['ym2612','sega-psg'].includes(chip))throw new Error('Unknown sound chip: '+chip);
    check();await request('enable-chip',{chip});check();
  }
  return {midi:Object.freeze({output}),enableSoundChip,playOutput,
    scoped:(check,owner)=>(handle,note,options)=>playOutput(handle,note,options,{check,owner})};
}
