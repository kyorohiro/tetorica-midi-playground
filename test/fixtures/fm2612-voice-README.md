fm2612-bell.json is the unchanged `two-op-bell` preset from hello_ymfm/web/megadrive-fm-presets.js (BSD license, see ui/shared/LICENSE), copied 2026-09-22.
TFI and VGI fixtures were exported with the upstream web/tfi.js and web/vgi.js converters. The TFI exporter receives one-based operators; the VGI exporter receives the original zero-based array.
The .syx fixture is the MIDI Playground v1 wire encoding of that preset with all-channel target. Both JavaScript tests and the Rust receiver use it to detect mismatched layouts.
