// Each callback receives helpers bound to its own lifetime, including across await.
export function createLoops({createApi, sleep, onError, onStop=()=>{}}) {
  const loops=new Map();
  let generation=0;
  const cancelled=Symbol('loop stopped');
  function stopLoop(name){
    const state=loops.get(name);
    if(state){state.active=false;loops.delete(name);onStop(state.id);}
  }
  function stopAllLoops(){for(const name of [...loops.keys()])stopLoop(name);}
  function liveLoop(name,fn){
    if(typeof name!=='string'||!name||typeof fn!=='function')throw new Error('liveLoop(name, callback) required');
    if(!loops.has(name)&&loops.size>=16)throw new Error('At most 16 loops');
    stopLoop(name);
    const state={active:true,id:++generation};
    const check=()=>{if(!state.active)throw cancelled;};
    const api=createApi(check,state.id);
    loops.set(name,state);
    (async()=>{
      try{
        while(state.active){api.resetCycleSlots();await fn(api.helpers);check();await sleep(1);}
      }catch(e){if(e!==cancelled)onError(e);}
      finally{state.active=false;if(loops.get(name)===state)loops.delete(name);}
    })();
  }
  return {liveLoop,stopLoop,stopAllLoops,get size(){return loops.size;}};
}
