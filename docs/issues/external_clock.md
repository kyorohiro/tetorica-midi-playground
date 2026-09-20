# External MIDI Clock synchronization

## Transport contract (first implementation stage)

- MIDI Clock is 24 pulses per quarter note. Musical position is derived from pulse count, not the displayed BPM estimate.
- Start (FA) resets position to zero and starts transport.
- Stop (FC) freezes position. Continue (FB) resumes at that position.
- Clocks received while stopped are ignored. Clock alone never starts playback.
- A gap of 1000 ms or more freezes transport with reason `timeout`. A new Start or Continue is required to resume. The pure state object accepts a different positive timeout for testing/future configuration.
- Disconnect freezes position and requires explicit Start/Continue after reconnection. A newly selected input should get a fresh state object.
- Tempo changes alter pulse spacing; they do not reset musical position.
- Only monotonic timestamps from the same clock domain are accepted. SPP/seek is not supported in this stage.

`ui/external-clock.js` implements and tests these rules independently of DOM, native MIDI, and Worker scheduling. It is not connected to playback yet. Existing playback still uses internal BPM.

## Next integration steps

1. Forward native transport events and timestamps to the script Worker; do not derive Clock events from the 100 ms UI snapshot poll.
2. Add explicit Internal / External clock selection. GarageBand note output can remain independent of the Clock input.
3. Release sounding notes on Stop, timeout, or disconnect. Cancel/freeze waits consistently; never emit a catch-up burst after a gap.
4. Specify how `play` note duration follows external tempo, including tempo changes after Note On. Native deadline-based Note Off currently uses a fixed millisecond duration.
5. Test Start during pending waits, Continue, input changes, and stale events from a previous Run. Then measure timing on a DAW capable of sending MIDI Clock.

Do not label this stage as completed external synchronization: event delivery, scheduling and Note Off integration remain outstanding.
