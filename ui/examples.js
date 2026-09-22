import {bundledExamples} from './example-files.js';
export const leadExample = bundledExamples['/examples/lead.js'];

// Exact legacy contents identify untouched bundled files during migration.
export const legacyRootExamples = {
  "/lead.js": "liveLoop(\"lead\", async () => {\n  const notes = scale(\"E4\", \"minorPentatonic\", 2);\n  //await nextBeat();\n  await play(choose(notes), {\n    duration: 0.08,\n  });\n  await beat(cycle([0.04, 0.04, 0.08]));\n});\n",
  "/melody.js": "setBpm(120);\nfor (const note of [\"C4\", \"E4\", \"G4\", \"C5\"]) {\n  await play(note, { duration: 0.5 });\n}\nlog(\"Done\");\n",
  "/loop.js": "setBpm(120);\nliveLoop(\"melody\", async () => {\n  await play(choose([\"C4\", \"E4\", \"G4\"]), { duration: 0.5 });\n  await beat(0.5);\n});\n"
};
