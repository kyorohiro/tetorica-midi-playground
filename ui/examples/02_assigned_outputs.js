// Press Run: internal destinations work without manual MIDI assignments.
// To use assignments instead, set MIDI_OUTPUT_01 / 02 in MIDI connections,
// then replace "tetorica-ym2612" with MIDI_OUTPUT_01 (without quotes)
// and "tetorica-sega-psg" with MIDI_OUTPUT_02 in the output calls below.
await enableSoundChip("ym2612");
await enableSoundChip("sega-psg");
const piano = midi.output("tetorica-ym2612", { channel: 1 });
const bass = midi.output("tetorica-ym2612", { channel: 2 });
const lead = midi.output("tetorica-sega-psg", { channel: 1 });
liveLoop("piano", async () => {
  piano.play("C4", { duration: 0.4 });
  await beat(0.5);
});
liveLoop("bass", async () => {
  bass.play("C3", { duration: 0.8 });
  await beat(1);
});
liveLoop("lead", async () => {
  lead.play("G4", { duration: 0.2 });
  await beat(0.25);
});
