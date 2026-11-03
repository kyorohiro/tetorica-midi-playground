// Four beats of pitch bend, followed by half a second back to center.
// This example uses the MIDI output selected in the UI.
// Pitch-bend range is determined by the receiving instrument.
setBpm(120);
liveLoop('bend-sweep', async ({noteOn, noteOff, pitchBend, tween, beat}) => {
  await noteOn('C4', {velocity: 90});
  await tween({beats: 4}, async progress => {
    await pitchBend(lerp(0, 0.5, progress));
  });
  await tween({seconds: 0.5}, async progress => {
    await pitchBend(lerp(0.5, 0, progress));
  });
  await noteOff('C4');
  await beat(1);
});
// stopLoop('bend-sweep') cancels the tween and releases this loop's held note.
