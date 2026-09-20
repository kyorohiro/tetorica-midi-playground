// No DAW or MIDI setup needed. Select this file as Run file, then press Run.
// Plays one C4. Try another note, velocity or duration (in beats).
await enableSoundChip("ym2612");
const instrument = midi.output("tetorica-ym2612", { channel: 1 });
await instrument.play("C4", { duration: 1, velocity: 90 });
