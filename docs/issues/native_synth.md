# Native YM2612 + Sega PSG audition rack (macOS trial)

## Try it

1. Restart `npm run dev` (native code changed).
2. Open **MIDI connections**, enable **YM2612 + Sega PSG**. The default macOS audio output is chosen at enable time.
3. Open **MIDI**, select **Tetorica YM2612** as output; it connects automatically.
4. For PSG, select **Tetorica Sega PSG** instead. Use Keyboard CH10 for noise. Open **Keyboard** and play, or press Run. No GarageBand or IAC setup needed.
5. YM2612 / Sega PSG tabs show held MIDI channels. Mixer controls source volume, pan, mute and master volume.
6. Stop releases script notes and resets the internal synths. Mixer Panic resets internal voices; running scripts may send new notes afterward.
7. Disable the synth before changing audio devices; re-enable to use the new default output. Disabling destroys the MIDI ports; refresh and reconnect the output after re-enabling.

YM2612 has six FM voices shared by all 16 MIDI channels. Sega PSG has three square-wave voices shared across CH1–9 / 11–16, plus a monophonic white-noise voice on CH10. Noise uses fixed clock/32 mode; all note numbers trigger the same noise. PSG velocity maps to 2dB attenuation steps. Tone periods clamp to 1–1023 (low notes below about 109 Hz cannot be reproduced). Same-pitch/channel retrigger replaces the old note. When full, the oldest held voice is stolen. Release tails can be cut when a voice is reused. Unsupported sustain, pitch bend and program-change messages are ignored.

## Architecture

`MIDI output → CoreMIDI virtual input → bounded queue → Rust voice allocation → native C++ ymfm (resampling + DC removal) / SegaPSG → source mixer → CPAL → Core Audio`

The audio callback owns the chips and allocates no per-buffer PCM arrays. MIDI and settings are passed through a bounded nonblocking queue / atomics; UI polls atomic status at 5 Hz. Source gains are smoothed and the final output is clipped to [-1, 1]. This is an audition instrument, not a mastering resampler/limiter. Very low/high MIDI pitches are subject to YM2612 frequency limits. CC120/123 are channel-local; panic resets both chips.

Sources are vendored in `src-tauri/vendor/ymfm` and `src-tauri/vendor/segapsg`, with provenance and BSD-3-Clause license. The bundled UI includes the license in Mixer. `cc` builds OPN, its dependencies and the existing Browser Sega PSG core. `synth_core.rs` has no device/UI dependency; `test_synth.rs` owns CPAL and virtual MIDI ports. Browser audio/WASM is not used.

## Validation

`npm test` includes headless PCM tests (44.1/48/96 kHz), ownership/channel/port separation, mute/pan, queue overload and stop/new-note ordering. These do not establish actual device playback, GUI rendering or callback deadline performance. CoreMIDI service-dependent tests remain opt-in. Windows virtual port creation and native audio integration are not implemented for this rack.

## Future audio routing

The current output is the stereo mix, channels 1/2 of the default device. A virtual audio driver can carry this to another application; it does not turn the Playground itself into a Core Audio device. Separate FM/PSG tracks in GarageBand require a later multichannel output option before mixing. No virtual audio driver is bundled or installed.

## YM2612 channel patch editor

Open **YM2612**, choose **MIDI channel**, edit Algorithm / Feedback and the four operators, then click **Apply patch to channel**. Play a new note on the same channel using Keyboard or `midi.output(..., {channel})`.

The editor supports multiplier, detune (raw register value), total level, rate scaling, attack/decay/sustain/release rates and sustain level. Higher TL means quieter; MULTI 0 means ½. Velocity changes carrier level according to the algorithm. Six physical voices remain shared across all channels.

Apply affects the next Note On only; held notes retain their patch. Stop and rack disable/enable preserve channel patches during this app session. App restart resets patches. Switching channels or Reload discards un-applied edits. Preset file saving/loading, LFO, AM, PMS/AMS and SSG-EG are not implemented in this editor yet.
