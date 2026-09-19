Tetorica MIDI Playground — Agent Guide

Project Goal

Tetorica MIDI Playground is a JavaScript live coding environment for controlling music software and devices.

The project extends the live coding / algorithmic music concepts developed in Tetorica FM2612 Playground to external MIDI and audio environments.

Reference:

https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html

The first target platform is macOS.

Initial Goals

Implement the minimum infrastructure required to connect Tetorica live coding with professional music environments.

Initial priorities:

1. MIDI Clock synchronization
2. MIDI output
3. Audio output
4. MIDI input (optional)

The first implementation target is macOS using:

* CoreMIDI
* CoreAudio
* Tauri

First Milestone

Create a minimal Tauri application and verify communication with an external DAW.

Target flow:

DAW
 |
 | MIDI Clock
 v
Tetorica MIDI Playground
 |
 | JavaScript live coding
 |
 +---- MIDI OUT ----> DAW / MIDI device
 |
 +---- Audio OUT ---> CoreAudio

For the first connection test:

1. Create a minimal Tauri application.
2. Enumerate available MIDI inputs and outputs.
3. Receive MIDI Clock messages from a DAW.
4. Detect Start / Stop / Timing Clock.
5. Send MIDI Note On / Note Off to a selected MIDI output.
6. Confirm that a DAW or external MIDI device receives the messages.
7. Add CoreAudio output after MIDI communication is working.

On macOS, IAC Driver may be used for initial inter-application MIDI testing.

Architecture

Keep the JavaScript live coding runtime independent from macOS APIs.

Do NOT expose CoreMIDI or CoreAudio concepts directly to user scripts.

Prefer platform-independent boundaries such as:

interface MidiInput {}
interface MidiOutput {}
interface AudioOutput {}
interface ClockSource {}

Platform-specific implementations should live behind these interfaces.

Conceptually:

JavaScript Live Coding Runtime
          |
          v
Platform-independent I/O API
          |
          +---- macOS
          |      CoreMIDI
          |      CoreAudio
          |
          +---- Windows (future)

The architecture should allow a future Windows backend without redesigning the JavaScript API.

Live Coding Runtime

The existing Tetorica FM2612 Playground contains concepts such as:

* liveLoop()
* beat()
* tween()
* choose()
* algorithmic music helpers

These concepts should eventually work independently of the sound generator.

For example, a liveLoop() may control:

* MIDI output
* internal sound generation
* external hardware
* future VST instruments/effects

The clock used by beat() must eventually be replaceable.

Possible clock sources:

InternalClock
MidiClock
FutureClockSource

Do not tightly couple beat() or liveLoop() to CoreMIDI.

Future Direction

The project may eventually become a VST host.

Possible future capabilities include:

* Load VST instruments
* Load VST effects
* Control VST parameters from JavaScript
* MIDI routing
* Audio routing
* Serial and parallel effect chains
* Dynamic routing from live coding
* Control external MIDI hardware
* AI/MCP control of the live coding environment

Example future concept:

const synth = await vst.load("synth.vst3");
const reverb = await vst.load("reverb.vst3");
route(synth)
  .to(reverb)
  .to(audio.output());
liveLoop("lead", async () => {
  // JavaScript controls the music environment.
});

This is future work. Do not implement a VST host as part of the initial milestone.

Sound Chips

Sound chip support is under consideration.

YM2612 and other sound chips are not architectural requirements for the MIDI layer.

If sound chips are added, treat them as optional sound generators connected to the same runtime.

Do not design the MIDI architecture specifically around YM2612.

Non-Goals for the Initial Milestone

Do NOT:

* Build a DAW.
* Implement a VST host yet.
* Implement Windows support yet.
* Build a large music abstraction layer.
* Couple the runtime to YM2612.
* Create complex UI.
* Add unnecessary high-level music APIs.
* Reimplement functionality already provided by CoreMIDI/CoreAudio without a concrete reason.

Focus on reliable low-level connectivity first.

Development Principle

Prefer small, verifiable steps.

For every platform integration:

1. Make the smallest connection work.
2. Add a reproducible test.
3. Verify timing and behavior.
4. Only then expose it to the JavaScript runtime.

The first important success condition is:

A DAW sends MIDI Clock to Tetorica, Tetorica synchronizes to it, and Tetorica sends MIDI notes back to a DAW or MIDI device.

Everything else can grow from that foundation.