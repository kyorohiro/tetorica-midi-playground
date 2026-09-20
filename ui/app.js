import {connectionStatus} from './connection.js';
import {leadExample} from './examples.js';
import {ensureEntry,runSource} from './project.js';
import {withGuide,canRun,isGuide} from './guide.js';
import {createPlaygroundUi} from './shared/playground_ui.js';
import {renderFileTree} from './shared/playground_file_tree.js';
const invoke=window.__TAURI__.core.invoke;
const $=id=>document.getElementById(id);
const ui=createPlaygroundUi(Object.fromEntries(['status','runtimeState','consoleOutput','codeTab','consoleTab','helpersTab','operatorTabButton','consolePanel','codePanel','helpersPanel','operatorPanel'].map(id=>[id,$(id)])));
ui.installBottomTabHandlers();ui.setBottomTab('code');
const defaults={'/melody.js':'setBpm(120);\nfor (const note of ["C4", "E4", "G4", "C5"]) {\n  await play(note, { duration: 0.5 });\n}\nlog("Done");\n','/loop.js':'setBpm(120);\nliveLoop("melody", async () => {\n  await play(choose(["C4", "E4", "G4"]), { duration: 0.5 });\n  await beat(0.5);\n});\n'};
let files={...defaults};
try{const stored=JSON.parse(localStorage.getItem('midi-files'));if(stored && typeof stored==='object'&&!Array.isArray(stored)){const entries=Object.entries(stored).filter(([k,v])=>k.startsWith('/')&&typeof v==='string');if(entries.length)files=Object.fromEntries(entries);}}catch{}
if(!Object.hasOwn(files,'/lead.js')) files['/lead.js']=leadExample;
files=withGuide(ensureEntry(files, leadExample));
let runPath="/index.js";
function refreshRunFiles(){
  $('runFile').replaceChildren(...Object.keys(files).filter(canRun).map(path=>{const option=document.createElement('option');option.value=path;option.textContent=path;return option;}));
  $('runFile').value=runPath;
}
refreshRunFiles();
$('runFile').onchange=()=>{runPath=$('runFile').value;};
let selected="/README.md";const expanded=new Map();
function persist(){try{localStorage.setItem('midi-files',JSON.stringify(files));}catch{ui.setStatus('Local save failed. Use Export JS to save your code.');}}
function openFile(path){selected=path;$('editor').value=files[path];$('fileTitle').textContent=path;$('editor').readOnly=isGuide(path);refreshRunFiles();renderFileTree($('fileExplorerList'),Object.keys(files).map(path=>({path})),{selectedPath:selected,expanded,onOpen:openFile});}
openFile(selected);
$('editor').oninput=()=>{if($('editor').readOnly)return;files[selected]=$('editor').value;persist();};
$('editor').onkeydown=e=>{if($('editor').readOnly)return;if(e.key==='Tab'){e.preventDefault();const editor=$('editor');editor.setRangeText('  ',editor.selectionStart,editor.selectionEnd,'end');editor.oninput();}};
$('newFile').onclick=()=>{let n=1;while(files[`/untitled-${n}.js`]!==undefined)n++;const path=`/untitled-${n}.js`;files[path]='// MIDI Playground\n';persist();openFile(path);};
$('importFile').onclick=()=>$('fileInput').click();
$('fileInput').onchange=()=>run(async()=>{const file=$('fileInput').files[0];if(!file)return;if(file.size>1000000)throw new Error('File exceeds 1 MB');let path='/'+file.name;let n=1;while(files[path]!==undefined)path=`/import-${n++}-${file.name}`;files[path]=await file.text();persist();openFile(path);$('fileInput').value='';});
$('saveFile').onclick=()=>{const url=URL.createObjectURL(new Blob([files[selected]],{type:canRun(selected)?'text/javascript':'text/plain'}));const a=document.createElement('a');a.href=url;a.download=selected.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('expandButton').onclick=()=>{const expanded=document.body.classList.toggle('expanded');$('expandButton').setAttribute('aria-pressed',String(expanded));$('expandButton').textContent=expanded?'Collapse':'Expand';};
$('midiSettings').onclick=()=>ui.setBottomTab('operator');
$('midiConnection').onclick=()=>ui.setBottomTab('operator');
function showConnection(snapshot){const {state,text}=connectionStatus(snapshot);const button=$('midiConnection');button.dataset.state=state;if(button.textContent!==text)button.textContent=text;button.title=text+' · Open MIDI settings. Port connection does not confirm DAW audio output.';const status=$('outputStatus');if(status.textContent!==text)status.textContent=text;status.dataset.state=state;}
$('clearConsole').onclick=()=>ui.clearConsole();
async function run(fn){try{await fn();}catch(e){ui.setStatus(String(e));ui.logLine(String(e));}}
let worker=null,epoch=0;
async function stop(){++epoch;worker?.terminate();worker=null;$('follow').checked=false;ui.setRuntimeState('Stopped');await invoke('stop_notes');}
async function start(){
  const target=runPath;
  const code=runSource(files,target);
  const ticket=epoch+1;await stop();if(ticket!==epoch)return;const bpm=Number($('bpm').value);
  if(!Number.isFinite(bpm)||bpm<=0||bpm>999)throw new Error('BPM must be >0 and ≤999');
  const runId=await invoke('begin_run');if(ticket!==epoch)return;
  const current=new Worker('./runner.js',{type:'module'});worker=current;
  ui.setRuntimeState('Running');ui.setStatus(`Running ${target}`);
  let inFlight=0,logs=0;
  current.onmessage=async({data})=>{
    if(current!==worker||ticket!==epoch)return;
    if(data.type==='note'){
      if(++inFlight>64){await run(stop);ui.setStatus('Too many concurrent notes');return;}
      try{await invoke('play_midi_note',{...data.payload,runId});current.postMessage({type:'reply',id:data.id});}
      catch(e){if(current===worker)current.postMessage({type:'reply',id:data.id,error:String(e)});}
      finally{inFlight--;}
    }else if(data.type==='log'){if(logs++<1000)ui.logLine(String(data.text).slice(0,4000));}
    else if(data.type==='error'){await run(stop);ui.logLine(data.text);ui.setStatus(data.text);ui.setBottomTab('console');}
    else if(data.type==='done'){ui.setRuntimeState('Finished');ui.setStatus('Finished. Press Stop to release any remaining notes.');}
    else if(data.type==='looping'){ui.setRuntimeState('Looping');}
  };
  current.onerror=e=>run(async()=>{await stop();ui.setStatus(e.message);ui.logLine(e.message);});
  current.postMessage({type:'run',code,bpm});
}
$('runButton').onclick=()=>run(start);$('stopButton').onclick=()=>run(stop);
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();run(start);}if(e.shiftKey&&e.key==='Escape'){e.preventDefault();run(stop);}});
async function refresh(){const ports=await invoke('ports');for(const direction of ['input','output']){const previous=$(direction).value;const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=ports[direction].length?'Choose a MIDI port…':'No MIDI ports found';$(direction).replaceChildren(placeholder,...ports[direction].map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;return o;}));if(ports[direction].some(p=>p.id===previous))$(direction).value=previous;}}
$('refresh').onclick=()=>run(refresh);
let outputConnecting=false;
async function connectPort(direction){
  const select=$(direction.toLowerCase()), id=select.value;
  if(!id){ui.setStatus('Choose a MIDI port first.');return;}
  if(direction==='Output'&&outputConnecting)return;
  if(direction==='Output')outputConnecting=true;
  select.disabled=true;$('connect'+direction).disabled=true;
  try{
    ui.setStatus(`Connecting ${direction.toLowerCase()}…`);
    await stop();
    await invoke('connect_'+direction.toLowerCase(),{id});
    showConnection(await invoke('snapshot'));
    ui.setStatus(`${direction} connected`);
  }finally{
    select.disabled=false;$('connect'+direction).disabled=false;
    if(direction==='Output')outputConnecting=false;
  }
}
for(const direction of ['Input','Output'])$('connect'+direction).onclick=()=>run(()=>connectPort(direction));
$('output').onchange=()=>run(()=>connectPort('Output'));
$('note').onclick=()=>run(async()=>{await stop();await invoke('play_note');});
$('panic').onclick=()=>run(stop);
$('disconnect').onclick=()=>run(async()=>{await stop();await invoke('disconnect');ui.setStatus('Disconnected');});
$('follow').onchange=()=>run(async()=>{const enabled=$('follow').checked;await stop();await invoke('set_follow',{enabled});$('follow').checked=enabled;});
let polling=false;
setInterval(async()=>{if(polling)return;polling=true;try{const snapshot=await invoke('snapshot');$('clock').textContent=JSON.stringify(snapshot,null,2);showConnection(snapshot);}catch(e){showConnection(null);ui.setStatus(String(e));}finally{polling=false;}},100);
run(refresh);
