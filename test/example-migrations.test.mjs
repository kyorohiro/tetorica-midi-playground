import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeExamples} from '../ui/example-migrations.js';
import {bundledExamples} from '../ui/example-files.js';
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
