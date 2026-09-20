export const slotNames=Object.freeze(Array.from({length:4},(_,i)=>`MIDI_OUTPUT_0${i+1}`));
export const outputSlots=Object.freeze(Object.fromEntries(slotNames.map(name=>[name,Symbol(name)])));
export const internalOutputs=['tetorica-ym2612','tetorica-sega-psg'];
export function cleanMappings(value) {
  const result={};
  for(const slot of slotNames){
    const v=value?.[slot];
    if(v?.kind==='internal'&&internalOutputs.includes(v.name))result[slot]={kind:'internal',name:v.name};
    else if(v?.kind==='port'&&typeof v.id==='string'&&v.id&&typeof v.name==='string'&&v.name)result[slot]={kind:'port',id:v.id,name:v.name};
  }
  return result;
}
export function resolveOutput(value,mappings){
  const slot=slotNames.find(name=>outputSlots[name]===value);
  if(!slot){if(typeof value!=='string'||!value.trim())throw Error('Expected a MIDI output name, internal ID or MIDI_OUTPUT slot');return {name:value};}
  const target=cleanMappings(mappings)[slot];
  if(!target)throw Error(`Set the destination for ${slot} in MIDI connections`);
  return target.kind==='internal'?{name:target.name}:{name:target.name,portId:target.id};
}
export function mappingAvailable(target,ports){return target.kind==='internal'||ports.some(p=>p.id===target.id&&p.name===target.name);}
export function createMappingStore(storage){
  const key='tetorica-output-mappings-v1';let value={};
  try{value=cleanMappings(JSON.parse(storage.getItem(key)));}catch{}
  return {snapshot:()=>cleanMappings(value),set(slot,target){
    if(!slotNames.includes(slot))throw Error('Unknown output slot');
    const next=cleanMappings({...value,[slot]:target});
    storage.setItem(key,JSON.stringify(next));value=next;
  }};
}
export function mountOutputMappings(container,{storage,beforeChange,onError}){
  const store=createMappingStore(storage);let ports=[],busy=false;
  container.innerHTML='<h3>Script output assignments</h3><p>Choose destinations for MIDI_OUTPUT_01–04. Channel defaults to 1 in code. Changing an assignment stops playback; press Run again. Internal destinations must be enabled in code or MIDI settings.</p>';
  const selects=slotNames.map(slot=>{
    const label=document.createElement('label');label.textContent=slot+' ';
    const select=document.createElement('select');label.append(select);container.append(label);
    select.onchange=async()=>{
      if(busy)return;const index=Number(select.value),target=select.targets[index];busy=true;selects.forEach(s=>s.disabled=true);
      try{await beforeChange();store.set(slot,target);}catch(e){onError(e);}finally{busy=false;render();}
    };return select;
  });
  function render(){
    const current=store.snapshot();selects.forEach((select,i)=>{
      const targets=[null,...internalOutputs.map(name=>({kind:'internal',name})),...ports.map(p=>({kind:'port',id:p.id,name:p.name}))];
      const saved=current[slotNames[i]];
      if(saved&&!targets.some(t=>JSON.stringify(t)===JSON.stringify(saved)))targets.push(saved);
      select.targets=targets;
      select.replaceChildren(...targets.map((target,index)=>{
        const o=document.createElement('option');o.value=String(index);
        o.textContent=target?target.name+(target.kind==='port'?` [${target.id}]`:' (internal)')+(!mappingAvailable(target,ports)?' — unavailable':''):'Not assigned';return o;
      }));
      select.value=String(Math.max(0,targets.findIndex(t=>JSON.stringify(t)===JSON.stringify(saved))));select.disabled=busy;
    });
  }
  render();return {snapshot:store.snapshot,refresh(next){ports=next;render();}};
}
