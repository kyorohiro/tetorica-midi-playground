import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {guides,withGuide,canRun,isGuide,resolveGuideSelection,validateRemovedGuides} from '../ui/guide.js';
test('bundled guides are current, read-only, non-executable and preserve saved code',async()=>{
 const files=withGuide({'/melody.js':'my edits','/README.md':'project README','/README_jp.md':'project Japanese README','/lib/README.md':'project library README','/sys/README.md':'outdated bundled guide'});
 for(const name of ['README.md','README_jp.md','lib/README.md','lib/README_jp.md']) {
   assert.equal(guides['/sys/'+name],await readFile(new URL('../ui/'+name,import.meta.url),'utf8'));
   assert.equal(files['/sys/'+name],guides['/sys/'+name]);
   assert.equal(canRun('/sys/'+name),false);assert.equal(isGuide('/sys/'+name),true);
 }
 assert.equal(files['/README.md'],'project README');
 assert.equal(files['/README_jp.md'],'project Japanese README');
 assert.equal(files['/lib/README.md'],'project library README');
 assert.equal(isGuide('/README.md'),false);assert.equal(isGuide('/lib'),false);
 assert.equal(files['/melody.js'],'my edits');
 assert.equal(canRun('/melody.js'),true);assert.equal(isGuide('/melody.js'),false);
 for(const path of ['/sys','/sys/unknown','/sys/lib','/SYS/unknown']) assert.equal(isGuide(path),true);
 assert.equal(canRun('/sys/unknown.js'),false);
 assert.equal(isGuide('/system/readme'),false);assert.equal(isGuide(undefined),false);
});
test('legacy viewed guide paths migrate only when no actual project file occupies the path',()=>{
 for(const name of ['README.md','README_jp.md','lib/README.md','lib/README_jp.md']) {
  assert.equal(resolveGuideSelection('/'+name,{}),'/sys/'+name);
  assert.equal(resolveGuideSelection('/'+name,{['/'+name]:'project content'}),'/'+name);
 }
 assert.equal(resolveGuideSelection('/sys/README.md',{}),'/sys/README.md');
 assert.equal(resolveGuideSelection('/index.js',{}),'/index.js');
 assert.equal(resolveGuideSelection(undefined,{}),undefined);
});

test('removed guides stay absent from the overlay, including older saved guide copies',()=>{
 const removed=['/sys/README.md','/sys/lib/README_jp.md'];
 const files=withGuide({'/index.js':'code','/README.md':'project guide','/sys/README.md':'old guide','/SYS/payload.js':'not project code'},removed);
 assert.equal(files['/sys/README.md'],undefined);
 assert.equal(files['/sys/lib/README_jp.md'],undefined);
 assert.equal(files['/SYS/payload.js'],undefined);
 assert.equal(files['/sys/README_jp.md'],guides['/sys/README_jp.md']);
 assert.equal(files['/sys/lib/README.md'],guides['/sys/lib/README.md']);
 assert.equal(files['/README.md'],'project guide');
 assert.equal(files['/index.js'],'code');
 assert.deepEqual(withGuide(files,Object.keys(guides)),{'/index.js':'code','/README.md':'project guide'});
 assert.equal(isGuide('/sys/README.md'),true);
});

test('removed guide metadata contains unique canonical known paths in bundled order',()=>{
 assert.deepEqual(validateRemovedGuides(),[]);
 const paths=Object.keys(guides),reverse=[...paths].reverse();
 const canonical=validateRemovedGuides(reverse);
 assert.deepEqual(canonical,paths);
 canonical.pop();
 assert.deepEqual(validateRemovedGuides(reverse),paths);
 for(const value of [null,{},'', '/sys/README.md', ['/sys'], ['/sys/unknown.md'], ['/SYS/README.md'], ['/sys/README.md','/sys/README.md'], [1]]) {
  assert.throws(()=>validateRemovedGuides(value),/removed guide/i);
  assert.throws(()=>withGuide({},value),/removed guide/i);
 }
});
