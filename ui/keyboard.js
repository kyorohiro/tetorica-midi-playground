// Worker callbacks receive serializable key data, not DOM KeyboardEvent objects.
export function createKeyboardHandlers(onError) {
  const handlers=new Map();
  function register(type,name,fn){
    if(typeof name!=='string'||!name||typeof fn!=='function')throw new Error('Keyboard handler requires a name and callback');
    const id=type+':'+name;
    if(!handlers.has(id)&&handlers.size>=32)throw new Error('At most 32 keyboard handlers');
    handlers.set(id,{type,fn,busy:false});
  }
  async function dispatch(event){
    if(!event||!['keydown','keyup'].includes(event.type)||event.repeat)return;
    await Promise.all([...handlers.values()].filter(h=>h.type===event.type&&!h.busy).map(async h=>{
      h.busy=true;
      try{await h.fn({...event});}catch(e){onError(e);}finally{h.busy=false;}
    }));
  }
  return {
    onKeyboardPressKey:(name,fn)=>register('keydown',name,fn),
    onKeyboardReleaseKey:(name,fn)=>register('keyup',name,fn),
    dispatch,get size(){return handlers.size;}
  };
}

export function keyData(event){
  return {type:event.type,key:event.key,code:event.code,repeat:!!event.repeat,
    shiftKey:!!event.shiftKey,ctrlKey:!!event.ctrlKey,altKey:!!event.altKey,metaKey:!!event.metaKey};
}
