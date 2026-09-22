setBpm(120);
for (const note of ["C4", "E4", "G4", "C5"]) {
  await play(note, { duration: 0.5 });
}
log("Done");
