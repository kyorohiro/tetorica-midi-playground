import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildFileTree, renderFileTree} from '../ui/shared/playground_file_tree.js';
import {mountProjectExplorer} from '../ui/project-explorer.js';
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
  constructor(tag) {this.tagName=tag;this.children=[];this.events={};this.dataset={};this.attributes={};this.classList={add(){},remove(){}};this.open=false;}
  append(...children) {this.children.push(...children);}
  appendChild(child) {this.append(child);return child;}
  replaceChildren(...children) {this.children=children;}
  setAttribute(name,value) {this.attributes[name]=value;}
  addEventListener(type,handler) {(this.events[type]??=[]).push(handler);}
  emit(type,event={}) {for(const handler of this.events[type]??[])handler(event);}
  showModal() {this.open=true;}
  close() {this.open=false;this.emit('close');}
  focus() {}
  select() {}
  blur() {}
  remove() {this.removed=true;}
}
const descendants = element => [element,...element.children.flatMap(descendants)];
const setupDocument = () => {
  const previous=globalThis.document;
  const doc={createElement:tag=>new Element(tag),body:new Element('body')};
  globalThis.document=doc;
  return {doc,restore(){if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}};
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
    const dialog=doc.body.children[0],form=descendants(dialog).find(element=>element.tagName==='form');
    descendants(dialog).find(element=>element.tagName==='button'&&element.textContent==='Delete…').onclick();
    const pending=form.onsubmit({preventDefault(){}});
    assert.equal(typeof finishStop,'function');
    dialog.close();openActions('/second.js');
    finishStop();await pending;
    assert.deepEqual(store.snapshot().files,{'/first.js':'first','/second.js':'second'});
    assert.equal(changes,0);
    assert.equal(dialog.open,true);
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
    const dialog=doc.body.children[0],form=descendants(dialog).find(element=>element.tagName==='form');
    const openAction=(path,action)=>{
      root.emit('contextmenu',{preventDefault(){},target:{closest:()=>({dataset:{filePath:path}})}});
      descendants(dialog).find(element=>element.tagName==='button'&&element.textContent===action).onclick();
    };
    const before=store.snapshot(), revision=store.revision;
    for (const [path,action,destination] of [['/last/lead.js','Delete…'],['/last/lead.js','Rename / move…','/last/lead.txt'],['/last','Delete…']]) {
      openAction(path,action);
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
    openAction('/last/lead.js','Rename / move…');
    descendants(form).find(element=>element.tagName==='input').value='/last/renamed.mjs';
    await form.onsubmit({preventDefault(){}});
    assert.equal(store.snapshot().files['/last/renamed.mjs'],'play(60)');
    assert.ok(!Object.hasOwn(store.snapshot().files,'/last/lead.js'));
    assert.equal(changes,1);
    assert.equal(dialog.open,false);
    // Removing the old script is permitted after another ordinary script exists.
    store.createFile('/another.js','play(62)');
    openAction('/last/renamed.mjs','Delete…');
    await form.onsubmit({preventDefault(){}});
    assert.equal(store.snapshot().files['/another.js'],'play(62)');
    assert.ok(!Object.hasOwn(store.snapshot().files,'/last/renamed.mjs'));
    assert.equal(changes,2);
    explorer.dispose();
  } finally {restore();}
});
