Unmodified snapshots from hello_ymfm: docs/playground/playground_ui.js, playground_file_tree.js, and docs/js/playground_execution.js. Copied 2026-09-20 to keep this repository standalone. UI layout/colors are adapted from docs/playground/index.html. Preserve LICENSE when updating.

Keyboard fingering controls/layout: synth_keyboard.js and pitch.js copied from hello_ymfm docs/synth and docs/js (same project BSD license). synth_keyboard.js imports the local pitch.js. MIDI audition and native note ownership are implemented separately.

TFI/VGI parsers: tfi.js and vgi.js copied unchanged from hello_ymfm/web on 2026-09-22 (same BSD license). MIDI voice normalization lives in ../ym2612-voice.js; it handles the parser's one-based operator indexes and preserves raw detune, AM and B4 without forcing Preset Objects through the TFI exporter.
