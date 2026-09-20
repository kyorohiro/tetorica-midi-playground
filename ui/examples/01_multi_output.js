// No DAW or manual MIDI connection needed. Choose this Run file and press Run.
// Stop releases all three loops. The native sound rack stays enabled for Keyboard.
await enableSoundChip("ym2612");
await enableSoundChip("sega-psg");
setBpm(120);

const piano = midi.output("tetorica-ym2612", { channel: 1 });
const bass = midi.output("tetorica-ym2612", { channel: 2 });
const lead = midi.output("tetorica-sega-psg", { channel: 1 });

liveLoop("piano", async () => {
  piano.play(cycle(["C4", "E4", "G4", "E4"]), { duration: 0.4, velocity: 80 });
  await beat(0.5);
});
liveLoop("bass", async () => {
  bass.play(cycle(["C3", "G2"]), { duration: 0.8, velocity: 90 });
  await beat(1);
});
liveLoop("lead", async () => {
  lead.play(cycle(["C5", "E5", "G5", "E5"]), { duration: 0.15, velocity: 65 });
  await beat(0.25);
});
// PSG CH10 is fixed white noise. YM2612 currently uses a fixed FM patch on every CH.
// External ports can instead be selected by their unique name in midi.output().
