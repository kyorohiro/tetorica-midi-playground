import {toNativeNote} from './midi-channels.js';
import {isBinaryFile,fileBytes,filePreview} from './project-assets.js';
import {exportProject,importProject,MAX_PROJECT_BYTES} from './project-cassette.js';
import {mergeExamples,upgradeExampleTypes} from './example-migrations.js';
import {mountOutputMappings} from './output-mappings.js';
import {bundledExamples} from './example-files.js';
import {mountSynthRack} from './synth-rack.js';
import {mountKeyboard} from './keyboard-tab.js';
import {loadMonaco,createFileEditor,registerHelpers,configureJavaScript} from './editor.js';
import {createDefinitionViewer} from './editor-definitions.js';
import {registerDefinitionLinks} from './editor-definition-links.js';
import {keyData} from './keyboard.js';
import {installPerformanceShortcuts} from './performance-shortcuts.js';
import {connectionStatus,midiOutputChoices} from './connection.js';
import {leadExample} from './examples.js';
import {ensureEntry,runSource,createNewProject,projectFileName} from './project.js';
import {withGuide,canRun,isGuide} from './guide.js';
import {createProjectFiles,isInternalProjectPath} from './project-files.js';
import {mountProjectExplorer} from './project-explorer.js';
import {mountProjectGit} from './project-git.js';
import {createPlaygroundUi} from './shared/playground_ui.js';
const invoke=window.__TAURI__.core.invoke;
const $=id=>document.getElementById(id);
let auditionKeyboard=null;
const ui=createPlaygroundUi({extraTabs:["synthA","synthB","mixer"].map(name=>({name,button:$(name+"Tab"),panel:$(name+"Panel")})),...Object.fromEntries(['status','runtimeState','consoleOutput','codeTab','consoleTab','helpersTab','operatorTabButton','consolePanel','codePanel','helpersPanel','operatorPanel','keyboardTab','keyboardPanel'].map(id=>[id,$(id)])),onBottomTabChange:tab=>{auditionKeyboard?.setView(tab);$('keyboardInput').hidden=tab!=='code';}});
auditionKeyboard=mountKeyboard($('keyboardPanel'),invoke,error=>{ui.setStatus(String(error));ui.logLine(String(error));});
ui.installBottomTabHandlers();ui.setBottomTab('code');
const projectStorageKey='midi-project-v1';
let savedProject=null,recoveryRaw=null,saveBlocked=false;
try{recoveryRaw=localStorage.getItem('midi-project-recovery');savedProject=JSON.parse(localStorage.getItem(projectStorageKey));}catch{}
let projectName='my-project';
try{projectName=projectFileName(savedProject?.name??'my-project').replace(/\.midi\.cassette\.zip$/i,'');}catch{}
let files={};
try{const stored=savedProject?.files??JSON.parse(localStorage.getItem('midi-files'));if(stored && typeof stored==='object'&&!Array.isArray(stored)){const entries=Object.entries(stored).filter(([k,v])=>k.startsWith('/')&&(typeof v==='string'||(isBinaryFile(v)&&(!canRun(k)||isInternalProjectPath(k)))));if(entries.length)files=Object.fromEntries(entries);}}catch{}
let exactProjectFiles=savedProject?.exactFiles===true;
files=exactProjectFiles?upgradeExampleTypes(files,bundledExamples):mergeExamples(files,bundledExamples);
files=withGuide(exactProjectFiles?files:ensureEntry(files, leadExample));
let projectStore;
try {projectStore=createProjectFiles({files,directories:savedProject?.directories??[]});}
catch(error){
  saveBlocked=true;
  recoveryRaw=localStorage.getItem(projectStorageKey)??JSON.stringify({files});
  try{localStorage.setItem('midi-project-recovery',recoveryRaw);}catch{}
  ui.logLine('Saved project could not be restored: '+String(error)+'. Original data is retained. Menu → Export recovery data saves it as JSON. New/Import project enables saving again.');
  ui.setStatus('Saved project needs recovery. Original data kept; see Console / Menu → Export recovery data.');
  projectStore=createProjectFiles({files:ensureEntry({},leadExample)});files=withGuide(projectStore.snapshot().files);
}
$('exportRecovery').hidden=!recoveryRaw;
$('exportRecovery').onclick=()=>{const url=URL.createObjectURL(new Blob([recoveryRaw],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='midi-project-recovery.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
let runPath=canRun(savedProject?.runPath)&&!isInternalProjectPath(savedProject.runPath)&&Object.hasOwn(files,savedProject.runPath)?savedProject.runPath:Object.keys(files).find(path=>canRun(path)&&!isInternalProjectPath(path))??'';
if(!savedProject)runPath='/index.js';
if(Number.isFinite(savedProject?.bpm)&&savedProject.bpm>=1&&savedProject.bpm<=999)$('bpm').value=savedProject.bpm;
if(['internal','external'].includes(savedProject?.clockMode))$('clockMode').value=savedProject.clockMode;
function refreshRunFiles(){
  $('runFile').replaceChildren(...Object.keys(files).filter(path=>canRun(path)&&!isInternalProjectPath(path)).map(path=>{const option=document.createElement('option');option.value=path;option.textContent=path;return option;}));
  $('runFile').value=runPath;
}
refreshRunFiles();
$('runFile').onchange=()=>{runPath=$('runFile').value;openFile(runPath);};
$('bpm').addEventListener('change',()=>persist());
$('clockMode').addEventListener('change',()=>persist());
let codeEditor=null;
const pendingEdits=new Map();
let selected=Object.hasOwn(files,savedProject?.selected)&&!isInternalProjectPath(savedProject.selected)?savedProject.selected:'/README.md';
let explorer=null,gitPanel=null;
function projectSnapshot(){return {...projectStore.snapshot(),runPath,selected,bpm:Number($('bpm').value),clockMode:$('clockMode').value,exactFiles:exactProjectFiles,name:projectName};}
function persist(){if(saveBlocked)return;try{localStorage.setItem(projectStorageKey,JSON.stringify(projectSnapshot()));}catch{ui.setStatus('Local save failed. Use Export project to save your code.');}}
function openFile(path){if(!Object.hasOwn(files,path)||isInternalProjectPath(path))return;selected=path;codeEditor?.open(path,filePreview(files[path]),isGuide(path)||isBinaryFile(files[path]));$('editor').value=filePreview(files[path]);$('editor').readOnly=isGuide(path)||isBinaryFile(files[path]);refreshRunFiles();explorer?.render();persist();}
function updateFile(path,text){pendingEdits.set(path,text);try{projectStore.write(path,text);files[path]=text;pendingEdits.delete(path);persist();}catch(error){ui.logLine(String(error));ui.setStatus('Edit could not be saved: '+String(error));}}
function flushEditor(){
  if(!isGuide(selected)&&!isBinaryFile(files[selected])){
    const text=codeEditor?codeEditor.editor.getValue():$('editor').value;
    if(typeof files[selected]==='string'&&text!==files[selected])pendingEdits.set(selected,text);
  }
  // A rejected save in another FILES model must also block Git reconciliation.
  for(const [path,text] of pendingEdits){projectStore.write(path,text);files[path]=text;pendingEdits.delete(path);}
  persist();
}
function publishProjectFiles(detail={}){
  files=withGuide(projectStore.snapshot().files);
  if(detail.from&&!detail.copy){const remap=path=>path===detail.from||path.startsWith(detail.from+'/')?detail.to+path.slice(detail.from.length):path;runPath=remap(runPath);selected=remap(selected);}
  if(!canRun(runPath)||!Object.hasOwn(files,runPath)||isInternalProjectPath(runPath))runPath=Object.keys(files).find(path=>canRun(path)&&!isInternalProjectPath(path))??'';
  if(!Object.hasOwn(files,selected)||isInternalProjectPath(selected))selected='/README.md';
  codeEditor?.reconcileFiles(files,detail.from&&!detail.copy?detail:null);
  openFile(detail.open??selected);refreshRunFiles();explorer?.render();persist();
}
const projectError=error=>{ui.logLine(String(error));ui.setStatus(String(error.message??error));};
explorer=mountProjectExplorer({root:$('fileExplorerList'),newFileButton:$('newFile'),newFolderButton:$('newFolder'),actionsButton:$('fileActions'),importButton:$('importFile'),input:$('fileInput'),getStore:()=>projectStore,getFiles:()=>files,getSelected:()=>selected,onOpen:openFile,beforeChange:async()=>{flushEditor();await stop();},onChanged:detail=>{exactProjectFiles=true;publishProjectFiles(detail);},onError:projectError,onStatus:text=>ui.setStatus(text)});
$('gitSettings').addEventListener('click',()=>{$('mainMenu').open=false;});
gitPanel=mountProjectGit({button:$('gitSettings'),getStore:()=>projectStore,beforeCommand:flushEditor,onChanged:()=>publishProjectFiles(),onError:projectError,onStatus:text=>ui.setStatus(text)});
openFile(selected);
$('editor').oninput=()=>{if($('editor').readOnly)return;updateFile(selected,$('editor').value);};
$('editor').onkeydown=e=>{if($('editor').readOnly)return;if(e.key==='Tab'){e.preventDefault();const editor=$('editor');editor.setRangeText('  ',editor.selectionStart,editor.selectionEnd,'end');editor.oninput();}};
$('saveFile').onclick=()=>{$('mainMenu').open=false;const value=pendingEdits.get(selected)??files[selected];const url=URL.createObjectURL(new Blob([fileBytes(value)],{type:isBinaryFile(value)?'application/octet-stream':canRun(selected)?'text/javascript':'text/plain'}));const a=document.createElement('a');a.href=url;a.download=selected.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function downloadProject(fileName) {
  flushEditor();const bytes=exportProject(projectSnapshot());
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
  const restoredFiles=upgradeExampleTypes(project.files,bundledExamples);
  const nextStore=createProjectFiles({files:restoredFiles,directories:project.directories??[]});
  localStorage.setItem(projectStorageKey,JSON.stringify({...project,files:restoredFiles,exactFiles:true,name}));
  saveBlocked=false;
  gitPanel?.invalidate();projectStore=nextStore;pendingEdits.clear();
  projectName=name;exactProjectFiles=true;files=withGuide(restoredFiles);runPath=project.runPath;
  $('bpm').value=project.bpm;$('clockMode').value=project.clockMode;
  explorer?.reset();codeEditor?.replaceFiles(files);
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
// Safari does not focus buttons on click; this button is the script's key target.
keyboardPad.addEventListener('click',()=>keyboardPad.focus());
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
  flushEditor();
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
      try{await enqueueMidi(()=>invoke(data.type==='midi'?'send_midi':'play_midi_note',{...(data.type==='note'?toNativeNote(data.payload):data.payload),runId}));current.postMessage({type:'reply',id:data.id});}
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
  current.postMessage({type:'run',code,bpm,runId,externalClock,path:target,files:performanceFiles(),outputMappings:outputMappings.snapshot()});
}
function performanceFiles(){return Object.fromEntries(Object.entries(files).filter(([path])=>!isInternalProjectPath(path)));}
$('clockMode').onchange=()=>run(stop);
$('applyButton').onclick=()=>run(async()=>{if(!worker)throw new Error('Press Run first');flushEditor();worker.postMessage({type:'update',code:runSource(files,runPath),path:runPath,files:performanceFiles()});ui.setStatus('Applying '+runPath);});
$('runButton').onclick=()=>run(start);$('stopButton').onclick=()=>run(stop);
installPerformanceShortcuts({target:document,hasOpenDialog:()=>Boolean(document.querySelector('dialog[open]')),onRun:()=>run(start),onStop:()=>run(stop)});
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
  const container=document.createElement('div');container.id='monacoEditor';
  $('editor').after(container);
  let definitions=null,links=null,helpers=null;
  try {
    codeEditor=createFileEditor(monaco,container,updateFile);
    codeEditor.syncFiles(files);
    codeEditor.open(selected,filePreview(files[selected]),isGuide(selected)||isBinaryFile(files[selected]));
    try {
      definitions=createDefinitionViewer(monaco,codeEditor.editor,{
        openProjectFile:openFile,isProjectFile:path=>Object.hasOwn(files,path),
      });
      links=registerDefinitionLinks(monaco,definitions);
    } catch(error) {links?.dispose();definitions?.dispose();links=null;definitions=null;ui.logLine('Definition viewer unavailable: '+String(error));}
    helpers=registerHelpers(monaco,()=>Object.keys(files).filter(path=>!isInternalProjectPath(path)),links);
    codeEditor.editor.onDidDispose(()=>{helpers?.dispose();links?.dispose();definitions?.dispose();});
    $('editor').hidden=true;
  } catch(error) {helpers?.dispose();links?.dispose();definitions?.dispose();codeEditor?.dispose();container.remove();codeEditor=null;throw error;}
}).catch(error=>ui.logLine(String(error)));
