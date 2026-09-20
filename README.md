# Tetorica MIDI Playground

## macOS connection experiment

The first Tauri/CoreMIDI experiment is available. It lists MIDI ports, receives
MIDI Clock/Start/Continue/Stop, displays tick position and estimated BPM, and
sends MIDI note 60 on channel 1 for 250 ms. The optional test pattern emits that
note at each received 24-clock boundary (first note after 24 ticks).

This is a connectivity experiment, not the full live-coding runtime. Audio,
`liveLoop`, arbitrary scripts, SPP/seek, predictive scheduling and Windows builds
are not implemented yet. BPM display is an interval estimate, not a PLL.

### Run

Install Node.js/npm, Rust and the macOS Xcode command-line tools first.
From this repository (`w/tetorica-midi-playground`):

```sh
npm ci
npm test
npm run dev
```

Build a local executable (installer/signing is not enabled):

```sh
npm run build -- --debug
# src-tauri/target/debug/tetorica-midi-playground
```

### Connect a DAW

1. In Audio MIDI Setup, open MIDI Studio, enable IAC Driver, and create two
   buses: `DAW Clock` and `Tetorica Notes`.
2. Configure the DAW to send MIDI Clock and transport to `DAW Clock`.
   Select that bus as the app's Clock input and click **Connect input**.
3. Select `Tetorica Notes` as Note output and click **Connect output**.
   Route that bus to a MIDI instrument track in the DAW. Enable monitoring.
4. Click **Play C4** and check that the DAW receives note 60, then Note Off.
   Octave labels vary between DAWs; note number 60 is the reference.
5. Start the DAW. Check `running`, `ticks` and `bpm`. Enable the quarter-note
   test to hear returned notes. Do not route the note bus back into the clock bus.
6. Test Stop/Continue, tempo changes and stopping Clock transmission. The test
   stops active notes on Stop or after one second without Clock. **Stop notes**
   also disables the pattern. **Disconnect** closes both connections.

The native worker checks deadlines every 2 ms; OS scheduling can delay it.
It follows received boundaries, does not compensate input/output latency, and
skips intermediate boundaries if the worker stalls rather than bursting notes.
The MIDI callback currently shares a short session lock with the worker. This
prototype does not guarantee real-time callback latency; a bounded event queue
is a next refinement before performance measurements or live runtime integration.
UI polling is only for display; Note Off deadlines are native.
Connection loss may require Disconnect/Refresh/Reconnect. No output is selected
or played automatically at launch. Use a dedicated test track/channel.

### Tests

```sh
npm test
# CoreMIDI integration test: creates its own private virtual port, not a DAW port
cargo test --manifest-path src-tauri/Cargo.toml --locked private_virtual_port_loopback -- --ignored
```

On 2026-09-20: four unit tests and the private CoreMIDI loopback test passed on
macOS. The loopback verifies MIDI bytes, not DAW timing or WebView interaction.
DAW recording/latency/jitter and actual UI operation still need manual verification.

`src-tauri/src/clock.rs` is platform-independent transport/tempo logic.
`main.rs` currently holds the small connection experiment and native note worker;
`NoteOutput` provides a fake-testable output boundary. `ui/` uses Tauri commands,
with no CoreMIDI timestamps or types exposed to JavaScript.

See [research and Windows interface notes](docs/issues/tauri_midi_feasibility.md).

## Project direction


A JavaScript live coding playground for MIDI, audio, and external music devices.

Tetorica MIDI Playground extends the live coding / algorithmic music environment currently developed for Tetorica FM2612 Playground to MIDI, CoreMIDI, and CoreAudio.

https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html

Goals

The first target is macOS.

* MIDI Clock synchronization
* MIDI output
* Audio output via CoreAudio
* MIDI input (optional)

The goal is to make it possible to write music and control external software or hardware directly from JavaScript.

DAW / MIDI Clock
       ↓
Tetorica MIDI Playground
       ↓
JavaScript
liveLoop / beat / tween / choose
       ↓
 ┌─────┴─────┐
MIDI OUT   Audio OUT
   ↓           ↓
DAW / MIDI   CoreAudio
devices

Output

Initial output targets:

* MIDI
* Audio
* Sound chips (under consideration)

Future

In the future, Tetorica MIDI Playground may also work as a VST host.

This would make it possible to load and control VST instruments and effects from JavaScript, including parameter control and audio/MIDI routing.

The current goal is not to replace a DAW.

The goal is to provide a programmable music environment where JavaScript can control MIDI, audio, sound devices, and eventually VST plugins.
