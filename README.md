Tetorica MIDI Playground

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
