// Adapted from the YM2612 Playground's pg-context-init example.
// Select this Run file and press Run: the built-in YM2612 plays C, E, G.
// Press Apply after playback: the output is reused and the count increases.
// Edit the notes below and Apply again. Run resets the state and count.
// Try state. and state.instrument. to see JSDoc completion.

/**
 * State retained in pg.context between Apply evaluations.
 * @typedef {Object} ContextInitState
 * @property {MidiOutput} [instrument] Output created by the first evaluation.
 * @property {number} [hitCount] Number of evaluations since Run.
 */
const state = /** @type {ContextInitState} */ (pg.context);
// The global context and pg.context refer to the same object.

if (!state.instrument) {
  await pg.enableSoundChip("ym2612");
  state.instrument = pg.midi.output("tetorica-ym2612", { channel: 1 });
  state.hitCount = 0;
  pg.log("Initialized pg.context.");
}

state.hitCount = (state.hitCount ?? 0) + 1;
pg.log("Evaluation count:", state.hitCount);

for (const note of ["C4", "E4", "G4"]) {
  await state.instrument.play(note, { duration: 0.18, velocity: 90 });
  await pg.beat(0.05);
}
