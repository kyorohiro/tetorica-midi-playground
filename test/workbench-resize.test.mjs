import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installWorkbenchResize} from '../ui/workbench-resize.js';

function fixture(initial={}) {
 const saved=new Map(Object.entries(initial)),storage={getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)};
 const node=(id='')=>({id,attrs:{},handlers:{},capture:null,
   setAttribute(name,value){this.attrs[name]=value;},
   addEventListener(type,fn){(this.handlers[type]??=new Set()).add(fn);},
   removeEventListener(type,fn){this.handlers[type]?.delete(fn);},
   emit(type,event={}){for(const fn of this.handlers[type]??[])fn({preventDefault(){},...event});},
   focus(){this.focused=true;},setPointerCapture(id){this.capture=id;},
   hasPointerCapture(id){return this.capture===id;},releasePointerCapture(){this.capture=null;},
   getBoundingClientRect(){return {width:6,height:6};}});
 const fileExplorer=node('files'),fileDivider=node(),dock=node('dock'),dockDivider=node(),window=node();
 const values={},classes=new Set(),workbench={clientWidth:1000,clientHeight:700,
   style:{setProperty:(key,value)=>values[key]=value},ownerDocument:{defaultView:window},
   classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}};
 const result=installWorkbenchResize({workbench,fileExplorer,fileDivider,dock,dockDivider,storage});
 return {result,workbench,fileDivider,dockDivider,values,classes,saved,window};
}

test('splitter keyboard and reset adjust persistent sizes with correct orientation',()=>{
 const f=fixture();
 assert.equal(f.values['--files-width'],'220px');assert.equal(f.values['--bottom-panel-height'],'260px');
 assert.equal(f.fileDivider.attrs['aria-orientation'],'vertical');assert.equal(f.dockDivider.attrs['aria-orientation'],'horizontal');
 f.fileDivider.emit('keydown',{key:'ArrowRight',shiftKey:true});
 f.dockDivider.emit('keydown',{key:'ArrowDown'});
 assert.equal(f.values['--files-width'],'260px');assert.equal(f.values['--bottom-panel-height'],'250px');
 assert.deepEqual(JSON.parse(f.saved.get('midi-workbench-layout-v1')),{filesWidth:260,dockHeight:250});
 f.fileDivider.emit('keydown',{key:'Home'});assert.equal(f.values['--files-width'],'140px');
 f.fileDivider.emit('dblclick');assert.equal(f.values['--files-width'],'220px');
 f.result.dispose();
 f.fileDivider.emit('keydown',{key:'ArrowRight'});assert.equal(f.values['--files-width'],'220px');
});

test('pointer capture keeps resizing within bounds and finishes on cancellation',()=>{
 const f=fixture();
 f.dockDivider.emit('pointerdown',{button:0,pointerId:7,clientY:400});
 assert.equal(f.dockDivider.capture,7);assert.equal(f.classes.has('is-resizing'),true);
 f.dockDivider.emit('pointermove',{pointerId:9,clientY:0});assert.equal(f.values['--bottom-panel-height'],'260px');
 f.dockDivider.emit('pointermove',{pointerId:7,clientY:0});assert.equal(f.values['--bottom-panel-height'],'494px');
 f.dockDivider.emit('pointercancel',{pointerId:7});
 assert.equal(f.dockDivider.capture,null);assert.equal(f.classes.has('is-resizing'),false);
 f.fileDivider.emit('pointerdown',{button:2,pointerId:4,clientX:220});assert.equal(f.fileDivider.capture,null);
 f.result.dispose();
});

test('viewport shrink clamps dimensions without losing preferred expanded sizes',()=>{
 const f=fixture({'midi-workbench-layout-v1':JSON.stringify({filesWidth:320,dockHeight:400})});
 assert.equal(f.values['--files-width'],'320px');
 f.workbench.clientWidth=260;f.workbench.clientHeight=180;f.window.emit('resize');
 assert.equal(f.values['--files-width'],'98px');assert.equal(f.values['--bottom-panel-height'],'66px');
 assert.equal(f.fileDivider.attrs['aria-valuemin'],f.fileDivider.attrs['aria-valuemax']);
 f.workbench.clientWidth=1000;f.workbench.clientHeight=700;f.result.refresh();
 assert.equal(f.values['--files-width'],'320px');assert.equal(f.values['--bottom-panel-height'],'400px');
 f.result.dispose();
});

test('corrupt or inaccessible preferences use defaults and resizing remains usable',()=>{
 const f=fixture({'midi-workbench-layout-v1':'not-json'});
 assert.equal(f.values['--files-width'],'220px');
 f.result.reset();f.result.dispose();
});
