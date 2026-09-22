export const fmFields=[
  ['multi','Multiplier (0 = ½)',15],['dt','Detune (register value)',7],
  ['tl','Total level (127 = quietest)',127],['rs','Rate scaling',3],
  ['ar','Attack rate',31],['d1r','Decay rate',31],['d2r','Sustain rate',31],
  ['sl','Sustain level',15],['rr','Release rate',15],['ssg','SSG-EG',15],
];
export function readFmPatch(form,original={}) {
  const integer=(name,max)=>{
    const raw=form.elements.namedItem(name).value;
    const n=Number(raw);
    if(raw.trim()===''||!Number.isInteger(n)||n<0||n>max)throw Error(`${name} must be an integer 0–${max}`);
    return n;
  };
  return {b4:original.b4??0xc0,algorithm:integer('algorithm',7),feedback:integer('feedback',7),
    operators:Array.from({length:4},(_,i)=>({...original.operators?.[i],am:original.operators?.[i]?.am??false,...Object.fromEntries(fmFields.map(([key,,max])=>[key,integer(`op${i}_${key}`,max)]))}))};
}
export async function mountFmEditor(panel,invoke,onError) {
  const section=document.createElement('section');panel.append(section);
  section.innerHTML=`<h3>FM patch per MIDI channel</h3>
  <p>Six chip voices are shared across MIDI CH1–16. Apply changes the next Note On on this channel; held notes keep their current patch. AM and pan/AMS/PMS from imported voices are preserved by this form. Reload channel to see script changes. Settings survive Stop and rack disable/enable, but reset when the app closes.</p>
  <form><label>MIDI channel <select name="channel">${Array.from({length:16},(_,i)=>`<option>${i+1}</option>`).join('')}</select></label>
  <label>Algorithm (0–7) <input name="algorithm" type="number" min="0" max="7" required></label>
  <label>Feedback (0–7) <input name="feedback" type="number" min="0" max="7" required></label>
  <p>Algorithms: 0–3 serial/branched FM (OP4 output); 4 two pairs (OP2/4 output); 5–6 OP2/3/4 output; 7 four parallel outputs. Velocity attenuates output operators only.</p>
  ${Array.from({length:4},(_,i)=>`<fieldset><legend>OP${i+1}</legend>${fmFields.map(([key,label,max])=>`<label style="display:inline-block;margin:0.35em">${label}<input style="width:5em" name="op${i}_${key}" type="number" min="0" max="${max}" required></label>`).join('')}</fieldset>`).join('')}
  <button type="submit" disabled>Apply patch to channel</button><button type="button" name="reload">Reload channel</button>
  </form><p role="status"></p>`;
  const form=section.querySelector('form'),status=section.querySelector('[role="status"]');
  const apply=form.querySelector('button[type="submit"]');
  let bank=null;
  const channel=()=>Number(form.elements.namedItem('channel').value);
  function show(){if(!bank)return;const p=bank[channel()-1];
    for(const key of ['algorithm','feedback'])form.elements.namedItem(key).value=p[key];
    p.operators.forEach((op,i)=>fmFields.forEach(([key])=>form.elements.namedItem(`op${i}_${key}`).value=op[key]));
    status.textContent=`MIDI CH${channel()} patch loaded.`;
  }
  form.elements.namedItem('channel').onchange=show;
  form.elements.namedItem('reload').onclick=()=>load().catch(onError);
  async function load(){bank=await invoke('synth_patches');show();}
  form.onsubmit=async event=>{
    event.preventDefault();if(!bank)return;const ch=channel();apply.disabled=true;
    try{const patch=readFmPatch(form,bank[ch-1]);await invoke('synth_set_patch',{channel:ch,patch});
      bank[ch-1]=patch;status.textContent=`Applied to MIDI CH${ch}. Play a new note to hear the change.`;
    }catch(e){status.textContent=String(e);onError(e);}finally{apply.disabled=false;}
  };
  try{await load();apply.disabled=false;}catch(e){form.querySelector('button[type="submit"]').disabled=true;onError(e);}
}
