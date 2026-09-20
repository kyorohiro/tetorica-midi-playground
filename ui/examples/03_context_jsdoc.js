// Run this file: the built-in YM2612 plays a repeating phrase. No DAW needed.
// Try context. and instrument. completion, or change the notes and duration.
await enableSoundChip("ym2612");
const piano = midi.output("tetorica-ym2612", { channel: 1 });

/**
 * Play a phrase with loop-local timing and cancellation.
 * @param {TetoricaContext} context
 * @param {MidiOutput} instrument
 * @returns {Promise<void>}
 */
async function phrase(context, instrument) {
  for (const note of ["C4", "E4", "G4", "B4"]) {
    await context.playOutput(instrument, note, { duration: 0.5, velocity: 90 });
  }
}

liveLoop("phrase", async context => {
  await phrase(context, piano);
  await context.beat(1);
});
