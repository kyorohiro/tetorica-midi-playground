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

test('New Project resets entry and settings without retaining edited project state',async()=>{
 const {createNewProject}=await import('../ui/project.js');
 const {bundledExamples}=await import('../ui/example-files.js');
 const {exportProject,importProject}=await import('../ui/project-cassette.js');
 const first=createNewProject(bundledExamples);
 first.files['/index.js']='old code';first.files['/old.js']='old module';first.files['/examples/lead.js']='edited';first.bpm=180;
 const fresh=createNewProject(bundledExamples);
 assert.ok(!Object.hasOwn(fresh.files,'/old.js'));
 assert.equal(fresh.files['/index.js'],bundledExamples['/examples/lead.js']);
 assert.equal(fresh.files['/examples/lead.js'],bundledExamples['/examples/lead.js']);
 assert.equal(fresh.bpm,120);assert.equal(fresh.clockMode,'internal');
 assert.equal(fresh.runPath,'/index.js');assert.equal(fresh.selected,'/index.js');
 assert.deepEqual(importProject(exportProject(fresh)),fresh);
});

test('cassette download names accept a base or full filename without duplicating extensions',async()=>{
 const {projectFileName}=await import('../ui/project.js');
 assert.equal(projectFileName(),'my-project.midi.cassette.zip');
 for(const value of [' song ','song.zip','song.midi.cassette.zip','song.MIDI.CASSETTE.ZIP'])assert.equal(projectFileName(value),'song.midi.cassette.zip');
 assert.equal(projectFileName('私の曲'),'私の曲.midi.cassette.zip');
 for(const value of ['', '   ','.zip','../song','a/b','a\\b','a:b','a\nname','x'.repeat(121)])assert.throws(()=>projectFileName(value),/file name/);
});
