import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFileEditor,registerHelpers,helperDocs,configureJavaScript} from '../ui/editor.js';
import {createMidiHelpers} from '../ui/runtime.js';
test('editor preserves models and view state and saves edits to their owning file',()=>{
 const models=[],changes=[];let callback,active,options,restored;
 const editor={onDidChangeModelContent(fn){callback=fn;return {dispose(){}};},saveViewState(){return {cursor:12};},restoreViewState(state){restored=state;},setModel(model){active=model;},updateOptions(value){options=value;},getValue(){return active.text;},dispose(){}};
 const monaco={Uri:{from:value=>value},editor:{create:()=>editor,createModel(text,language,uri){const model={text,language,uri,dispose(){this.disposed=true;}};models.push(model);return model;}}};
 const adapter=createFileEditor(monaco,{},(...args)=>changes.push(args));
 adapter.syncFiles({'/index.js':'first'});
 adapter.syncFiles({'/index.js':'must not overwrite'});
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
 assert.deepEqual(provider.provideCompletionItems({getWordUntilPosition:()=>({startColumn:7,endColumn:7}),getLineContent:()=> 'piano.'},{lineNumber:1,column:7}).suggestions,[]);
});

test('JavaScript completion excludes DOM libraries while preserving language options',()=>{
 let options={allowJs:true,allowNonTsExtensions:true,lib:['dom','esnext']},diagnostics;
 configureJavaScript({languages:{typescript:{javascriptDefaults:{
   addExtraLib:(source,path)=>{assert.match(source,/interface MidiOutput/);assert.equal(path,"file:///tetorica-api.d.ts");},
   setEagerModelSync:value=>assert.equal(value,true),
   getCompilerOptions:()=>options,
   setCompilerOptions:value=>{options=value;},
   setDiagnosticsOptions:value=>{diagnostics=value;},
 }}}});
 assert.deepEqual(options,{allowJs:true,allowNonTsExtensions:true,lib:['es2022']});
 assert.equal(diagnostics.noSemanticValidation,true);
 assert.ok(helperDocs.play);
});

function importCompletion(source, path='/index.js', paths=['/index.js','/lib/phrase.js','/lib/notes.mjs','/README.md']) {
 let provider;
 const files=[...paths];
 registerHelpers({languages:{CompletionItemKind:{File:17,Function:1,Variable:4},registerCompletionItemProvider(_,value){provider=value;}}},()=>files);
 const offset=source.indexOf('|');
 const text=source.replace('|','');
 const lines=text.slice(0,offset).split('\n');
 const position={lineNumber:lines.length,column:lines.at(-1).length+1};
 const model={uri:{path},getValue:()=>text,getOffsetAt:()=>offset,
  getLineContent:n=>text.split('\n')[n-1],getWordUntilPosition:()=>({startColumn:position.column,endColumn:position.column})};
 return {provider,model,position,text,files,result:()=>provider.provideCompletionItems(model,position)};
}

test('dynamic import offers FILES modules before typing a relative prefix',()=>{
 for(const quote of ['"',"'"]){
  const setup=importCompletion(`const p = await import(${quote}|${quote})`);
  const suggestions=setup.result().suggestions;
  assert.deepEqual(suggestions.map(s=>s.label),['./lib/notes.mjs','./lib/phrase.js']);
  assert.ok(suggestions.every(s=>s.kind===17));
  assert.equal(suggestions[0].range.startColumn,setup.position.column);
  assert.equal(suggestions[0].range.endColumn,setup.position.column);
  assert.ok(setup.provider.triggerCharacters.includes(quote));
  setup.files.push('/new.js');
  assert.ok(setup.result().suggestions.some(s=>s.label==='./new.js'));
 }
});

test('import completion uses the editing file and replaces the entire quoted path',()=>{
 const setup=importCompletion('const p = await import(\n  "../lib/ph|rase.js")','/examples/demo.js');
 const item=setup.result().suggestions.find(s=>s.label==='../lib/phrase.js');
 assert.ok(item);
 const line=setup.text.split('\n')[1];
 assert.equal(line.slice(0,item.range.startColumn-1)+item.insertText+line.slice(item.range.endColumn-1),'  "../lib/phrase.js")');
 assert.equal(item.range.startLineNumber,2);
 assert.ok(setup.result().suggestions.some(s=>s.label==='../index.js'));
 const unfinished=importCompletion('await import("./li|');
 assert.ok(unfinished.result().suggestions.some(s=>s.label==='./lib/phrase.js'));
});

test('import paths are not offered in comments, other strings or member calls',()=>{
 for(const source of ['// import("|")','/* import("|") */','const text = `import("|")`;','obj.import("|")','log("|")']){
  assert.ok(!importCompletion(source).result().suggestions.some(s=>s.kind===17),source);
 }
});
