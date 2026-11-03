# Local virtual Git engine

`git.bundle.js` and `GIT_LICENSES.txt` are copied without modification from
`hello_ymfm/docs/js/tetorica_virtual_files/` (the FM2612 Playground distribution).
The shared source is `hello_ymfm/packages/virtual-files/src/git.js` and is built
with that package's build script. Keep the bundle and license notice together.

Source checkout: `a37bca5904687eabe10ce0a775ba4b82b91ec055`.
Copied SHA-256 values:

- `git.bundle.js`: `48bf6973ab36ecb1824c4b52c9e958d1d626b6796a47c0cf4d9b9e5f34ef89d1`
- `GIT_LICENSES.txt`: `1eaf635e98c5d8149cfae1089503c7fa67ced1e23830e67164f2f3c4765b1c3e`

The bundle includes isomorphic-git, Buffer, diff and the shared virtual filesystem.
MIDI Playground's `project-git.js` exposes only local operations and does not supply
HTTP or native remote credentials. Files, staged data and history stay in the
project's virtual filesystem; this engine never invokes host Git.
