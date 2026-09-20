import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {guides,withGuide,canRun,isGuide} from '../ui/guide.js';
test('bundled guides are current, read-only, non-executable and preserve saved code',async()=>{
 const files=withGuide({'/melody.js':'my edits','/README.md':'old guide','/README_jp.md':'old Japanese guide'});
 for(const name of ['README.md','README_jp.md','lib/README.md','lib/README_jp.md']) {
   assert.equal(guides['/'+name],await readFile(new URL('../ui/'+name,import.meta.url),'utf8'));
   assert.equal(files['/'+name],guides['/'+name]);
   assert.equal(canRun('/'+name),false);assert.equal(isGuide('/'+name),true);
 }
 assert.equal(files['/melody.js'],'my edits');
 assert.equal(canRun('/melody.js'),true);assert.equal(isGuide('/melody.js'),false);
});
