import {legacyChannelExamples} from './legacy-channel-examples.js';
import {legacyRootExamples} from './examples.js';
// Only replace an untouched previously bundled example; preserve user edits.
const previousAssignedExample = "// In MIDI connections assign MIDI_OUTPUT_01 to tetorica-ym2612 and\n// MIDI_OUTPUT_02 to tetorica-sega-psg. Or choose your external instruments.\n// These enable calls prepare the internal destinations only.\nawait enableSoundChip(\"ym2612\");\nawait enableSoundChip(\"sega-psg\");\nconst piano = midi.output(MIDI_OUTPUT_01, { channel: 1 });\nconst bass = midi.output(MIDI_OUTPUT_01, { channel: 2 });\nconst lead = midi.output(MIDI_OUTPUT_02, { channel: 1 });\nliveLoop(\"piano\", async () => {\n  piano.play(\"C4\", { duration: 0.4 });\n  await beat(0.5);\n});\nliveLoop(\"bass\", async () => {\n  bass.play(\"C3\", { duration: 0.8 });\n  await beat(1);\n});\nliveLoop(\"lead\", async () => {\n  lead.play(\"G4\", { duration: 0.2 });\n  await beat(0.25);\n});\n";
export function mergeExamples(files,examples) {
  const next={...files};
  for(const [path,code] of Object.entries(examples)) {
    if(!Object.hasOwn(next,path)||next[path]===legacyChannelExamples[path]||(path==='/examples/02_assigned_outputs.js'&&next[path]===previousAssignedExample))next[path]=code;
  }
  // Remove only known, unedited root samples after their replacement is available.
  const replacements={'/lead.js':'/examples/lead.js','/melody.js':'/examples/melody.js','/loop.js':'/examples/05_live_loop.js'};
  for(const [path,replacement] of Object.entries(replacements)) {
    if(next[path]===legacyRootExamples[path]&&Object.hasOwn(next,replacement))delete next[path];
  }
  return next;
}
