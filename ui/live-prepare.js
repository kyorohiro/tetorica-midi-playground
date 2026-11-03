// One cache per Run. Apply reuses it; replacing the Worker discards it.
export function createLivePrepare(api) {
  const prepared=new Map();
  return function livePrepare(name,factory) {
    if(typeof name!=='string'||!name.trim())return Promise.reject(new TypeError('livePrepare needs a nonempty name'));
    if(typeof factory!=='function')return Promise.reject(new TypeError('livePrepare needs a factory callback'));
    if(prepared.has(name))return prepared.get(name);
    // Publish before invoking the factory, including factories that resolve immediately.
    const pending=Promise.resolve().then(()=>factory(api)).catch(error=>{
      if(prepared.get(name)===pending)prepared.delete(name);
      throw error;
    });
    prepared.set(name,pending);
    return pending;
  };
}
