import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportProject,importProject,MAX_PROJECT_BYTES} from '../ui/project-cassette.js';
import {zipSync,unzipSync,strToU8} from '../ui/vendor/fflate.js';
import {prepareModules} from '../ui/modules.js';

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
