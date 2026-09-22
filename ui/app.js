import {isBinaryFile,binaryFile,fileBytes,filePreview} from './project-assets.js';
import {exportProject,importProject,MAX_PROJECT_BYTES} from './project-cassette.js';
import {mergeExamples} from './example-migrations.js';
import {mountOutputMappings} from './output-mappings.js';
import {bundledExamples} from './example-files.js';
import {mountSynthRack} from './synth-rack.js';
import {mountKeyboard} from './keyboard-tab.js';
import {loadMonaco,createFileEditor,registerHelpers,configureJavaScript} from './editor.js';
import {keyData} from './keyboard.js';
import {connectionStatus,midiOutputChoices} from './connection.js';
import {leadExample} from './examples.js';
import {ensureEntry,runSource,createNewProject,projectFileName} from './project.js';
import {withGuide,canRun,isGuide} from './guide.js';
import {createPlaygroundUi} from './shared/playground_ui.js';
import {renderFileTree} from './shared/playground_file_tree.js';
const invoke=window.__TAURI__.core.invoke;
const $=id=>document.getElementById(id);
let auditionKeyboard=null;
const ui=createPlaygroundUi({extraTabs:["synthA","synthB","mixer"].map(name=>({name,button:$(name+"Tab"),panel:$(name+"Panel")})),...Object.fromEntries(['status','runtimeState','consoleOutput','codeTab','consoleTab','helpersTab','operatorTabButton','consolePanel','codePanel','helpersPanel','operatorPanel','keyboardTab','keyboardPanel'].map(id=>[id,$(id)])),onBottomTabChange:tab=>auditionKeyboard?.setView(tab)});
auditionKeyboard=mountKeyboard($('keyboardPanel'),invoke,error=>{ui.setStatus(String(error));ui.logLine(String(error));});
ui.installBottomTabHandlers();ui.setBottomTab('code');
const projectStorageKey='midi-project-v1';
let savedProject=null;
try{savedProject=JSON.parse(localStorage.getItem(projectStorageKey));}catch{}
let projectName='my-project';
try{projectName=projectFileName(savedProject?.name??'my-project').replace(/\.midi\.cassette\.zip$/i,'');}catch{}
let files={};
try{const stored=savedProject?.files??JSON.parse(localStorage.getItem('midi-files'));if(stored && typeof stored==='object'&&!Array.isArray(stored)){const entries=Object.entries(stored).filter(([k,v])=>k.startsWith('/')&&(typeof v==='string'||(isBinaryFile(v)&&!canRun(k))));if(entries.length)files=Object.fromEntries(entries);}}catch{}
let exactProjectFiles=savedProject?.exactFiles===true;
if(!exactProjectFiles)files=mergeExamples(files,bundledExamples);
files=withGuide(exactProjectFiles?files:ensureEntry(files, leadExample));
let runPath=canRun(savedProject?.runPath)&&Object.hasOwn(files,savedProject.runPath)?savedProject.runPath:Object.keys(files).find(canRun)??'/index.js';
if(!savedProject)runPath='/index.js';
if(Number.isFinite(savedProject?.bpm)&&savedProject.bpm>=1&&savedProject.bpm<=999)$('bpm').value=savedProject.bpm;
if(['internal','external'].includes(savedProject?.clockMode))$('clockMode').value=savedProject.clockMode;
function refreshRunFiles(){
  $('runFile').replaceChildren(...Object.keys(files).filter(canRun).map(path=>{const option=document.createElement('option');option.value=path;option.textContent=path;return option;}));
  $('runFile').value=runPath;
}
refreshRunFiles();
$('runFile').onchange=()=>{runPath=$('runFile').value;persist();};
$('bpm').addEventListener('change',()=>persist());
$('clockMode').addEventListener('change',()=>persist());
let codeEditor=null;
let selected=Object.hasOwn(files,savedProject?.selected)?savedProject.selected:'/README.md';const expanded=new Map();
function projectSnapshot(){return {files:Object.fromEntries(Object.entries(files).filter(([path])=>!isGuide(path))),runPath,selected,bpm:Number($('bpm').value),clockMode:$('clockMode').value,exactFiles:exactProjectFiles,name:projectName};}
function persist(){try{localStorage.setItem(projectStorageKey,JSON.stringify(projectSnapshot()));}catch{ui.setStatus('Local save failed. Use Export project to save your code.');}}
function openFile(path){selected=path;codeEditor?.open(path,filePreview(files[path]),isGuide(path)||isBinaryFile(files[path]));$('editor').value=filePreview(files[path]);$('fileTitle').textContent=path;$('editor').readOnly=isGuide(path)||isBinaryFile(files[path]);refreshRunFiles();renderFileTree($('fileExplorerList'),Object.keys(files).map(path=>({path})),{selectedPath:selected,expanded,onOpen:openFile});persist();}
openFile(selected);
$('editor').oninput=()=>{if($('editor').readOnly)return;files[selected]=$('editor').value;persist();};
$('editor').onkeydown=e=>{if($('editor').readOnly)return;if(e.key==='Tab'){e.preventDefault();const editor=$('editor');editor.setRangeText('  ',editor.selectionStart,editor.selectionEnd,'end');editor.oninput();}};
$('newFile').onclick=()=>{let n=1;while(files[`/untitled-${n}.js`]!==undefined)n++;const path=`/untitled-${n}.js`;files[path]='// MIDI Playground\n';persist();openFile(path);};
$('importFile').onclick=()=>$('fileInput').click();
$('fileInput').onchange=()=>run(async()=>{const file=$('fileInput').files[0];if(!file)return;if(file.size>1000000)throw new Error('File exceeds 1 MB');let path='/'+file.name;let n=1;while(files[path]!==undefined)path=`/import-${n++}-${file.name}`;files[path]=/\.(tfi|vgi)$/i.test(path)?binaryFile(new Uint8Array(await file.arrayBuffer())):await file.text();persist();openFile(path);$('fileInput').value='';});
$('saveFile').onclick=()=>{$('mainMenu').open=false;const url=URL.createObjectURL(new Blob([fileBytes(files[selected])],{type:isBinaryFile(files[selected])?'application/octet-stream':canRun(selected)?'text/javascript':'text/plain'}));const a=document.createElement('a');a.href=url;a.download=selected.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function downloadProject(fileName) {
  const bytes=exportProject(projectSnapshot());
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));
  const a=document.createElement('a');a.href=url;
  a.download=fileName;
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function showExportProject(){
  $('mainMenu').open=false;$('projectExportName').value=projectName;
  $('projectExportError').textContent='';$('projectExportDialog').showModal();
  $('projectExportName').focus();$('projectExportName').select();
}
$('exportProject').onclick=showExportProject;
$('exportBeforeImport').onclick=showExportProject;
$('exportBeforeNew').onclick=showExportProject;
$('cancelProjectExport').onclick=()=>$('projectExportDialog').close();
$('projectExportForm').onsubmit=event=>{
  event.preventDefault();
  try {
    const filename=projectFileName($('projectExportName').value);
    downloadProject(filename);projectName=filename.replace(/\.midi\.cassette\.zip$/i,'');persist();
    $('projectExportDialog').close();
  }catch(error){$('projectExportError').textContent=String(error.message??error);}
};
// Match the original Playground's dropdown; keep it accessible in expanded mode too.
document.addEventListener('click',event=>{if(!$('mainMenu').contains(event.target))$('mainMenu').open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('mainMenu').open){$('mainMenu').open=false;$('mainMenu').querySelector('summary').focus();}});
async function replaceProject(project,name){
  await stop();
  localStorage.setItem(projectStorageKey,JSON.stringify({...project,exactFiles:true,name}));
  projectName=name;exactProjectFiles=true;files=withGuide(project.files);runPath=project.runPath;
  $('bpm').value=project.bpm;$('clockMode').value=project.clockMode;
  expanded.clear();codeEditor?.replaceFiles(files);
  openFile(project.selected);ui.clearConsole();ui.setBottomTab('code');
}
$('newProject').onclick=()=>{$('mainMenu').open=false;$('newProjectError').textContent='';$('newProjectDialog').showModal();};
$('cancelNewProject').onclick=()=>$('newProjectDialog').close();
$('newProjectDialog').addEventListener('cancel',event=>{if($('confirmNewProject').disabled)event.preventDefault();});
$('confirmNewProject').onclick=async()=>{
  $('confirmNewProject').disabled=true;$('cancelNewProject').disabled=true;$('exportBeforeNew').disabled=true;
  try {
    await replaceProject(createNewProject(bundledExamples),'my-project');
    $('newProjectDialog').close();ui.setStatus('New project ready.');
  }catch(error){$('newProjectError').textContent=String(error.message??error);}
  finally{$('confirmNewProject').disabled=false;$('cancelNewProject').disabled=false;$('exportBeforeNew').disabled=false;}
};
let pendingProject=null,pendingProjectName='my-project';
$('importProject').onclick=()=>{$('mainMenu').open=false;$('projectInput').click();};
$('projectInput').onchange=()=>run(async()=>{
  const file=$('projectInput').files[0];if(!file)return;
  try {
    if(file.size>MAX_PROJECT_BYTES)throw Error('Project ZIP exceeds 16 MiB');
    pendingProject=importProject(new Uint8Array(await file.arrayBuffer()));
    try{pendingProjectName=projectFileName(file.name).replace(/\.midi\.cassette\.zip$/i,'');}catch{pendingProjectName='my-project';}
    $('projectImportError').textContent='';
    $('projectImportSummary').textContent=`${file.name}: ${Object.keys(pendingProject.files).length} files · Run file: ${pendingProject.runPath} · BPM: ${pendingProject.bpm} · ${pendingProject.clockMode} clock`;
    $('projectImportDialog').showModal();
  } finally {$('projectInput').value='';}
});
$('cancelProjectImport').onclick=()=>{$('projectImportDialog').close();};
$('projectImportDialog').addEventListener('close',()=>{pendingProject=null;});
$('projectImportDialog').addEventListener('cancel',event=>{if($('confirmProjectImport').disabled)event.preventDefault();});
$('confirmProjectImport').onclick=()=>run(async()=>{
  if(!pendingProject)return;
  const project=pendingProject;
  $('confirmProjectImport').disabled=true;$('cancelProjectImport').disabled=true;
  try {
    await replaceProject(project,pendingProjectName);
    $('projectImportDialog').close();
    ui.setStatus('Project imported. Press Run to play.');
  } catch(error){$('projectImportError').textContent=String(error.message??error);}
  finally {$('confirmProjectImport').disabled=false;$('cancelProjectImport').disabled=false;}
});
$('expandButton').onclick=()=>{const expanded=document.body.classList.toggle('expanded');$('mainMenu').open=false;if(expanded)$('runButton').before($('mainMenu'));else $('mainMenuHome').before($('mainMenu'));$('expandButton').setAttribute('aria-pressed',String(expanded));$('expandButton').textContent=expanded?'Collapse':'Expand';};
$('midiSettings').onclick=()=>ui.setBottomTab('operator');
$('midiConnection').onclick=()=>ui.setBottomTab('operator');
function showConnection(snapshot){const {state,text}=connectionStatus(snapshot);const button=$('midiConnection');button.dataset.state=state;if(button.textContent!==text)button.textContent=text;button.title=text+' · Open MIDI settings. Port connection does not confirm DAW audio output.';const status=$('outputStatus');if(status.textContent!==text)status.textContent=text;status.dataset.state=state;$('scriptOutputStatus').textContent=`Script outputs: ${snapshot?.script_output_count??0} additional connection(s)`;}
$('clearConsole').onclick=()=>ui.clearConsole();
async function run(fn){try{await fn();}catch(e){ui.setStatus('Error — see Console: '+String(e));ui.logLine(String(e));}}
let worker=null,epoch=0,activeRunId=null,inputGeneration=0;
const pressedKeys=new Map();
const keyboardPad=$('keyboardInput');
for(const type of ['keydown','keyup'])keyboardPad.addEventListener(type,event=>{
  if(event.metaKey||event.ctrlKey||event.altKey||event.key==='Tab'||event.key==='Escape')return;
  if(!worker||event.repeat)return;
  const data=keyData(event);
  if(type==='keydown')pressedKeys.set(event.code,data);
  else {if(!pressedKeys.has(event.code))return;pressedKeys.delete(event.code);}
  event.preventDefault();worker.postMessage({type:'keyboard',event:data});
});
function releaseKeys(){
  for(const data of pressedKeys.values())worker?.postMessage({type:'keyboard',event:{...data,type:'keyup',repeat:false}});
  pressedKeys.clear();
}
keyboardPad.addEventListener('blur',releaseKeys);
window.addEventListener('blur',releaseKeys);
async function stop(){await auditionKeyboard?.releaseAll();activeRunId=null;pressedKeys.clear();++epoch;worker?.terminate();worker=null;$('follow').checked=false;ui.setRuntimeState('Stopped');await invoke('stop_notes');await invoke('synth_panic');}
async function start(){
  const target=runPath;
  const code=runSource(files,target);
  const ticket=epoch+1;await stop();if(ticket!==epoch)return;const bpm=Number($('bpm').value);
  if(!Number.isFinite(bpm)||bpm<=0||bpm>999)throw new Error('BPM must be >0 and ≤999');
  const externalClock=$('clockMode').value==='external';
  const runId=await invoke('begin_run',{externalClock});if(ticket!==epoch)return;
  activeRunId=runId;
  const current=new Worker('./runner.js',{type:'module'});worker=current;
  ui.setRuntimeState('Running');ui.setStatus(`Running ${target}`);
  let inFlight=0,logs=0;
  let midiQueue=Promise.resolve();
  const enqueueMidi=fn=>{const task=midiQueue.then(()=>{if(current!==worker||ticket!==epoch)return;return fn();});midiQueue=task.catch(()=>{});return task;};
  current.onmessage=async({data})=>{
    if(current!==worker||ticket!==epoch)return;
    if(data.type==='waiting-clock'){ui.setRuntimeState('Waiting');ui.setStatus('Waiting for external MIDI Start / Continue.');}
    else if(data.type==='enable-chip'||data.type==='output'){
      try {
        const value=await enqueueMidi(()=>invoke(data.type==='enable-chip'?'enable_sound_chip':'script_output',{...data.payload,runId}));
        if(current===worker&&ticket===epoch)current.postMessage({type:'reply',id:data.id,value});
        if(data.type==='enable-chip')await refresh();
      }catch(e){if(current===worker)current.postMessage({type:'reply',id:data.id,error:String(e)});}
    }
    else if(data.type==='note'||data.type==='midi'){
      if(++inFlight>64){await run(stop);ui.setStatus('Too many concurrent notes');return;}
      try{await enqueueMidi(()=>invoke(data.type==='midi'?'send_midi':'play_midi_note',{...data.payload,runId}));current.postMessage({type:'reply',id:data.id});}
      catch(e){if(current===worker)current.postMessage({type:'reply',id:data.id,error:String(e)});}
      finally{inFlight--;}
    }else if(data.type==='release'){
      await run(()=>enqueueMidi(()=>invoke('release_loop_notes',{runId,owner:data.owner})));
    }else if(data.type==='log'){if(logs++<1000)ui.logLine(String(data.text).slice(0,4000));}
    else if(data.type==='error'){await run(stop);ui.logLine(data.text);ui.setStatus('Error — see Console: '+data.text);}
    else if(data.type==='done'){ui.setRuntimeState('Finished');ui.setStatus('Finished. Press Stop to release any remaining notes.');}
    else if(data.type==='listening'){ui.setRuntimeState('Listening');ui.setStatus('Click Keyboard input, then press your script’s keys.');}
    else if(data.type==='looping'){ui.setRuntimeState('Looping');}
  };
  current.onerror=e=>run(async()=>{await stop();ui.setStatus('Error — see Console: '+e.message);ui.logLine(e.message);});
  current.postMessage({type:'run',code,bpm,runId,externalClock,path:target,files:{...files},outputMappings:outputMappings.snapshot()});
}
$('clockMode').onchange=()=>run(stop);
$('applyButton').onclick=()=>run(async()=>{if(!worker)throw new Error('Press Run first');worker.postMessage({type:'update',code:runSource(files,runPath),path:runPath,files:{...files}});ui.setStatus('Applying '+runPath);});
$('runButton').onclick=()=>run(start);$('stopButton').onclick=()=>run(stop);
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!document.querySelector('dialog[open]')){e.preventDefault();run(start);}if(e.shiftKey&&e.key==='Escape'){e.preventDefault();run(stop);}},true);
async function refresh(){const ports=await invoke('ports');outputMappings.refresh(ports.output);ports.output=midiOutputChoices(ports.output);for(const direction of ['input','output']){const previous=$(direction).value;const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=ports[direction].length?'Choose a MIDI port…':'No MIDI ports found';$(direction).replaceChildren(placeholder,...ports[direction].map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;return o;}));if(ports[direction].some(p=>p.id===previous))$(direction).value=previous;}}
const outputMappings=mountOutputMappings($('outputMappings'),{storage:localStorage,beforeChange:stop,onError:error=>{ui.logLine(String(error));ui.setStatus(String(error));}});
$('refresh').onclick=()=>run(refresh);
const synthRack=mountSynthRack(invoke,refresh,error=>{ui.logLine(String(error));ui.setStatus(String(error));},stop);
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
    if(direction==='Input') {
      const generation=++inputGeneration;
      const clockEvents=new window.__TAURI__.core.Channel();
      clockEvents.onmessage=event=>{
        if(generation!==inputGeneration||event.runId!==activeRunId)return;
        worker?.postMessage({type:'clock',event});
      };
      await invoke('connect_input',{id,clockEvents});
    } else {
      await invoke('connect_output',{id});
      if(id.startsWith('internal:')){await synthRack.sync();await refresh();}
    }
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

// Keep the textarea usable while the locally bundled editor loads or if it fails.
loadMonaco().then(monaco=>{
  configureJavaScript(monaco);
  registerHelpers(monaco,()=>Object.keys(files));
  const container=document.createElement('div');container.id='monacoEditor';
  $('editor').after(container);
  try {
    codeEditor=createFileEditor(monaco,container,(path,text)=>{files[path]=text;persist();});
    codeEditor.syncFiles(files);
    codeEditor.open(selected,filePreview(files[selected]),isGuide(selected)||isBinaryFile(files[selected]));
    $('editor').hidden=true;
  } catch(error) {container.remove();codeEditor=null;throw error;}
}).catch(error=>ui.logLine(String(error)));
