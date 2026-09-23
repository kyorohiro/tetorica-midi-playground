// In MIDI connections, select Tetorica YM2612 (it enables automatically)
// or Tetorica Sega PSG as the MIDI output, then Run. External synths also work.
// Internal CC1 adds 5 Hz vibrato; CC7/10/64 control volume/pan/sustain.
setBpm(120);
await cc(7, 100, { channel: CH1 }); // Volume
await cc(10, 64, { channel: CH1 }); // Center pan
await cc(64, 127, { channel: CH1 }); // Sustain pedal on
await noteOn("C4", { channel: CH1, velocity: 100 });
try {
  for (let value = 0; value <= 120; value += 8) {
    await cc(1, value, { channel: CH1 }); // Modulation
    await beat(0.125);
  }
} finally {
  await noteOff("C4", { channel: CH1 });
  await cc(64, 0, { channel: CH1 });
  await cc(1, 0, { channel: CH1 });
}
// Stop releases notes/pedals. Internal Stop/Panic resets controllers; external
// synths may retain other CC settings.
