import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeExamples,upgradeExampleTypes} from '../ui/example-migrations.js';
import {bundledExamples} from '../ui/example-files.js';
import {legacyTypeExamples} from '../ui/legacy-type-examples.js';
test('untouched assigned example upgrades; edited examples and other files survive',()=>{
 const path='/examples/02_assigned_outputs.js';
 const old="// In MIDI connections assign MIDI_OUTPUT_01 to tetorica-ym2612 and\n// MIDI_OUTPUT_02 to tetorica-sega-psg. Or choose your external instruments.\n// These enable calls prepare the internal destinations only.\nawait enableSoundChip(\"ym2612\");\nawait enableSoundChip(\"sega-psg\");\nconst piano = midi.output(MIDI_OUTPUT_01, { channel: 1 });\nconst bass = midi.output(MIDI_OUTPUT_01, { channel: 2 });\nconst lead = midi.output(MIDI_OUTPUT_02, { channel: 1 });\nliveLoop(\"piano\", async () => {\n  piano.play(\"C4\", { duration: 0.4 });\n  await beat(0.5);\n});\nliveLoop(\"bass\", async () => {\n  bass.play(\"C3\", { duration: 0.8 });\n  await beat(1);\n});\nliveLoop(\"lead\", async () => {\n  lead.play(\"G4\", { duration: 0.2 });\n  await beat(0.25);\n});\n";
 assert.equal(mergeExamples({[path]:old},bundledExamples)[path],bundledExamples[path]);
 const edited=old+'\n// My changes';
 const files={[path]:edited,'/index.js':'mine'};
 const merged=mergeExamples(files,bundledExamples);
 assert.equal(merged[path],edited);assert.equal(merged['/index.js'],'mine');
 assert.equal(files[path],edited);
 assert.equal(mergeExamples({},bundledExamples)[path],bundledExamples[path]);
});

test('root samples migrate to examples without duplicates or loss of user edits',async()=>{
 const {legacyRootExamples}=await import('../ui/examples.js');
 const original={...legacyRootExamples,'/index.js':'my entry','/custom.js':'my code'};
 const migrated=mergeExamples(original,bundledExamples);
 for(const path of Object.keys(legacyRootExamples))assert.ok(!Object.hasOwn(migrated,path),path);
 assert.equal(migrated['/examples/lead.js'],legacyRootExamples['/lead.js']);
 assert.equal(migrated['/examples/melody.js'],legacyRootExamples['/melody.js']);
 assert.ok(migrated['/examples/05_live_loop.js']);
 assert.ok(!Object.hasOwn(migrated,'/examples/loop.js'));
 assert.equal(migrated['/index.js'],'my entry');
 assert.equal(migrated['/custom.js'],'my code');
 assert.equal(original['/lead.js'],legacyRootExamples['/lead.js']);
 assert.deepEqual(mergeExamples(migrated,bundledExamples),migrated);
 const edits=Object.fromEntries(Object.entries(legacyRootExamples).map(([path,code])=>[path,code+'// edited']));
 const preserved=mergeExamples({...edits,'/examples/lead.js':'edited destination'},bundledExamples);
 for(const [path,code] of Object.entries(edits))assert.equal(preserved[path],code);
 assert.equal(preserved['/examples/lead.js'],'edited destination');
});

test('moved samples are bundled from their source files',async()=>{
 const {readFile}=await import('node:fs/promises');
 for(const name of ['lead.js','melody.js']){
  assert.equal(bundledExamples['/examples/'+name],await readFile(new URL('../ui/examples/'+name,import.meta.url),'utf8'));
 }
});

test('old voice example upgrades without changing an exact project file list or user edits',()=>{
 const path='/examples/13_ym2612_voice.js',old=legacyTypeExamples[path];
 const files={[path]:old,'/index.js':'// my entry','/notes.md':'my notes'};
 const snapshot=JSON.parse(JSON.stringify(files));
 const updated=upgradeExampleTypes(files,bundledExamples);
 assert.equal(updated[path],bundledExamples[path]);
 assert.deepEqual(Object.keys(updated),Object.keys(files));
 assert.equal(updated['/index.js'],files['/index.js']);
 assert.equal(updated['/notes.md'],files['/notes.md']);
 assert.deepEqual(files,snapshot);
 assert.deepEqual(upgradeExampleTypes(updated,bundledExamples),updated);
 assert.deepEqual(upgradeExampleTypes({'/index.js':'mine'},bundledExamples),{'/index.js':'mine'});
 assert.deepEqual(upgradeExampleTypes(files,{}),files);
 assert.equal(mergeExamples(files,bundledExamples)[path],bundledExamples[path]);
 for(const edited of [old+'// my edit',old.replace('feedback: 1','feedback: 3')]){
  assert.equal(upgradeExampleTypes({[path]:edited},bundledExamples)[path],edited);
  assert.equal(mergeExamples({[path]:edited},bundledExamples)[path],edited);
 }
});
