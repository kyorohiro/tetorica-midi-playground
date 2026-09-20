// SETUP: open a MIDI receiver and choose an instrument there first.
// Replace the name below with the exact output port name shown in MIDI connections.
// Port names are not DAW track names. CH routing depends on the receiving app.
// Run plays C4 once. Try another channel only if your receiver supports it.
const instrument = midi.output("REPLACE WITH YOUR MIDI OUTPUT NAME", { channel: 1 });
await instrument.play("C4", { duration: 1, velocity: 90 });
