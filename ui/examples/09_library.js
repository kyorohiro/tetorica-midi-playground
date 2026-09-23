// No DAW needed. Run repeats a phrase using a module in FILES/lib.
// Edit the notes here, or open lib/phrase.js to change the shared function.
// Use Stop to release notes. See lib/README.md for import and JSDoc details.
const { playPhrase } = await import("../lib/phrase.js");
await enableSoundChip("ym2612");
const instrument = midi.output("tetorica-ym2612", { channel: CH1 });
liveLoop("library-phrase", async context => {
  await playPhrase(context, instrument, ["C4", "E4", "G4"], {
    duration: 0.5,
    velocity: 90,
  });
  await context.beat(1);
});
