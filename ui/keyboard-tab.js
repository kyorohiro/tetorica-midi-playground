import {createAudition} from './audition.js';
import {createFretboardState,createFretboardLayout,buildKeyboard,renderFretboardControls,setInstrument,setFretPosition,setStringWindowIndex,findLayoutEntry} from './shared/synth_keyboard.js';
export function mountKeyboard(root,invoke,onError) {
  const state=createFretboardState(), held=new Map(),audio=createAudition(invoke,onError);
  let layout,enabled=false;
  root.innerHTML=`<p>Play through the selected MIDI output. No Run or script required. Hold keys to sustain; release to stop.</p><div class="keyboard-tools"><label>MIDI channel <select id="auditionChannel"></select></label><label>Velocity <input id="auditionVelocity" type="number" min="1" max="127" value="90"></label><button id="auditionStop">Release notes</button></div><div class="keyboard-tools" id="auditionInstrument"></div><div class="keyboard-tools" id="auditionPosition"></div><p><span id="auditionFret"></span> <span id="auditionStrings"></span></p><div class="playground-keyboard" id="auditionKeys"></div><p>Use the number / QWERTY / ASDF / ZXCV rows shown above while this tab is open. Instrument selects the fingering layout, not the DAW sound.</p>`;
  const $=id=>root.querySelector('#'+id),keys=$('auditionKeys');
  for(let i=1;i<=16;i++){const o=document.createElement('option');o.value=i;o.textContent=i;$('auditionChannel').append(o);}
  function press(id,entry,button){if(!enabled||held.has(id))return;held.set(id,button);button?.classList.add('is-active');audio.press(id,entry.midi,Number($('auditionChannel').value),Number($('auditionVelocity').value));}
  function release(id){const button=held.get(id);held.delete(id);if(![...held.values()].includes(button))button?.classList.remove('is-active');audio.release(id);}
  function releaseAll(){for(const button of held.values())button?.classList.remove('is-active');held.clear();return audio.releaseAll();}
  function rebuild(){releaseAll();layout=createFretboardLayout({state,referenceMidi:62,referenceBlock:4,referenceFnum:553});
    buildKeyboard({root:keys,rowDefs:layout.rowDefs,layoutEntries:layout.entries,onPointerDown:(e,entry,b)=>{b.setPointerCapture(e.pointerId);press('pointer:'+e.pointerId,entry,b);},onPointerUp:e=>release('pointer:'+e.pointerId),onPointerCancel:e=>release('pointer:'+e.pointerId)});
    keys.querySelectorAll('.key').forEach(b=>{b.querySelector('small')?.remove();b.addEventListener('lostpointercapture',e=>release('pointer:'+e.pointerId));});
    renderFretboardControls({instrumentRoot:$('auditionInstrument'),positionRoot:$('auditionPosition'),fretDisplayRoot:$('auditionFret'),stringDisplayRoot:$('auditionStrings'),state,onInstrumentChange:v=>{setInstrument(state,v);rebuild();},onPositionPresetSelect:v=>{setFretPosition(state,v);rebuild();},onStringWindowChange:v=>{setStringWindowIndex(state,v);rebuild();}});
  }
  window.addEventListener('keydown',e=>{if(!enabled||e.repeat||e.ctrlKey||e.metaKey||e.altKey||e.target?.isContentEditable||/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName||''))return;const entry=findLayoutEntry(layout.entries,e.key);if(entry){e.preventDefault();press('key:'+e.code,entry,keys.querySelector(`[data-key="${CSS.escape(entry.key)}"]`));}});
  window.addEventListener('keyup',e=>release('key:'+e.code));window.addEventListener('blur',releaseAll);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAll();});
  $('auditionChannel').onchange=releaseAll;$('auditionStop').onclick=releaseAll;
  rebuild();return {setView(tab){enabled=tab==='keyboard';if(!enabled)releaseAll();},releaseAll};
}
