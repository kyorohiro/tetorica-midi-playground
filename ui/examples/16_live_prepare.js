// Apply reuses this output and its initialized voice. Run prepares it again.
// Returning a value infers MidiOutput without @type casts or ready flags.
const lead = await livePrepare('prepared-lead', async ({midi, enableSoundChip}) => {
  await enableSoundChip('ym2612');
  const output = midi.output('tetorica-ym2612');
  await output.setVoice({algorithm: 7, operators: [
    {multi: 1, tl: 24, ar: 31, d1r: 10, sl: 8, rr: 10},
    {tl: 127}, {tl: 127}, {tl: 127},
  ]});
  return output;
});

// Change this phrase and Apply. To change the prepared voice, press Run.
liveLoop('prepared-phrase', async ctx => {
  await ctx.playOutput(lead, ctx.cycle(['C4', 'E4', 'G4']), {duration: 0.5});
});
