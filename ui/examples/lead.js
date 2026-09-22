liveLoop("lead", async () => {
  const notes = scale("E4", "minorPentatonic", 2);
  //await nextBeat();
  await play(choose(notes), {
    duration: 0.08,
  });
  await beat(cycle([0.04, 0.04, 0.08]));
});
