# Tetorica MIDI Playground — Getting started

日本語の手順は FILES の README_jp.md を開いてください。

Play GarageBand instruments with JavaScript.
Tetorica sends MIDI performance messages; GarageBand produces the audio.

## What you need

- A Mac and the app build matching its architecture
- GarageBand
- The Tetorica MIDI Playground app

The packaged app does not require Node.js or Rust.

## 1. Prepare GarageBand

1. Open GarageBand and create an Empty Project.
2. Add a Software Instrument track and select a sound such as a piano.
3. Keep that track selected. You do not need to press Play or Record.

## 2. Choose a MIDI output

1. Open Tetorica's **MIDI settings** and click **Refresh ports**.
2. In **Choose MIDI output**, select GarageBand's virtual input if it appears.
3. Selection connects automatically. Check the green connection label and destination name.

Clock input is optional and is not needed to play scripts.

## 3. Test sound

Click **Test sound — Play C4**. This sends note 60 on channel 1 for 250 ms.
A connected port does not guarantee sound: GarageBand must have an instrument track selected.

### Alternative: IAC bus

If GarageBand's virtual input is unavailable, you can use an IAC bus.
Open Audio MIDI Setup → Window → Show MIDI Studio → IAC Driver.
Enable **Device is online**, add a bus named **Tetorica Notes**, then select
that bus as Tetorica's output. Audio MIDI Setup is unnecessary when the
GarageBand virtual input is available.

## 4. Play with JavaScript

Select “/index.js” in “Run file” and click “Run”, even with this guide open.
The default lead repeats until Stop. `examples/melody.js` plays C, E, G, C. `examples/05_live_loop.js` repeats until you click “Stop”.

    setBpm(120);
    await play("C4", { duration: 0.5 });
    await play("E4", { duration: 0.5 });
    await play("G4", { duration: 1 });

- duration: length in beats (0.5 is an eighth note). play waits for that length.
- channel: MIDI channel 1–16; defaults to 1.
- velocity: strength 1–127; defaults to 90.
- await beat(1): rest for one beat.
- log("hello"): print to Console.
- Run: stop all loops and execute the code from the beginning.
- Stop: stop execution and release notes.
- Cmd+Enter: Run / Shift+Escape: Stop.

The README files are instructions and cannot be run.

## Save your work

Edited code is saved automatically inside the app.
Use “Export file” to keep a separate backup.
Use “Import” to add a JavaScript file. Imported files do not run automatically.

## If you hear nothing

- Open GarageBand first, then click Refresh ports. If using IAC, check “Device is online”.
- Check the connection label and destination. Use Reconnect output to retry.
- Select the Software Instrument track in GarageBand.
- Check track mute, volume, and your Mac's audio output device.
- If GarageBand was open before you set up IAC, restart GarageBand.
- Check the status bar and Console in Tetorica for errors.

## Scope of this experimental release

Scripts default to internal BPM; see External beat clock below. They do not automatically follow GarageBand's tempo.
The MIDI tab's Clock test and code execution are still separate.
FM synthesis, audio output, effects, Monaco, and external-clock-driven code
execution are not included yet.
Only run JavaScript whose contents you have reviewed and trust.

When finished, click Stop, then Disconnect in MIDI settings.


## Run file

Run executes the script selected in **Run file**, independently of the file open in the editor. The default is `/index.js`, a single-channel E minor pentatonic lead loop. You can read this guide while running it. To run `examples/melody.js` or `examples/05_live_loop.js`, select it in **Run file** first. Existing saved scripts are preserved.

`scale(root, name, octaves)` supports major, minor, majorPentatonic and minorPentatonic. `cycle(values)` cycles through values; counters are shared within a Run. Use `cycle("lead", values)` to give a pattern its own counter. Run resets counters. `nextBeat()` waits for the next internal beat boundary shared by this Run. Select `/examples/lead.js` to try the new default in an existing project.

Timing: changing BPM preserves the current beat position and updates pending nextBeat waits. A call exactly on a boundary waits for the following beat. Worker timers may run late; this is not sample-accurate timing or external MIDI Clock synchronization.

## Loop-local helpers

```js
liveLoop("lead", async ({play, beat, cycle, nextBeat}) => {
  await nextBeat();
  await play(cycle(["E4", "G4", "B4"]), {duration: 0.08});
  await beat(0.04);
});
// Elsewhere in your script:
// stopLoop("lead");
// stopAllLoops();
```
Use callback helpers for independent cycle counters and cancellation across await. Each cycle call slot advances once per iteration; named cycle keys are also local to the loop. Replacing a loop with the same name resets its counters and cancels the old scoped helpers. Stopping a scoped loop releases its owned notes immediately through MIDI. If another loop retriggers the same channel/note, the latest sender owns it; stopping the old loop does not cut off that note. Global play calls have no loop owner. The Stop button releases all notes. Direct inline zero-argument block callbacks in the Run file now bind loop helpers automatically; callbacks defined elsewhere still need explicit helpers. Run still restarts everything.

## Music helpers

```js
for (const note of chord("E4", "minor7")) {
  await play(note, {duration: 0.25, velocity: randInt(70, 100)});
}
```

- `chord(root, name)`: major, minor, major7, minor7, dominant7.
- `rand()`: 0 <= value < 1.
- `rrange(min, max)`: random interpolation between two values.
- `randInt(min, max)`: integer between ceil(min) and floor(max), inclusive.
- `lerp(a, b, t)`: linear interpolation; t is not clamped.
`chord` returns note names, not automatic simultaneous playback. Generated notes must fit MIDI 0–127. Invalid numeric ranges/values throw. These helpers also appear in loop callback arguments. `noteLerp(from, to, t)` returns the nearest integer MIDI note, ready for `play`. It accepts note names or MIDI numbers. Halfway values round upward; t is not clamped, but out-of-range results throw before rounding. This differs from the FM pitch-object return value and does not send Pitch Bend. Unlike the FM version (seconds, channel 0-based), MIDI `play` uses duration in beats and channels 1–16.

## FM / MIDI API differences

| API | MIDI Playground |
| --- | --- |
| `play` | duration in beats (default 0.5), channel 1–16 (default 1), velocity 1–127 (default 90) |
| `beat(count = 1)` | 0 < count <= 1024; global: captures BPM; loop-local: follows BPM changes |
| `nextBeat()` | shared internal beat boundary; pending wait follows BPM changes |
| `scale(root, name, octaves = 1)` | four documented scales; octaves must be an integer 1–11; every note must fit MIDI 0–127 |

FM `play` uses seconds (default 0.2) and zero-based channels. In internal mode, MIDI play converts to rounded milliseconds and accepts 1–10000 ms, with duration <=128 beats. Sending failure rejects the call. Pending play and global beat waits keep their original duration after a BPM change. Scoped beat/nextBeat use a per-loop beat cursor and follow tempo changes while waiting. Each wait starts from the later of the loop cursor and current beat; missed beats are not replayed. Timer lateness is still possible; no sample-accurate timing is guaranteed. MIDI scale accepts integer MIDI roots as well as note names and validates octave counts more strictly than FM. These are compatibility differences, not full API parity.

## Keyboard input

```js
onKeyboardPressKey("piano", async (event) => {
  const notes = {KeyA: "C4", KeyS: "E4", KeyD: "G4"};
  if (notes[event.code]) await play(notes[event.code], {duration: 0.25});
});
onKeyboardReleaseKey("piano", (event) => log("Released", event.code));
```
Press Run, click **Keyboard input** above the editor, then press A/S/D. Only this focused area forwards keys; typing in the editor does not play notes. Tab/Escape and Ctrl/Alt/Command shortcuts are excluded. Losing focus sends releases for forwarded held keys. Events contain key/code/type/repeat and modifier flags, not DOM methods. Repeated keydown events are ignored. A handler skips new events while its async callback is busy. Names replace handlers of the same event type; at most 32 handlers. Stop terminates the Worker and registrations; Run starts fresh. These callbacks play duration-based notes, not hold-to-sustain notes.

## FILES modules

```js
// notes.js (add this file to FILES using Import)
export const notes = ["E4", "G4", "B4"];
```

```js
// index.js (Run file)
const {notes} = await import("./notes.js");
for (const note of notes) await play(note, {duration: 0.25});
```

The Run file uses `await import()` with a literal relative path. Imported `.js`/`.mjs` modules can use static imports, re-exports and dynamic imports with `./` or `../` paths inside FILES. Include the extension. Each module is evaluated once per Run; edits take effect on the next Run. All referenced files are resolved before execution, including conditional imports.

Pass music helpers as function arguments when a module needs them; modules do not inherit the Run file’s `play`, `beat`, etc. Circular imports, computed paths, npm/external URLs, import attributes and `import.meta` are not supported. Import nesting is limited to 64. Run files cannot use static imports or exports.

## Editor

Monaco provides JavaScript highlighting, search (Command/Ctrl+F), completion (Ctrl+Space), and per-file undo and cursor history. MIDI helper suggestions describe this app’s API. Guides remain read-only. Command/Ctrl+Enter runs the selected Run file; Shift+Escape stops. Editor assets are bundled locally, with a textarea fallback if loading fails. JavaScript type/syntax diagnostics are disabled because Run files execute inside an async function with injected helpers. Cross-module type resolution is not provided.

Completion uses ECMAScript built-ins and MIDI helpers; browser Window/DOM globals such as screenLeft are excluded. Local variables and standard JavaScript methods remain available.

## External beat clock (trial)

Connect a Clock input in MIDI settings, select **External MIDI (trial)**, then press Run before sending MIDI Start or Continue. Scripts wait for that message. `beat` and `nextBeat` follow incoming pulses (24 per beat); `setBpm` does not change these waits. External play duration follows Clock pulses; see the timing limits below.

MIDI Stop, a repeated Start, or a one-second Clock gap ends the Run and releases notes. Press Run again before restarting the sender. Continue can start a newly armed Run, but does not resume a stopped script. Changing ports or the clock mode also stops the Run. This experimental path still needs DAW timing verification.

## Apply and loop context

**Run** resets everything. **Apply** re-evaluates the selected Run file in the current Worker while preserving BPM and beat phase. Same-name loops are replaced and their scoped notes released; their cycle counters restart. Other loops continue, including loops removed from the new source: use stopLoop(name) to stop them. Top-level code executes again; its lexical variables are fresh. Apply is skipped with a Console message while a previous evaluation is still awaiting completion. Errors still stop the Run.

Direct inline `liveLoop("lead", async () => { ... })` callbacks in the Run file now receive lexical play/beat/nextBeat/cycle bindings, isolated across awaits. Explicit callback parameters and top-level local declarations are preserved. Helper functions defined elsewhere, imported modules, aliases and expression-body callbacks should continue to receive scoped helpers explicitly. This is not general asynchronous context propagation.

External `play` now schedules native Note Off by Clock pulse count: durations are rounded up to 1/24 beat, at most 128 beats. BPM/setBpm does not control external note length. A tempo change during a held note changes its remaining wall-clock length. The Worker wait starts after the MIDI acknowledgement; IPC and timer delays can make script continuation later than native Note Off. Stop, timeout and repeated Start still terminate the Run.

## Keyboard tab: audition before coding

Select a MIDI output (for example GarageBand), then open **Keyboard**. No Run or script is needed. Click/hold the displayed keys or use the corresponding number and letter rows. Releasing a key sends Note Off. Choose MIDI channel 1–16 and velocity 1–127. Multiple notes can sound on one channel. Instrument/fret controls change the FM Playground fingering layout; select the sound in your DAW.

Switching tabs, changing the channel/layout, leaving the window, Release notes or Stop releases held keyboard notes. Keyboard input above the Code editor is a separate script-event facility. For overlapping notes on the same MIDI channel/pitch, the latest sender owns the note; an earlier release cannot stop its replacement.

## Built-in YM2612 audition (macOS trial)

No DAW is required: open **MIDI connections**, enable **YM2612 + Sega PSG**, then choose **Tetorica YM2612** in MIDI settings. Play in Keyboard or Run your script. The other port is **Tetorica Sega PSG**. YM2612 shares six FM voices across MIDI channels 1–16. Sega PSG shares three square-wave voices across CH1–9 / 11–16; CH10 plays one fixed white-noise voice (any note number). PSG low notes clamp at about 109 Hz. Mixer provides source volume, pan, mute and master volume. Audio uses the default macOS output at enable time. Disable/re-enable after changing devices, then reconnect the MIDI output. Preset file import, sustain and pitch bend are not supported yet.

## Multiple outputs and channels (trial)

Choose `/examples/01_multi_output.js` in Run file and press Run. It enables the native sound rack and plays YM2612 CH1/CH2 plus Sega PSG without a DAW or a manually selected output.

```js
await enableSoundChip("ym2612");
await enableSoundChip("sega-psg");
const piano = midi.output("tetorica-ym2612", { channel: 1 });
const bass = midi.output("tetorica-ym2612", { channel: 2 });
const lead = midi.output("tetorica-sega-psg", { channel: 1 });
liveLoop("piano", async () => {
  piano.play("C4", { duration: 0.4 });
  await beat(0.5);
});
```

`midi.output()` creates a handle synchronously. Its connection opens on the first `play()`, and handles using the same port share the connection. Names of external MIDI ports are also accepted; missing or ambiguous names are errors. Channels are 1–16 (default 1) and belong to the handle. `play()` uses beats for duration and returns a Promise that resolves after the note duration; awaiting it is optional, and failures are reported in Console and stop the run. At most 16 additional script output connections are allowed. The MIDI panel shows their count separately from the selected Keyboard/global-play output.

`enableSoundChip()` currently starts the shared YM2612 + Sega PSG rack even if only one chip is requested. Repeated calls preserve existing sound/settings. Per-chip enable is not implemented yet. Stop releases script connections/notes but keeps the rack enabled. Changing the MIDI-panel Enable setting stops playback first. To audition with Keyboard afterward, select its output in MIDI settings.

Direct inline, zero-argument, block-body `liveLoop` callbacks automatically bind calls such as `piano.play()` for locally declared `midi.output()` handles to their loop owner. For explicit callbacks or imported helpers, pass the loop-local helper:

```js
liveLoop("bass", async ({playOutput, beat}) => {
  playOutput(bass, "C3", {duration: 0.8});
  await beat(1);
});
```

Aliased handles or calls hidden in imported functions are not automatically rewritten. Use `playOutput` to retain individual loop cancellation and note ownership. Global handle calls have whole-Run lifetime. YM2612 uses the patch assigned to each channel in the YM2612 tab. External applications need their own channel routing.

## YM2612 channel patch editor

Open **YM2612**, choose **MIDI channel**, edit Algorithm / Feedback and the four operators, then click **Apply patch to channel**. Play a new note on the same channel using Keyboard or `midi.output(..., {channel})`.

The editor supports multiplier, detune (raw register value), total level, rate scaling, attack/decay/sustain/release rates and sustain level. Higher TL means quieter; MULTI 0 means ½. Velocity changes carrier level according to the algorithm. Six physical voices remain shared across all channels.

Apply affects the next Note On only; held notes retain their patch. Stop and rack disable/enable preserve channel patches during this app session. App restart resets patches. Switching channels or Reload discards un-applied edits. Preset file saving/loading, LFO, AM, PMS/AMS and SSG-EG are not implemented in this editor yet.

## MIDI output assignments

In **MIDI connections → Script output assignments**, assign `MIDI_OUTPUT_01` through `MIDI_OUTPUT_04` to internal sound IDs or external MIDI ports. Then use the identifier without quotes:

```js
const piano = midi.output(MIDI_OUTPUT_01, {channel: 1});
const bass = midi.output(MIDI_OUTPUT_01, {channel: 2});
```

Assignments are saved locally. Changing one stops playback; press Run again. Each Run takes a snapshot, also used by Apply. Unused slots may remain unassigned. Using an unassigned slot is an error when creating its handle. External devices are saved by ID and name; missing/renamed devices require reassignment, with no name-based fallback. Device availability is checked again on first play. Internal destinations still require `await enableSoundChip(...)` or manual Enable.

`/examples/02_assigned_outputs.js` runs with internal destinations by default. Its comments explain how to switch to assigned slots after configuring them in MIDI connections. Channel defaults to 1. Keyboard and global `play()` still use their existing output selector.

## Completion and JSDoc

Open `examples/03_context_jsdoc.js` and select it as **Run file** to try the built-in YM2612 example without a DAW. The editor completes `piano.play()`, play options, sound chip IDs and `MIDI_OUTPUT_01`–`04`.

`context` in this example is the loop helper parameter in `liveLoop("name", async context => { ... })`. It differs from the global shared state `context` / `pg.context`. Use `context.playOutput(instrument, note, options)` in imported helpers or callbacks with explicit parameters to keep notes attached to that loop.

For your own functions, use JSDoc types `MidiOutput`, `MidiPlayOptions`, `MidiNoteOptions`, `MidiNote`, and `TetoricaContext`. `@param`, `@returns` and `@typedef` support completion and hover. Relative JavaScript imports in FILES are available to the editor even before opening their tabs. This does not add npm package imports or runtime type validation. DOM globals such as `screenLeft` are excluded. The plain-text editor fallback has no completion.

## Examples in FILES

Open an example, select its path in **Run file**, then press **Run**. Use **Stop** to end loops. No DAW, output selection or manual Enable is needed for the built-in examples. Existing edited examples are preserved when new examples are added.

| File in `examples/` | What to try |
| --- | --- |
| `04_first_note.js` | Start here: one FM note; change pitch, duration or velocity. |
| `lead.js` | E minor pentatonic lead using the selected MIDI output. |
| `melody.js` | C, E, G, C in sequence using the selected MIDI output. |
| `05_live_loop.js` | Repeating melody with a gap. Edit and Apply while playing. |
| `06_multi_channel.js` | Two parts on YM2612 CH1 and CH2; edit their patches in the YM2612 tab. |
| `01_multi_output.js` | YM2612 and PSG together, using fixed internal IDs. |
| `10_context_init.js` | JSDoc-typed shared state: retain the initialized MIDI output and evaluation count across Apply. |
| `03_context_jsdoc.js` | Loop context and a reusable function with JSDoc types. |
| `02_assigned_outputs.js` | Built-in outputs by default; comments show how to switch to slots. |
| `07_external_output.js` | Requires a running MIDI receiver and replacing the placeholder port name. |
| `08_output_slots.js` | Requires assigning slots 01 and 02 in MIDI connections first. |

The last two examples deliberately demonstrate external setup. Port names are not track names; separate instruments on separate channels depend on the receiver. The built-in YM2612 shares six voices across all MIDI channels. PSG has three tone voices and a noise voice on CH10; its example uses G4 on a tone channel.

## Reusable libraries

Open `lib/README.md` in FILES for the module guide, or run `examples/09_library.js` to try it without a DAW. `lib/phrase.js` exports `playPhrase(context, output, notes, options)` with JSDoc completion. The example uses `await import("../lib/phrase.js")` and passes its liveLoop context explicitly so cancellation follows the loop. Imported modules do not inherit the Run file's local helpers. Library code is editable and saved edits are preserved.

Use `pg.` to browse the MIDI API, for example `pg.midi.output(...)`, `pg.play(...)`, and `pg.liveLoop(...)`. `context` and `pg.context` refer to the same user-defined state object: Apply preserves it and Run resets it. Inside an explicit `liveLoop` callback, its parameter (often named `context`) is the loop helper API, not the shared state; use `context.pg` for scoped API calls and `context.context` for shared state. Parameterless inline callbacks automatically scope `pg` to their loop.

### Retain initialization with context

`examples/10_context_init.js` adapts the YM2612 Playground's `pg-context-init` example. It defines `ContextInitState` with JSDoc `@typedef` and annotates `pg.context` with `@type`. Try `state.` for `instrument` and `hitCount`, then `state.instrument.` for `play`.

Choose the example as Run file and press **Run** to initialize the built-in YM2612 and play C, E, G. After playback, press **Apply**: the saved MIDI output is reused and the evaluation count increases. Edit the notes and Apply again to keep the initialization. Console prints `Initialized pg.context.` only once and `Evaluation count:` on every evaluation. **Run** starts fresh at count 1. This state does not persist across Stop or app restarts. JSDoc provides editor types, not runtime validation.
