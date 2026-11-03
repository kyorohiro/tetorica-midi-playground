import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildFileTree, renderFileTree} from '../ui/shared/playground_file_tree.js';
import {mountProjectExplorer, createExplorerClipboard} from '../ui/project-explorer.js';
import {createProjectFiles} from '../ui/project-files.js';

test('FILES tree keeps explicitly empty folders alongside inferred folders and sorts folders first', () => {
  const tree = buildFileTree([
    {path: '/z.js'}, {path: '/empty/deep', directory: true}, {path: '/parts/voice.tfi'},
    {path: '/parts', directory: true}, {path: '/empty', directory: true},
    {path: '/10.js'}, {path: '/2.js'},
  ]);
  assert.deepEqual(tree.map(node => [node.path, Boolean(node.directory)]), [
    ['/empty', true], ['/parts', true], ['/2.js', false], ['/10.js', false], ['/z.js', false],
  ]);
  assert.deepEqual(tree[0].children.map(node => [node.path, node.directory, node.children.length]), [['/empty/deep', true, 0]]);
  assert.equal(tree[0].file, undefined);
  assert.equal(tree[0].children[0].file, undefined);
  assert.equal(tree[1].children[0].file.path, '/parts/voice.tfi');
  assert.equal(tree.filter(node => node.path === '/parts').length, 1);
});

class Element {
  constructor(tag) {this.tagName=tag;this.children=[];this.events={};this.dataset={};this.attributes={};this.style={};this.classList={add(){},remove(){}};this.open=false;this.offsetWidth=220;this.offsetHeight=270;}
  set textContent(value) {this.text=value;this.children=[];}
  get textContent() {return this.text??'';}
  append(...children) {this.children.push(...children);}
  appendChild(child) {this.append(child);return child;}
  replaceChildren(...children) {this.children=children;}
  setAttribute(name,value) {this.attributes[name]=value;}
  addEventListener(type,handler) {(this.events[type]??=[]).push(handler);}
  removeEventListener(type,handler) {this.events[type]=(this.events[type]??[]).filter(listener=>listener!==handler);}
  emit(type,event={}) {for(const handler of this.events[type]??[])handler(event);}
  showModal() {this.open=true;}
  close() {this.open=false;this.emit('close');}
  focus() {document.activeElement=this;}
  select() {}
  blur() {}
  remove() {this.removed=true;}
  contains(element) {return descendants(this).includes(element);}
  querySelectorAll(selector) {return descendants(this).filter(element=>element.tagName==='button'&&(!selector.includes(':not(:disabled)')||!element.disabled));}
  querySelector(selector) {return this.querySelectorAll(selector)[0]??null;}
  getBoundingClientRect() {return {left:10,top:10,bottom:30};}
}
const descendants = element => [element,...element.children.flatMap(descendants)];
const setupDocument = () => {
  const previous=globalThis.document, previousWindow=globalThis.window;
  const doc=new Element('document');doc.createElement=tag=>new Element(tag);doc.body=new Element('body');
  globalThis.document=doc;
  globalThis.window=Object.assign(new Element('window'),{innerWidth:800,innerHeight:600});
  return {doc,restore(){if(previous===undefined)delete globalThis.document;else globalThis.document=previous;if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}};
};

test('an empty folder is rendered as a drop target and can receive a moved or copied file', () => {
  const {restore}=setupDocument();
  try {
    const root=new Element('div'),transfers=[],opened=[];
    renderFileTree(root,[{path:'/empty',directory:true},{path:'/lead.js'}],{
      selectedPath:'/lead.js',expanded:new Map(),onOpen:path=>opened.push(path),onTransfer:(...args)=>transfers.push(args),
    });
    const folder=descendants(root).find(element=>element.tagName==='summary');
    assert.equal(folder.dataset.filePath,'/empty');
    assert.equal(folder.draggable,true);
    const payload={getData:()=>'/lead.js',files:[],types:['application/x-tetorica-path']};
    for(const copy of [false,true])folder.ondrop({dataTransfer:payload,ctrlKey:copy,preventDefault(){},stopPropagation(){}});
    assert.deepEqual(transfers,[['/lead.js','/empty/lead.js',false],['/lead.js','/empty/lead.js',true]]);
    assert.deepEqual(opened,[]);
  } finally {restore();}
});

test('closing FILES actions while Stop is pending cannot delete a different newly selected file', async () => {
  const {doc,restore}=setupDocument();
  try {
    const store=createProjectFiles({files:{'/first.js':'first','/second.js':'second'}});
    const root=new Element('div'),newFileButton=new Element('button'),newFolderButton=new Element('button'),actionsButton=new Element('button'),importButton=new Element('button'),input=new Element('input');
    let finishStop,changes=0;
    const explorer=mountProjectExplorer({root,newFileButton,newFolderButton,actionsButton,importButton,input,
      getStore:()=>store,getFiles:()=>store.snapshot().files,getSelected:()=>'/first.js',onOpen(){},
      beforeChange:()=>new Promise(resolve=>{finishStop=resolve;}),onChanged:()=>{changes++;},
    });
    const openActions=path=>root.emit('contextmenu',{preventDefault(){},target:{closest:()=>({dataset:{filePath:path}})}});
    openActions('/first.js');
    const menu=doc.body.children.find(element=>element.attributes.role==='menu'),dialog=doc.body.children.find(element=>element.tagName==='dialog'),form=descendants(dialog).find(element=>element.tagName==='form');
    await descendants(menu).find(element=>element.tagName==='button'&&element.textContent==='Delete').onclick();
    const pending=form.onsubmit({preventDefault(){}});
    assert.equal(typeof finishStop,'function');
    dialog.close();openActions('/second.js');
    finishStop();await pending;
    assert.deepEqual(store.snapshot().files,{'/first.js':'first','/second.js':'second'});
    assert.equal(changes,0);
    assert.equal(menu.hidden,false);
    explorer.dispose();
  } finally {restore();}
});

test('FILES rejects deleting or renaming the last runnable script without publishing the draft', async () => {
  const {doc,restore}=setupDocument();
  try {
    const store=createProjectFiles({files:{'/last/lead.js':'play(60)', '/notes.txt':'notes', '/.git/refs/heads/branch.js':'metadata'}});
    const root=new Element('div'),newFileButton=new Element('button'),newFolderButton=new Element('button'),actionsButton=new Element('button'),importButton=new Element('button'),input=new Element('input');
    let changes=0;
    const explorer=mountProjectExplorer({root,newFileButton,newFolderButton,actionsButton,importButton,input,
      getStore:()=>store,getFiles:()=>store.snapshot().files,getSelected:()=>'/last/lead.js',onOpen(){},beforeChange:async()=>{},onChanged:()=>{changes++;},
    });
    const menu=doc.body.children.find(element=>element.attributes.role==='menu'),dialog=doc.body.children.find(element=>element.tagName==='dialog'),form=descendants(dialog).find(element=>element.tagName==='form');
    const openAction=async(path,action)=>{
      root.emit('contextmenu',{preventDefault(){},target:{closest:()=>({dataset:{filePath:path}})}});
      await descendants(menu).find(element=>element.tagName==='button'&&element.textContent===action).onclick();
    };
    const before=store.snapshot(), revision=store.revision;
    for (const [path,action,destination] of [['/last/lead.js','Delete'],['/last/lead.js','Rename…','lead.txt'],['/last','Delete']]) {
      await openAction(path,action);
      if(destination)descendants(form).find(element=>element.tagName==='input').value=destination;
      await form.onsubmit({preventDefault(){}});
      assert.deepEqual(store.snapshot(),before);
      assert.equal(store.revision,revision);
      assert.equal(changes,0);
      assert.equal(dialog.open,true);
      assert.match(descendants(form).find(element=>element.attributes.role==='alert').textContent,/at least one JavaScript/);
      dialog.close();
    }
    // A different JavaScript path remains playable; the guarded draft is then published once.
    await openAction('/last/lead.js','Rename…');
    descendants(form).find(element=>element.tagName==='input').value='renamed.mjs';
    await form.onsubmit({preventDefault(){}});
    assert.equal(store.snapshot().files['/last/renamed.mjs'],'play(60)');
    assert.ok(!Object.hasOwn(store.snapshot().files,'/last/lead.js'));
    assert.equal(changes,1);
    assert.equal(dialog.open,false);
    // Removing the old script is permitted after another ordinary script exists.
    store.createFile('/another.js','play(62)');
    await openAction('/last/renamed.mjs','Delete');
    await form.onsubmit({preventDefault(){}});
    assert.equal(store.snapshot().files['/another.js'],'play(62)');
    assert.ok(!Object.hasOwn(store.snapshot().files,'/last/renamed.mjs'));
    assert.equal(changes,2);
    explorer.dispose();
  } finally {restore();}
});

function pasteClipboard(clipboard,store,directory) {
  const draft=createProjectFiles(store.snapshot()),plan=clipboard.plan(draft,directory,store);
  plan.apply();
  const next=draft.snapshot();store.sync(next.files,next.directories);plan.commit();
  return plan.destination;
}

test('Copy preserves captured text, binary bytes and empty folders after source edits or deletion', () => {
  const store=createProjectFiles({files:{'/index.js':'play(60)','/source/lead.js':'original','/source/voice.tfi':{type:'binary',bytes:[0,255,128]}},directories:['/source/empty','/destination']});
  const clipboard=createExplorerClipboard();clipboard.capture(store,'/source');
  store.write('/source/lead.js','edited');store.write('/source/voice.tfi',{type:'binary',bytes:[1,2]});store.remove('/source');
  assert.equal(pasteClipboard(clipboard,store,'/destination'),'/destination/source');
  assert.equal(store.snapshot().files['/destination/source/lead.js'],'original');
  assert.deepEqual(store.snapshot().files['/destination/source/voice.tfi'],{type:'binary',bytes:[0,255,128]});
  assert.ok(store.listDirectories().includes('/destination/source/empty'));
  assert.equal(clipboard.available,true);
});

test('Paste generates copy names without overwriting and Cut moves the latest source only after success', () => {
  const store=createProjectFiles({files:{'/lead.js':'original','/lead-copy.js':'keep','/destination/lead.js':'occupied'},directories:['/destination','/empty']});
  const clipboard=createExplorerClipboard();clipboard.capture(store,'/lead.js');
  assert.equal(pasteClipboard(clipboard,store,'/'),'/lead-copy-2.js');
  assert.equal(store.snapshot().files['/lead-copy.js'],'keep');
  assert.equal(pasteClipboard(clipboard,store,'/'),'/lead-copy-3.js');
  clipboard.capture(store,'/lead.js',true);store.write('/lead.js','latest');
  const before=store.snapshot();
  assert.throws(()=>pasteClipboard(clipboard,store,'/destination'),/already exists/);
  assert.deepEqual(store.snapshot(),before);assert.equal(clipboard.available,true);
  assert.equal(pasteClipboard(clipboard,store,'/empty'),'/empty/lead.js');
  assert.equal(store.snapshot().files['/empty/lead.js'],'latest');
  assert.ok(!Object.hasOwn(store.snapshot().files,'/lead.js'));assert.equal(clipboard.available,false);
});

test('clipboard rejects internal paths, recursive paste and a replaced project', () => {
  const store=createProjectFiles({files:{'/index.js':'play(60)','/folder/part.js':'part','/folder/.git/HEAD':'ref: refs/heads/main\n'},directories:['/empty/nested']});
  const clipboard=createExplorerClipboard();
  for(const path of ['/','/sys/README.md','/folder/.git/HEAD','/folder'])assert.throws(()=>clipboard.capture(store,path),/cannot be copied|protected/);
  clipboard.capture(store,'/empty');
  assert.throws(()=>clipboard.plan(createProjectFiles(store.snapshot()),'/empty/nested',store),/inside itself/);
  assert.throws(()=>clipboard.plan(createProjectFiles(store.snapshot()),'/',createProjectFiles(store.snapshot())),/Project changed/);
  assert.throws(()=>clipboard.plan(createProjectFiles(store.snapshot()),'/folder/.git',store),/reserved/);
  clipboard.clear();assert.equal(clipboard.available,false);
  assert.throws(()=>clipboard.plan(createProjectFiles(store.snapshot()),'/',store),/Copy or cut/);
});

test('FILES context menu uses YM action order, captures without stopping and supports keyboard dismissal', async () => {
  const {doc,restore}=setupDocument();
  try {
    const store=createProjectFiles({files:{'/index.js':'play(60)','/lead.js':'original'}}),root=new Element('div');
    let stops=0;
    const button=()=>new Element('button'),explorer=mountProjectExplorer({root,newFileButton:button(),newFolderButton:button(),actionsButton:button(),importButton:button(),input:new Element('input'),
      getStore:()=>store,getFiles:()=>store.snapshot().files,getSelected:()=>'/lead.js',onOpen(){},beforeChange:()=>{stops++;}});
    const menu=doc.body.children.find(element=>element.attributes.role==='menu');
    const target=Object.assign(new Element('button'),{dataset:{filePath:'/lead.js'}});target.closest=()=>target;
    root.emit('keydown',{key:'F10',shiftKey:true,target,preventDefault(){},stopPropagation(){}});
    assert.equal(menu.hidden,false);
    assert.deepEqual(menu.children.map(element=>element.textContent),['Copy Relative Path','Copy','Paste','Delete','Cut','Rename…','New File…','New Folder…']);
    assert.equal(menu.children[2].disabled,true);
    assert.equal(doc.activeElement,menu.children[0]);
    menu.emit('keydown',{key:'ArrowDown',preventDefault(){}});assert.equal(doc.activeElement,menu.children[1]);
    menu.emit('keydown',{key:'End',preventDefault(){}});assert.equal(doc.activeElement,menu.children[7]);
    menu.emit('keydown',{key:'Escape',preventDefault(){}});assert.equal(menu.hidden,true);assert.equal(doc.activeElement,target);
    root.emit('contextmenu',{target,clientX:790,clientY:590,preventDefault(){}});
    assert.equal(menu.style.left,'580px');assert.equal(menu.style.top,'330px');
    await menu.children[1].onclick();assert.equal(stops,0);assert.equal(menu.hidden,true);
    store.write('/lead.js','edited after copy');
    root.emit('contextmenu',{target,preventDefault(){}});
    assert.equal(menu.children[2].disabled,false);await menu.children[2].onclick();
    assert.equal(store.snapshot().files['/lead-copy.js'],'original');assert.equal(stops,1);
    root.emit('contextmenu',{target,preventDefault(){}});doc.emit('scroll',{target:menu});assert.equal(menu.hidden,false);
    doc.emit('scroll',{target:root});assert.equal(menu.hidden,true);
    root.emit('contextmenu',{target,preventDefault(){}});doc.emit('pointerdown',{target:root});assert.equal(menu.hidden,true);
    explorer.reset();root.emit('contextmenu',{target,preventDefault(){}});assert.equal(menu.children[2].disabled,true);
    explorer.dispose();assert.equal(root.events.contextmenu.length,0);assert.equal(doc.events.pointerdown.length,0);
  } finally {restore();}
});

test('opening another menu cancels a pending Paste and retains the cut source and clipboard', async () => {
  const {doc,restore}=setupDocument();
  try {
    const store=createProjectFiles({files:{'/index.js':'play(60)','/lead.js':'source'},directories:['/destination']}),root=new Element('div');
    let finishStop,changes=0;const errors=[];
    const button=()=>new Element('button'),explorer=mountProjectExplorer({root,newFileButton:button(),newFolderButton:button(),actionsButton:button(),importButton:button(),input:new Element('input'),
      getStore:()=>store,getFiles:()=>store.snapshot().files,getSelected:()=>'/lead.js',onOpen(){},beforeChange:()=>new Promise(resolve=>{finishStop=resolve;}),onChanged:()=>{changes++;},onError:error=>errors.push(error.message)});
    const menu=doc.body.children.find(element=>element.attributes.role==='menu');
    const open=path=>root.emit('contextmenu',{target:{closest:()=>({dataset:{filePath:path}})},preventDefault(){}});
    open('/lead.js');await menu.children[4].onclick();open('/destination');
    const pending=menu.children[2].onclick();await Promise.resolve();
    assert.equal(typeof finishStop,'function');open('/index.js');finishStop();await pending;
    assert.equal(store.snapshot().files['/lead.js'],'source');assert.ok(!Object.hasOwn(store.snapshot().files,'/destination/lead.js'));
    assert.equal(changes,0);assert.match(errors[0],/cancelled/);assert.equal(menu.hidden,false);assert.equal(menu.children[2].disabled,false);
    explorer.dispose();
  } finally {restore();}
});

test('toolbar Import uses project root for selected guides and preserves an ordinary folder destination', async () => {
  const {restore}=setupDocument();
  try {
    const store=createProjectFiles({files:{'/index.js':'play(60)'},directories:['/parts']});
    let selected='/sys/README.md';const changes=[],errors=[];
    const button=()=>new Element('button'),importButton=button(),input=new Element('input');
    input.click=()=>{};
    const explorer=mountProjectExplorer({root:new Element('div'),newFileButton:button(),newFolderButton:button(),actionsButton:button(),importButton,input,
      getStore:()=>store,getFiles:()=>store.snapshot().files,getSelected:()=>selected,onOpen(){},beforeChange:async()=>{},onChanged:detail=>changes.push(detail),onError:error=>errors.push(error)});
    for (const [path,name,destination] of [['/sys/README.md','notes.txt','/notes.txt'],['/parts','part.js','/parts/part.js']]) {
      selected=path;importButton.onclick();
      // A later selection does not retarget the already open file picker.
      selected='/sys/lib/README.md';input.files=[{name,size:4,text:async()=>'text'}];
      await input.onchange();
      assert.equal(store.snapshot().files[destination],'text');
      assert.deepEqual(changes.at(-1),{open:destination});
      assert.equal(input.value,'');
    }
    assert.deepEqual(errors,[]);explorer.dispose();
  } finally {restore();}
});
