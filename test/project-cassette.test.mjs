import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportProject,importProject,MAX_PROJECT_BYTES} from '../ui/project-cassette.js';
import {zipSync,unzipSync,strToU8} from '../ui/vendor/fflate.js';
import {prepareModules} from '../ui/modules.js';
import {binaryFile} from '../ui/project-assets.js';
import {guides, withGuide} from '../ui/guide.js';

const project=()=>({files:{'/index.js':'const p = await import("./lib/phrase.js"); log(p.value);','/lib/phrase.js':'export const value="音楽 🎵";','/notes.md':'My notes','/README.md':'project README','/lib/README.md':'project library README','/sys/README.md':'bundled guide'},runPath:'/index.js',selected:'/lib/phrase.js',bpm:135,clockMode:'internal'});
const pack=entries=>zipSync(Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,strToU8(v)])));
test('project ZIP round-trips files, relative imports and settings without bundled guides',async()=>{
 const source=project();const bytes=exportProject(source);const loaded=importProject(bytes);
 const {['/sys/README.md']:guide,...expectedFiles}=source.files;
 assert.deepEqual(loaded,{...source,files:expectedFiles});
 assert.ok(source.files['/sys/README.md']);
 const entries=unzipSync(bytes);
 assert.ok(entries['lib/phrase.js']);assert.ok(entries['metadata.json']);
 assert.ok(entries['README.md']);assert.ok(entries['lib/README.md']);assert.ok(!entries['sys/README.md']);
 const prepared=await prepareModules(loaded.files,loaded.files[loaded.runPath],loaded.runPath,code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const logs=[];
 try{await new (Object.getPrototypeOf(async()=>{}).constructor)('log',prepared.code)(value=>logs.push(value));}finally{prepared.dispose();}
 assert.deepEqual(logs,['音楽 🎵']);
});
test('alternate run files and guide selection round-trip',()=>{
 const source=project();source.runPath='/lib/phrase.js';source.selected='/sys/README_jp.md';source.clockMode='external';
 const loaded=importProject(exportProject(source));
 assert.equal(loaded.runPath,source.runPath);assert.equal(loaded.selected,source.selected);assert.equal(loaded.clockMode,'external');
});
test('legacy guide selection migrates while README content in older cassettes is preserved',()=>{
 for(const name of ['README.md','README_jp.md','lib/README.md','lib/README_jp.md']) {
  const metadata={format:'tetorica-midi-playground',version:1,runPath:'/index.js',selected:'/'+name,bpm:120,clockMode:'internal'};
  const legacy=pack({'index.js':'log(1)','metadata.json':JSON.stringify(metadata)});
  const migrated=importProject(legacy);
  assert.equal(migrated.selected,'/sys/'+name);
  assert.deepEqual(migrated.files,{'/index.js':'log(1)'});
  const withReadme=pack({'index.js':'log(1)',[name]:'keep this README from the old archive','metadata.json':JSON.stringify(metadata)});
  const preserved=importProject(withReadme);
  assert.equal(preserved.selected,'/'+name);
  assert.equal(preserved.files['/'+name],'keep this README from the old archive');
  assert.deepEqual(importProject(exportProject(preserved)),preserved);
 }
});
test('cassettes reject persisted sys payloads and never select a nonexistent protected path',()=>{
 const source=project();source.selected='/sys/not-a-guide.md';
 assert.equal(importProject(exportProject(source)).selected,source.runPath);
 for(const path of ['/sys','/sys/payload.js','/SYS/payload']) assert.throws(()=>exportProject({...source,files:{...source.files,[path]:'payload'}}),/protected/);
});
test('invalid archives and project settings are rejected before replacement',()=>{
 assert.throws(()=>importProject(new Uint8Array([1,2,3])));
 assert.throws(()=>importProject(pack({'index.js':'log(1)'})),/metadata/);
 const entries=unzipSync(exportProject(project()));
 const meta=JSON.parse(new TextDecoder().decode(entries['metadata.json']));
 for(const patch of [{version:3},{format:'ym2612'},{runPath:'/missing.js'},{bpm:0},{clockMode:'other'}]){
  assert.throws(()=>importProject(zipSync({...entries,'metadata.json':strToU8(JSON.stringify({...meta,...patch}))})));
 }
 for(const path of ['../escape.js','/absolute.js','lib/../escape.js','lib\\escape.js','lib//file.js']){
  assert.throws(()=>importProject(zipSync({...entries,[path]:strToU8('')})),/path/);
 }
 assert.throws(()=>exportProject({...project(),files:{'/index.js':42}}),/file/);
});
test('ZIP and expanded-size limits are enforced',()=>{
 assert.throws(()=>importProject(new Uint8Array(MAX_PROJECT_BYTES+1)),/16 MiB/);
 const bomb=zipSync({'large.js':new Uint8Array(MAX_PROJECT_BYTES+1)});
 assert.throws(()=>importProject(bomb),/Expanded/);
});

test('binary manifest rejects missing, duplicate, reserved and JavaScript binary paths',()=>{
 const entries=unzipSync(exportProject(project()));
 const meta=JSON.parse(new TextDecoder().decode(entries['metadata.json']));
 for(const binaryPaths of [undefined,{},['/missing.tfi'],['/notes.md','/notes.md'],['/metadata.json'],['/index.js']]){
  const bytes=zipSync({...entries,'metadata.json':strToU8(JSON.stringify({...meta,version:2,binaryPaths}))});
  assert.throws(()=>importProject(bytes));
 }
});

test('version 3 preserves empty folders and Git metadata without adding guides or losing binary bytes',()=>{
 const source=project();delete source.files['/sys/README.md'];
 source.files['/.git/HEAD']=binaryFile(new TextEncoder().encode('ref: refs/heads/main\n'));
 source.files['/.git/objects/ab/1234']=binaryFile([0,255,128,254,0]);
 source.directories=['/empty/nested','/.git/refs/heads'];
 const bytes=exportProject(source),entries=unzipSync(bytes);
 const metadata=JSON.parse(new TextDecoder().decode(entries['metadata.json']));
 assert.equal(metadata.version,3);
 const loaded=importProject(bytes);
 assert.deepEqual(loaded.files,source.files);
 assert.ok(loaded.directories.includes('/empty/nested'));
 assert.ok(loaded.directories.includes('/.git/refs/heads'));
 assert.ok(!Object.hasOwn(entries,'empty/'));
 assert.deepEqual(importProject(exportProject(loaded)),loaded);
});

test('legacy cassette versions keep their shape while malformed version 3 directories cannot replace a project',()=>{
 const plain=project();const v1=exportProject(plain);
 assert.ok(!Object.hasOwn(importProject(v1),'directories'));
 plain.files['/bell.tfi']=binaryFile([0,255]);
 const v2=exportProject(plain);
 assert.ok(!Object.hasOwn(importProject(v2),'directories'));
 const entries=unzipSync(v2),metadata=JSON.parse(new TextDecoder().decode(entries['metadata.json']));
 for(const directories of [null,{},['/empty/../escape'],['/empty','/empty'],['/.git/../escape'],['/sys'],['/sys/lib'],['/README.md'],['/index.js/child'],['/CASE','/case']]){
  const bytes=zipSync({...entries,'metadata.json':strToU8(JSON.stringify({...metadata,version:3,directories}))});
  assert.throws(()=>importProject(bytes));
 }
 assert.throws(()=>exportProject({...plain,directories:Array.from({length:1025},(_,i)=>`/empty${i}`)}),/1024/);
});

test('Git internals cannot become the Run file or viewed editor after cassette import',()=>{
 const source=project();source.files['/.git/hooks/demo.js']='metadata';source.selected='/.git/hooks/demo.js';
 const loaded=importProject(exportProject(source));
 assert.equal(loaded.selected,source.runPath);
 assert.throws(()=>exportProject({...source,runPath:'/.git/hooks/demo.js'}),/Run file/);
});

test('an explicitly empty workspace round-trips without recreating an entry script',()=>{
 const source={files:{},directories:[],runPath:'',selected:'/sys/README.md',bpm:120,clockMode:'internal'};
 const bytes=exportProject(source),entries=unzipSync(bytes);
 assert.deepEqual(Object.keys(entries),['metadata.json']);
 const metadata=JSON.parse(new TextDecoder().decode(entries['metadata.json']));
 assert.equal(metadata.version,3);
 assert.deepEqual(metadata.directories,[]);
 assert.deepEqual(importProject(bytes),source);
 assert.deepEqual(importProject(exportProject(importProject(bytes))),source);
 const {directories,...withoutDirectories}=source;
 assert.deepEqual(importProject(exportProject(withoutDirectories)),source);
 const guidesOnly={...withoutDirectories,files:{'/sys/README.md':'bundled guide'},selected:'/gone.js'};
 assert.deepEqual(importProject(exportProject(guidesOnly)),source);
});

test('work in progress without JavaScript preserves notes, binary assets, Git and empty folders',()=>{
 const source={files:{'/notes.md':'Start here','/bell.tfi':binaryFile([0,255,128]),'/.git/hooks/prepare.js':'internal metadata'},directories:['/drafts/empty'],runPath:'',selected:'/notes.md',bpm:135,clockMode:'external'};
 const loaded=importProject(exportProject(source));
 assert.deepEqual(loaded.files,source.files);
 assert.equal(loaded.selected,'/notes.md');
 assert.equal(loaded.runPath,'');
 assert.ok(loaded.directories.includes('/drafts/empty'));
 assert.deepEqual(importProject(exportProject(loaded)),loaded);
 for(const selected of ['/missing.js','/.git/hooks/prepare.js','/sys/not-a-guide.md','']) {
  assert.equal(importProject(exportProject({...source,selected})).selected,'/sys/README.md');
 }
});

test('empty Run target is accepted only without an ordinary runnable script',()=>{
 const empty={files:{'/notes.md':'Work in progress','/.git/hooks/demo.js':'metadata'},runPath:'',selected:'/notes.md',bpm:120,clockMode:'internal'};
 assert.equal(importProject(exportProject(empty)).runPath,'');
 for(const runPath of [undefined,null,'/missing.js','/notes.md','/.git/hooks/demo.js']) {
  assert.throws(()=>exportProject({...empty,runPath}),/Run file/);
 }
 for(const path of ['/index.js','/lib/voice.mjs']) {
  const runnable={...empty,files:{...empty.files,[path]:'log(1)'}};
  for(const runPath of ['',undefined,null,'/missing.js','/notes.md','/.git/hooks/demo.js']) {
   assert.throws(()=>exportProject({...runnable,runPath}),/Run file/);
  }
  assert.equal(importProject(exportProject({...runnable,runPath:path})).runPath,path);
 }
});

test('all supported cassette versions can restore a no-script workspace and reject stale Run targets',()=>{
 for(const version of [1,2,3]) {
  const metadata={format:'tetorica-midi-playground',version,binaryPaths:[],...(version===3?{directories:['/empty']}:{}),runPath:'',selected:'/missing.js',bpm:120,clockMode:'internal'};
  const entries={'notes.md':strToU8('not yet a performance'),'metadata.json':strToU8(JSON.stringify(metadata))};
  const restored=importProject(zipSync(entries));
  assert.deepEqual(restored.files,{'/notes.md':'not yet a performance'});
  assert.equal(restored.runPath,'');
  assert.equal(restored.selected,'/sys/README.md');
  for(const runPath of ['/old.js','/notes.md',null]) {
   assert.throws(()=>importProject(zipSync({...entries,'metadata.json':strToU8(JSON.stringify({...metadata,runPath}))})),/Run file/);
  }
 }
});

test('deleted bundled guides round-trip without guide payloads or selecting a removed guide',()=>{
 const source={...project(),directories:[],removedGuides:['/sys/README_jp.md'],selected:'/sys/README_jp.md'};
 const bytes=exportProject(source),entries=unzipSync(bytes);
 const metadata=JSON.parse(new TextDecoder().decode(entries['metadata.json']));
 assert.equal(metadata.version,3);
 assert.deepEqual(metadata.removedGuides,source.removedGuides);
 assert.ok(Object.keys(entries).every(path=>!path.startsWith('sys/')));
 const loaded=importProject(bytes);
 assert.deepEqual(loaded.removedGuides,source.removedGuides);
 assert.equal(loaded.selected,source.runPath);
 assert.ok(!Object.hasOwn(withGuide(loaded.files,loaded.removedGuides),'/sys/README_jp.md'));
 assert.ok(Object.hasOwn(withGuide(loaded.files,loaded.removedGuides),'/sys/README.md'));
 assert.deepEqual(importProject(exportProject(loaded)),loaded);
 for(const selected of ['/sys/README.md','/notes.md','/README.md']) {
  assert.equal(importProject(exportProject({...source,selected})).selected,selected);
 }
});

test('all deleted guides preserve a truly empty workspace and ordinary no-script selections',()=>{
 const removedGuides=Object.keys(guides);
 const empty={files:{},directories:[],runPath:'',selected:'',bpm:120,clockMode:'internal',removedGuides};
 const bytes=exportProject(empty);
 assert.deepEqual(Object.keys(unzipSync(bytes)),['metadata.json']);
 assert.deepEqual(importProject(bytes),empty);
 assert.deepEqual(importProject(exportProject(importProject(bytes))),empty);
 for(const selected of ['/sys/README.md','/README.md','/missing.js','/.git/HEAD']) {
  assert.deepEqual(importProject(exportProject({...empty,selected})),empty);
 }
 const notes={...empty,files:{'/notes.md':'Start a new project','/.git/HEAD':'ref: refs/heads/main\n'}};
 for(const selected of ['', '/sys/README.md','/missing.js']) {
  const loaded=importProject(exportProject({...notes,selected}));
  assert.equal(loaded.selected,'/notes.md');
  assert.deepEqual(loaded.removedGuides,removedGuides);
 }
 const onlyGit={...empty,files:{'/.git/HEAD':'ref: refs/heads/main\n'}};
 assert.equal(importProject(exportProject(onlyGit)).selected,'');
});

test('partial guide deletion falls back only to visible guides and never revives legacy selections',()=>{
 const source={files:{},runPath:'',selected:'/README.md',bpm:120,clockMode:'internal',removedGuides:['/sys/README.md']};
 const loaded=importProject(exportProject(source));
 assert.equal(loaded.selected,'/sys/README_jp.md');
 assert.deepEqual(loaded.removedGuides,source.removedGuides);
 assert.deepEqual(loaded.directories,[]);
 const projectReadme={...source,files:{'/README.md':'actual editable README'}};
 assert.equal(importProject(exportProject(projectReadme)).selected,'/README.md');
 const staleGuide={...source,files:{'/sys/README.md':'obsolete bundled bytes'}};
 assert.deepEqual(importProject(exportProject(staleGuide)),loaded);
});

test('malformed removed-guide metadata is rejected before cassette replacement',()=>{
 const source=project();
 const entries=unzipSync(exportProject(source));
 const metadata=JSON.parse(new TextDecoder().decode(entries['metadata.json']));
 for(const removedGuides of [null,{},'/sys/README.md',[42],['/sys'],['/sys/unknown.md'],['/SYS/README.md'],['/sys/README.md','/sys/README.md']]) {
  assert.throws(()=>exportProject({...source,removedGuides}),/guide/i);
  const bytes=zipSync({...entries,'metadata.json':strToU8(JSON.stringify({...metadata,removedGuides}))});
  assert.throws(()=>importProject(bytes),/guide/i);
 }
 const loaded=importProject(exportProject({...source,removedGuides:[]}));
 assert.ok(!Object.hasOwn(loaded,'removedGuides'));
});

test('legacy cassette versions keep all bundled guides visible without introducing metadata',()=>{
 for(const version of [1,2,3]) {
  const metadata={format:'tetorica-midi-playground',version,binaryPaths:[],...(version===3?{directories:[]}:{}),runPath:'',selected:'/README_jp.md',bpm:120,clockMode:'internal'};
  const loaded=importProject(pack({'metadata.json':JSON.stringify(metadata)}));
  assert.equal(loaded.selected,'/sys/README_jp.md');
  assert.ok(!Object.hasOwn(loaded,'removedGuides'));
  assert.deepEqual(Object.keys(withGuide(loaded.files,loaded.removedGuides)),Object.keys(guides));
 }
});
