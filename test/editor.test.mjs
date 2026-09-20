import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFileEditor,registerHelpers,helperDocs} from '../ui/editor.js';
import {createMidiHelpers} from '../ui/runtime.js';
test('editor preserves models and view state and saves edits to their owning file',()=>{
 const models=[],changes=[];let callback,active,options,restored;
 const editor={onDidChangeModelContent(fn){callback=fn;return {dispose(){}};},saveViewState(){return {cursor:12};},restoreViewState(state){restored=state;},setModel(model){active=model;},updateOptions(value){options=value;},getValue(){return active.text;},dispose(){}};
 const monaco={Uri:{from:value=>value},editor:{create:()=>editor,createModel(text,language,uri){const model={text,language,uri,dispose(){this.disposed=true;}};models.push(model);return model;}}};
 const adapter=createFileEditor(monaco,{},(...args)=>changes.push(args));
 adapter.open('/index.js','first',false);active.text='edited';callback();
 adapter.open('/README.md','# guide',true);callback();assert.equal(options.readOnly,true);
 adapter.open('/index.js','edited',false);
 assert.equal(models.length,2);assert.equal(active.text,'edited');assert.equal(restored.cursor,12);
 assert.deepEqual(changes,[['/index.js','edited']]);assert.equal(models[1].language,'markdown');
 adapter.dispose();assert.ok(models.every(m=>m.disposed));
});
test('MIDI completion covers public helpers and replaces only the current word',()=>{
 const api=createMidiHelpers({send:async()=>{},sleep:async()=>{},log:()=>{}});
 for(const name of Object.keys(api))assert.ok(helperDocs[name],name);
 let provider;
 registerHelpers({languages:{CompletionItemKind:{Function:1},registerCompletionItemProvider(language,value){assert.equal(language,'javascript');provider=value;}}});
 const result=provider.provideCompletionItems({getWordUntilPosition:()=>({startColumn:3,endColumn:6})},{lineNumber:2,column:6});
 assert.ok(result.suggestions.some(s=>s.label==='liveLoop'));
 assert.deepEqual(result.suggestions[0].range,{startLineNumber:2,endLineNumber:2,startColumn:3,endColumn:6});
 assert.match(helperDocs.play,/beats/);
});
