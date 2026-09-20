# Tetorica MIDI Playground — Getting started

日本語の手順は FILES の README_jp.md を開いてください。

Play GarageBand instruments with JavaScript.
Tetorica sends MIDI performance messages; GarageBand produces the audio.

## What you need

- An Apple Silicon Mac (for this release)
- GarageBand
- The Tetorica MIDI Playground app

The packaged app does not require Node.js or Rust.

## 1. Create a virtual MIDI bus on your Mac

Open Audio MIDI Setup. If you cannot find it, search for “Audio MIDI” in
Spotlight, or run this command in Terminal:

    open -a "Audio MIDI Setup"

1. Choose Window → Show MIDI Studio.
2. Double-click IAC Driver.
3. Enable “Device is online”.
4. Use + in the port list to add a bus named “Tetorica Notes”.

You create this name yourself. Apps named Tetorica or GarageBand do not
appear here automatically. One bus is enough for this sound test.

## 2. Prepare GarageBand

1. Create an Empty Project.
2. Add a Software Instrument track.
3. Choose a sound, such as a piano.
4. Keep that instrument track selected.

You do not need to press Play or Record in GarageBand.

## 3. Send a test note from Tetorica

1. Open “MIDI settings” at the top right.
2. Click “Refresh ports”.
3. Under “Note output”, select the port containing “Tetorica Notes”.
4. Click “Connect output”.
5. Click “Play C4 (250 ms)”.

If you hear a short note, the connection works! The test sends MIDI note 60
on channel 1. You do not need to connect Clock input for this test.

## 4. Play with JavaScript

Select “/index.js” in “Run file” and click “Run”, even with this guide open.
The default lead repeats until Stop. melody.js plays C, E, G, C. “loop.js” repeats until you click “Stop”.

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

- Check “Device is online” in IAC Driver, then click Refresh ports.
- After selecting an output, make sure you clicked Connect output.
- Select the Software Instrument track in GarageBand.
- Check track mute, volume, and your Mac's audio output device.
- If GarageBand was open before you set up IAC, restart GarageBand.
- Check the status bar and Console in Tetorica for errors.

## Scope of this experimental release

Scripts use internal BPM. They do not automatically follow GarageBand's tempo.
The MIDI tab's Clock test and code execution are still separate.
FM synthesis, audio output, effects, Monaco, and external-clock-driven code
execution are not included yet.
Only run JavaScript whose contents you have reviewed and trust.

When finished, click Stop, then Disconnect in MIDI settings.


## Run file

Run executes the script selected in **Run file**, independently of the file open in the editor. The default is `/index.js`, a single-channel E minor pentatonic lead loop. You can read this guide while running it. To run `melody.js` or `loop.js`, select it in **Run file** first. Existing saved scripts are preserved.

`scale(root, name, octaves)` supports major, minor, majorPentatonic and minorPentatonic. `cycle(values)` cycles through values; counters are shared within a Run. Use `cycle("lead", values)` to give a pattern its own counter. Run resets counters. `nextBeat()` waits for the next internal beat boundary shared by this Run. Select `/lead.js` to try the new default in an existing project.

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
Use callback helpers for independent cycle counters and cancellation across await. Each cycle call slot advances once per iteration; named cycle keys are also local to the loop. Replacing a loop with the same name resets its counters and cancels the old scoped helpers. Stopping a scoped loop releases its owned notes immediately through MIDI. If another loop retriggers the same channel/note, the latest sender owns it; stopping the old loop does not cut off that note. Global play calls have no loop owner. The Stop button releases all notes. Legacy callbacks using global helpers stop only at the iteration boundary and retain shared cycle counters. Run still restarts everything.

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
