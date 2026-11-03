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

test('JavaScript checks isolated FILES modules without DOM libraries',()=>{
 let options={allowJs:true,allowNonTsExtensions:true,lib:['dom','esnext']},diagnostics;
 configureJavaScript({languages:{typescript:{ScriptTarget:{ES2020:7},ModuleKind:{ESNext:99},ModuleResolutionKind:{NodeJs:2},javascriptDefaults:{
   addExtraLib:(source,path)=>{assert.match(source,/interface MidiOutput/);assert.equal(path,"file:///tetorica-api.d.ts");},
   setEagerModelSync:value=>assert.equal(value,true),
   getCompilerOptions:()=>options,
   setCompilerOptions:value=>{options=value;},
   setDiagnosticsOptions:value=>{diagnostics=value;},
 }}}});
 assert.deepEqual(options,{allowJs:true,allowNonTsExtensions:true,checkJs:true,noLib:false,lib:['es2022'],target:7,module:99,moduleResolution:2,moduleDetection:3});
 assert.equal(diagnostics.noSemanticValidation,false);
 assert.equal(diagnostics.noSyntaxValidation,false);
 assert.deepEqual(diagnostics.diagnosticCodesToIgnore,[1108]);
 assert.ok(helperDocs.play);
});

function importCompletion(source, path='/index.js', paths=['/index.js','/lib/phrase.js','/lib/notes.mjs','/README.md']) {
 let provider;
 const files=[...paths];
 registerHelpers({languages:{CompletionItemKind:{File:17,Function:1,Variable:4,Value:12},registerCompletionItemProvider(_,value){provider=value;}}},()=>files);
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

test('project replacement drops old models and undo state before opening imported files',()=>{
 let active,callback;const models=[],changes=[];
 const editor={onDidChangeModelContent(fn){callback=fn;return {dispose(){}};},setModel(model){active=model;callback();},getValue(){return active?.text;},saveViewState:()=>({old:true}),restoreViewState(){assert.fail('restored old project view');},updateOptions(){},dispose(){}};
 const monaco={Uri:{from:value=>value},editor:{create:()=>editor,createModel(text,language,uri){const model={text,uri,dispose(){this.disposed=true;}};models.push(model);return model;}}};
 const adapter=createFileEditor(monaco,{},(...args)=>changes.push(args));
 adapter.syncFiles({'/index.js':'old','/removed.js':'old module'});
 adapter.open('/index.js','old',false);
 changes.length=0;
 adapter.replaceFiles({'/index.js':'imported','/lib/new.js':'new module'});
 assert.ok(models.slice(0,2).every(model=>model.disposed));
 assert.deepEqual(changes,[]);
 adapter.open('/index.js','imported',false);
 assert.equal(active.text,'imported');
 assert.deepEqual(changes,[['/index.js','imported']]);
});

test('stopLoop completes global and pg liveLoop names once and replaces closed or unfinished quotes',()=>{
 for(const call of ['stopLoop','pg.stopLoop'])for(const suffix of ['")','']){
  const setup=importCompletion(`liveLoop('bass',()=>{});pg.liveLoop('lead',()=>{});liveLoop('bass',()=>{});\n${call}("ba|ss${suffix}`);
  const items=setup.result().suggestions;
  assert.deepEqual(items.map(item=>item.label),['bass','lead']);
  assert.ok(items.every(item=>item.kind===12));
  const selected=items.find(item=>item.label==='lead'),line=setup.text.split('\n')[1];
  const replaced=line.slice(0,selected.range.startColumn-1)+selected.insertText+line.slice(selected.range.endColumn-1);
  assert.equal(replaced,`${call}("lead${suffix}`);
 }
});

test('stopLoop ignores comments, strings, regexes and unrelated member calls',()=>{
 const definitions=`// liveLoop('comment',()=>{});\n/* pg.liveLoop('block',()=>{}); */\nconst text="liveLoop('string',()=>{})";\nconst regex=/liveLoop('regex')/;\nobj.liveLoop('member',()=>{});obj.pg.liveLoop('nested',()=>{});\npg.liveLoop('real',()=>{});`;
 assert.deepEqual(importCompletion(definitions+'\nstopLoop("|")').result().suggestions.map(item=>item.label),['real']);
 for(const expression of ['// stopLoop("|")','/* stopLoop("|") */','const text=`stopLoop("|")`;','obj.stopLoop("|")','obj.pg.stopLoop("|")','log("|")','stopLoop("done");const other="|";']){
  assert.ok(!importCompletion(definitions+'\n'+expression).result().suggestions.some(item=>item.kind===12),expression);
 }
});

test('stopLoop completion preserves escaped and quoted names as valid JavaScript strings',()=>{
 const names=[`drum's`, 'say "hi"', 'folder\\lead', 'line\nbreak'];
 const definitions=names.map(name=>`liveLoop(${JSON.stringify(name)},()=>{});`).join('\n');
 for(const quote of ['"',"'"])for(const prefix of ['',quote==='"'?`drum's`:"drum\\'s",quote==='"'?'say \\"hi':'say "hi', 'folder\\\\le', 'folder\\']){
  const setup=importCompletion(definitions+`\nstopLoop(${quote}${prefix}|tail${quote})`);
  const suggestions=setup.result().suggestions;
  assert.deepEqual(suggestions.map(item=>item.label).sort(),[...names].sort(),`${quote}${prefix}`);
  for(const item of suggestions){
   const line=setup.text.split('\n').at(-1);
   const expression=line.slice(0,item.range.startColumn-1)+item.insertText+line.slice(item.range.endColumn-1);
   let received;new Function('stopLoop',expression)(name=>received=name);
   assert.equal(received,item.label);
  }
 }
});

test('reconcileFiles preserves unchanged models, updates text silently and disposes removed models',()=>{
 let active,callback;const changes=[],models=[];let restored;
 const editor={onDidChangeModelContent(fn){callback=fn;return {dispose(){}};},setModel(model){active=model;callback();},getValue:()=>active?.text,
  saveViewState:()=>({cursor:active?.uri.path==='/lib/old.js'?77:42}),restoreViewState:value=>restored=value,updateOptions(){},dispose(){}};
 const monaco={Uri:{from:value=>value},editor:{create:()=>editor,createModel(text,language,uri){
  const model={text,language,uri,undo:[text],getValue(){return this.text;},setValue(value){this.text=value;this.undo=[];callback();},dispose(){this.disposed=true;}};
  models.push(model);return model;
 }}};
 const adapter=createFileEditor(monaco,{},(...args)=>changes.push(args));
 adapter.syncFiles({'/index.js':'unchanged','/lib/old.js':'old','/removed.js':'remove'});
 const [index,old,removed]=models;
 adapter.open('/index.js','unchanged',false);changes.length=0;
 adapter.reconcileFiles({'/index.js':'unchanged','/lib/old.js':'changed'});
 assert.equal(models[0],index);assert.deepEqual(index.undo,['unchanged']);assert.equal(index.disposed,undefined);
 assert.equal(old.text,'changed');assert.deepEqual(old.undo,[]);assert.equal(old.disposed,undefined);assert.equal(removed.disposed,true);
 assert.deepEqual(changes,[]);
 adapter.open('/lib/old.js','changed',false);changes.length=0;
 adapter.open('/index.js','unchanged',false);assert.deepEqual(restored,{cursor:42});
 adapter.open('/lib/old.js','changed',false);changes.length=0;
 adapter.reconcileFiles({'/index.js':'unchanged','/renamed/old.js':'changed'},{from:'/lib',to:'/renamed'});
 assert.equal(old.disposed,true);assert.equal(active,null);assert.deepEqual(changes,[]);
 adapter.open('/renamed/old.js','changed',false);
 assert.deepEqual(restored,{cursor:77});assert.equal(active.uri.path,'/renamed/old.js');
 adapter.dispose();assert.ok(models.every(model=>model.disposed));
});

test('syncFiles exposes only script text and excludes binary files and Git internals',()=>{
 const models=[];
 const monaco={Uri:{from:value=>value},editor:{create:()=>({onDidChangeModelContent:()=>({dispose(){}}),dispose(){}}),
  createModel(text,language,uri){const model={text,language,uri,dispose(){}};models.push(model);return model;}}};
 const adapter=createFileEditor(monaco,{},()=>{});
 adapter.syncFiles({'/index.js':'code','/lib/a.mjs':'module','/binary.js':{kind:'binary',base64:'AA=='},'/.git/refs/heads/name.js':'ref','/lib/.GIT/config.js':'ref','/README.md':'guide'});
 assert.deepEqual(models.map(model=>model.uri.path),['/index.js','/lib/a.mjs']);
 adapter.dispose();
});
