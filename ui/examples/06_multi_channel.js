// No DAW needed. One YM2612 receives two simultaneous parts on CH1 and CH2.
// Both channels share six FM voices. Edit each channel's patch in the YM2612 tab.
// Try changing the bass note or the gap. Stop ends both loops.
await enableSoundChip("ym2612");
const lead = midi.output("tetorica-ym2612", { channel: CH1 });
const bass = midi.output("tetorica-ym2612", { channel: CH2 });
liveLoop("lead", async context => {
  await context.playOutput(lead, context.cycle(["C4", "E4", "G4"]), { duration: 0.5 });
  await context.beat(0.25);
});
liveLoop("bass", async context => {
  await context.playOutput(bass, "C3", { duration: 1 });
  await context.beat(0.5);
});
