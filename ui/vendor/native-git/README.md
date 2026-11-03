# Native Git dependency notices

`GIT_NATIVE_LICENSES.txt` starts with the dependency notices copied from
`w/tetorica-fm2612-playground-tauri/desktop/git-licenses.txt` in the Tetorica
workspace. The HTTPS transport, native token dialogs, and OS credential-store
integration were adapted from that application.

The MIDI port uses the versions locked in `src-tauri/Cargo.lock` on 2026-11-03.
The parent notice file was compared against every crate version added to the
MIDI lockfile by this port. The appendix supplies license and notice files from
the locally cached, matching crate sources for the 24 additional versions not
listed in the parent notice file. The copied section also covers some crates
already present in MIDI Playground before this port.

These notices are a snapshot, not an automatic dependency inventory. Review and
update them when the locked native Git dependencies change. The frontend vendor
directory is included in the Tauri application resources by `frontendDist`.
Only the macOS build was compiled locally; retaining the parent platform modules
does not constitute Windows or Linux build verification.
