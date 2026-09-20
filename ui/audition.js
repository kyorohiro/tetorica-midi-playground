// Serialize Note On/Off, including release before an asynchronous On completes.
export function createAudition(invoke,onError=()=>{}) {
  let serial=0,queue=Promise.resolve();const held=new Map();
  const send=(command,args)=>{queue=queue.then(()=>invoke(command,args)).catch(onError);return queue;};
  return {
    press(key,note,channel,velocity){if(held.has(key))return;const id=++serial;held.set(key,id);send('keyboard_on',{id,note,channel,velocity});},
    release(key){const id=held.get(key);if(id===undefined)return;held.delete(key);return send('keyboard_off',{id});},
    releaseAll(){for(const key of [...held.keys()])this.release(key);return queue;},
  };
}
