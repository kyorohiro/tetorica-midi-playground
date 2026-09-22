// In MIDI connections, enable YM2612 + Sega PSG and select Tetorica YM2612
// (or Tetorica Sega PSG) as the MIDI output. Then Run this file.
// Internal bend range is +/-2 semitones. A compatible external synth also works.
// Program Change is transmitted, but internal preset-number mapping is pending;
// the internal YM2612 keeps the patch selected for this channel in its tab.
setBpm(120);
await programChange(30, { channel: 1 });
await noteOn("C4", { channel: 1, velocity: 100 });
try {
  for (let i = 0; i <= 20; i++) {
    await pitchBend(i / 20, { channel: 1 });
    await beat(0.025);
  }
} finally {
  await noteOff("C4", { channel: 1 });
  await pitchBend(0, { channel: 1 });
}
// External synths may retain bend after Stop; send pitchBend(0) to reset it.
// Internal Stop/Panic resets controllers while preserving edited FM patches.
