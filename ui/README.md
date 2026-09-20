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

Return to “Code”, select “melody.js” in FILES, and click “Run”.
It plays C, E, G, C. “loop.js” repeats until you click “Stop”.

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
