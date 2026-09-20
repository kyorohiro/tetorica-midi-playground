// Handles are immutable routing descriptions; connections open lazily on first play.
export function createOutputApi({request,play,send,onError,check=()=>{},owner}) {
  const handles=new WeakMap(), connections=new Map();
  function output(name,{channel=1}={}) {
    if(typeof name!=='string'||!name.trim())throw new Error('Expected a MIDI output name or internal ID');
    if(!Number.isInteger(channel)||channel<1||channel>16)throw new Error('MIDI channel must be 1–16');
    const handle=Object.freeze({play:(note,options)=>playOutput(handle,note,options)});
    handles.set(handle,{name,channel});return handle;
  }
  function playOutput(handle,note,options={},scope={check,owner}) {
    const task=(async()=>{
      scope.check();
      const target=handles.get(handle);
      if(!target)throw new Error('Expected a midi.output() handle');
      if(Object.hasOwn(options,'channel')&&options.channel!==target.channel)throw new Error('Set the channel on midi.output(), not play()');
      await play(note,{...options,channel:target.channel},async payload=>{
        scope.check();
        if(!connections.has(target.name))connections.set(target.name,request('output',{name:target.name}));
        const route=await connections.get(target.name);scope.check();
        await send({...payload,route,...(scope.owner===undefined?{}:{owner:scope.owner})});
      });
      scope.check();
    })();
    // Fire-and-forget play remains observable; cancellation belongs to the loop.
    task.catch(e=>{if(typeof e!=='symbol')onError(e);});
    return task;
  }
  async function enableSoundChip(chip){
    if(!['ym2612','sega-psg'].includes(chip))throw new Error('Unknown sound chip: '+chip);
    check();await request('enable-chip',{chip});check();
  }
  return {midi:Object.freeze({output}),enableSoundChip,playOutput,
    scoped:(check,owner)=>(handle,note,options)=>playOutput(handle,note,options,{check,owner})};
}
