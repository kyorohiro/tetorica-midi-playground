# Sega PSG

Vendored from hello_ymfm src/segapsg.cpp and src/segapsg.h, under the repository BSD-3-Clause license (included). This is the same core used by the Browser Sega PSG engine. The copy keeps this application independently buildable. Update both files together when syncing upstream.

Local extension: per-voice software stereo pan (`set_pan`) for MIDI CC10. Default center preserves the original mono mix. This is a playback feature, not an emulated PSG register. Preserve or reconcile this addition when syncing upstream.
