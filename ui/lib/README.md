# Libraries

Keep reusable JavaScript in FILES/lib. This is a convention, not a special runtime directory.
Start with `examples/09_library.js`: select it as Run file and press Run. It enables the built-in YM2612, imports `lib/phrase.js`, and repeats three notes. Stop ends the loop.

## Import a module

In `/index.js`:
```js
const { playPhrase } = await import("./lib/phrase.js");
```
In `/examples/09_library.js`:
```js
const { playPhrase } = await import("../lib/phrase.js");
```
Paths are relative to the importing file and include `.js` or `.mjs`. The Run file uses `await import(...)`; it cannot use static `import` or `export`. Imported modules can use static relative imports and exports. Circular imports, npm packages, remote URLs, computed import paths and `import.meta` are unsupported.

## Included helper: playPhrase

`await playPhrase(context, output, notes, options)` plays each note in sequence. `output` is a `midi.output(...)` handle. Notes are MIDI numbers or names; options are `duration` in beats and `velocity`. Defaults come from play: 0.5 beats and velocity 90. Empty notes play nothing. The module opens no connection by itself.

Pass the context received by `liveLoop` to the helper:
```js
liveLoop("phrase", async context => {
  await playPhrase(context, instrument, ["C4", "E4", "G4"], { duration: 0.5 });
  await context.beat(1);
});
```
Imported modules do not inherit the Run file's local helpers. Pass context and destinations as arguments; do not call a global `play` inside a module. `context.playOutput` keeps imported notes attached to the calling loop, including after awaits, so Stop/Apply can cancel them.

## JSDoc and editing

`lib/phrase.js` demonstrates `@param` and `@returns` with `TetoricaContext`, `MidiOutput`, `MidiNote[]` and `MidiPlayOptions`. Monaco resolves these through relative imports for completion and hover. These annotations do not change JavaScript at runtime.

Edit the bundled library in FILES and reuse it from your own examples. Saved library code and examples are preserved across app updates. The library README is a read-only bundled guide and is refreshed with the app. Select an example as Run file, not the module that exports functions.

FM2612 browser-specific helpers (operator control, sample playback and its `CH1` constants) are not provided by this module. Use MIDI output handles and the native YM2612/Mixer tabs. There is no VST host or DAW track discovery here.
