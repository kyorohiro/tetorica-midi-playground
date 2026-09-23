// No DAW needed. Run repeats a melody; Stop releases its notes.
// Change the notes, duration or gap; use Apply to replace the loop while playing.
await enableSoundChip("ym2612");
const instrument = midi.output("tetorica-ym2612", { channel: CH1 });
liveLoop("melody", async context => {
  const note = context.cycle(["C4", "E4", "G4", "E4"]);
  await context.playOutput(instrument, note, { duration: 0.5 });
  await context.beat(0.25);
});
