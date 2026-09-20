// UI controls only. MIDI, ymfm, resampling and mixing live in the native process.
export function mountSynthRack(invoke,refresh,onError) {
  const $=id=>document.getElementById(id);
  const volumes=[0.7,0.7], pans=[0,0],muted=[false,false];let master=0.25,busy=false;
  for(const [i,letter] of ['A','B'].entries()){
    $('synth'+letter+'Panel').innerHTML=`<h2>YM2612 ${letter}</h2><p>MIDI output: <strong>Tetorica YM2612 ${letter}</strong></p><p>Enable the native synth in MIDI connections, then select this port. Play the Keyboard tab or Run your script.</p><p>Fixed FM patch · MIDI CH 1–16 · 6 voices shared across channels. Oldest held voice is replaced when all six are in use.</p><p id="synth${letter}State">Disabled</p><p>CH activity indicates held notes, not release tails. MIDI CC 120/123 and Note On velocity 0 are supported. Preset editing, sustain and pitch bend are not yet supported.</p>`;
  }
  $('mixerPanel').innerHTML=`<h2>Native Mixer</h2><p>Enable YM2612 A / B and select a MIDI output in MIDI connections.</p>${['A','B'].map((l,i)=>`<div><strong>YM2612 ${l}</strong> <label>Volume <input id="rackVolume${i}" type="range" min="0" max="1" step="0.01" value="0.7"></label> <label>Pan <input id="rackPan${i}" type="range" min="-1" max="1" step="0.01" value="0"></label> <label><input id="rackMute${i}" type="checkbox"> Mute</label></div>`).join('')}<p><label>Master <input id="rackMaster" type="range" min="0" max="1" step="0.01" value="0.25"></label> <button id="rackPanic">Panic — all internal notes</button></p><details><summary>ymfm license (BSD-3-Clause)</summary><pre id="ymfmLicense"></pre></details>`;
  fetch('./ymfm-LICENSE.txt').then(r=>{if(!r.ok)throw new Error('License unavailable');return r.text();}).then(text=>$('ymfmLicense').textContent=text).catch(onError);
  async function mix(){if(!$('synthEnable').checked)return;await invoke('synth_mix',{volume:volumes.map((v,i)=>muted[i]?0:v),pan:pans,master});}
  $('synthEnable').onchange=async()=>{if(busy)return;busy=true;$('synthEnable').disabled=true;
    try{await invoke('synth_enable',{enabled:$('synthEnable').checked});await mix();await refresh();}
    catch(e){onError(e);}finally{busy=false;$('synthEnable').disabled=false;await poll();}
  };
  for(let i=0;i<2;i++){
    $('rackVolume'+i).oninput=e=>{volumes[i]=Number(e.target.value);mix().catch(onError);};
    $('rackPan'+i).oninput=e=>{pans[i]=Number(e.target.value);mix().catch(onError);};
    $('rackMute'+i).onchange=e=>{muted[i]=e.target.checked;mix().catch(onError);};
  }
  $('rackMaster').oninput=e=>{master=Number(e.target.value);mix().catch(onError);};
  $('rackPanic').onclick=()=>invoke('synth_panic').catch(onError);
  let polling=false;
  async function poll(){if(polling)return;polling=true;try{
    const s=await invoke('synth_status');if(!busy)$('synthEnable').checked=s.enabled;
    $('rackStatus').textContent=s.error?'Audio/queue error: notes were reset. Disable and enable to retry.':s.enabled?'Enabled · native audio output':'Disabled';
    for(const [i,l] of ['A','B'].entries()){
      const channels=Array.from({length:16},(_,n)=>n+1).filter(ch=>s.active_channels[i]&(1<<(ch-1)));
      $('synth'+l+'State').textContent=!s.enabled?'Disabled':channels.length?'Active MIDI CH: '+channels.join(', '):'Ready · no held notes';
    }
  }catch(e){onError(e);}finally{polling=false;}}
  setInterval(poll,200);poll();
}
