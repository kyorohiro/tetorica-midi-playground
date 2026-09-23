// SETUP: in MIDI connections assign MIDI_OUTPUT_01 to tetorica-ym2612
// and MIDI_OUTPUT_02 to tetorica-sega-psg. These assignments are required.
// Run plays FM C4 and PSG G4 together. Try different channels or destinations.
// You can assign external MIDI ports instead; prepare their instruments first.
await enableSoundChip("ym2612");
await enableSoundChip("sega-psg");
const fm = midi.output(MIDI_OUTPUT_01, { channel: CH1 });
const psg = midi.output(MIDI_OUTPUT_02, { channel: CH2 });
await Promise.all([
  fm.play("C4", { duration: 1, velocity: 90 }),
  psg.play("G4", { duration: 1, velocity: 90 }),
]);
