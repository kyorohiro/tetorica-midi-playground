// Preset shape copied from FM2612 Playground (two-op-bell).
/** @type {Ym2612Preset} */
const bell = {
  algorithm: 4, feedback: 1,
  operators: [
    { dt: 0, multi: 6, tl: 10, ar: 31, d1r: 20, d2r: 8, sl: 7, rr: 7 },
    { dt: 0, multi: 1, tl: 16, ar: 28, d1r: 12, d2r: 4, sl: 5, rr: 6 },
    { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
  ],
};
// Keep the handle and initialization across Apply; Run creates new context.
/** @type {{lead: MidiOutput, ready: boolean}} */
const state = context.ym2612VoiceDemo ??= {
  lead: midi.output('tetorica-ym2612', {}), ready: false,
};
if (!state.ready) {
  await enableSoundChip('ym2612');
  // No channel: set the voice on all 16 MIDI channels, play on CH1.
  await state.lead.setVoice(bell);
  state.ready = true;
}
// To change the voice on Apply, call setVoice outside the initialization block.
// Import bell.tfi using FILES > Import, then use:
// await state.lead.loadVoice('../bell.tfi');
// Paths resolve from this Run file (/examples/13_ym2612_voice.js).
liveLoop('voice-demo', async ctx => {
  await ctx.playOutput(state.lead, ctx.cycle(['C4', 'E4', 'G4']), {duration: 0.5});
});
