import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportProject,importProject,MAX_PROJECT_BYTES} from '../ui/project-cassette.js';
import {zipSync,unzipSync,strToU8} from '../ui/vendor/fflate.js';
import {prepareModules} from '../ui/modules.js';
import {binaryFile} from '../ui/project-assets.js';

const project=()=>({files:{'/index.js':'const p = await import("./lib/phrase.js"); log(p.value);','/lib/phrase.js':'export const value="音楽 🎵";','/notes.md':'My notes','/README.md':'bundled guide'},runPath:'/index.js',selected:'/lib/phrase.js',bpm:135,clockMode:'internal'});
const pack=entries=>zipSync(Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,strToU8(v)])));
test('project ZIP round-trips files, relative imports and settings without bundled guides',async()=>{
 const source=project();const bytes=exportProject(source);const loaded=importProject(bytes);
 const {['/README.md']:guide,...expectedFiles}=source.files;
 assert.deepEqual(loaded,{...source,files:expectedFiles});
 assert.ok(source.files['/README.md']);
 const entries=unzipSync(bytes);
 assert.ok(entries['lib/phrase.js']);assert.ok(entries['metadata.json']);
 const prepared=await prepareModules(loaded.files,loaded.files[loaded.runPath],loaded.runPath,code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const logs=[];
 try{await new (Object.getPrototypeOf(async()=>{}).constructor)('log',prepared.code)(value=>logs.push(value));}finally{prepared.dispose();}
 assert.deepEqual(logs,['音楽 🎵']);
});
test('alternate run files and guide selection round-trip',()=>{
 const source=project();source.runPath='/lib/phrase.js';source.selected='/README_jp.md';source.clockMode='external';
 const loaded=importProject(exportProject(source));
 assert.equal(loaded.runPath,source.runPath);assert.equal(loaded.selected,source.selected);assert.equal(loaded.clockMode,'external');
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
 const source=project();delete source.files['/README.md'];
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
 for(const directories of [null,{},['/empty/../escape'],['/empty','/empty'],['/.git/../escape'],['/README.md'],['/index.js/child'],['/CASE','/case']]){
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
