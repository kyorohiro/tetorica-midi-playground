import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ensureEntry,runSource} from '../ui/project.js';

test('legacy projects gain an entry without replacing edited scripts',()=>{
 const original={'/melody.js':'edited melody','/README.md':'guide'};
 const files=ensureEntry(original,'default notes');
 assert.equal(files['/melody.js'],'edited melody');
 assert.equal(runSource(files,'/index.js'),'default notes');
 assert.equal(original['/index.js'],undefined);
 assert.equal(ensureEntry({...files,'/index.js':'edited entry'},'new default')['/index.js'],'edited entry');
});
test('run target is independent of the viewed guide and can select another script',()=>{
 const files={'/index.js':'entry','/loop.js':'loop','/README.md':'guide'};
 assert.equal(runSource(files,'/index.js'),'entry');
 assert.equal(runSource(files,'/loop.js'),'loop');
 assert.throws(()=>runSource(files,'/README.md'));
 assert.throws(()=>runSource(files,'/missing.js'));
});
