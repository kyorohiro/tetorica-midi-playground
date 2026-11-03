# Shared virtual Git engine

`git.bundle.js` and `GIT_LICENSES.txt` are copied without modification from
`hello_ymfm/docs/js/tetorica_virtual_files/` (the FM2612 Playground distribution).
The shared source is `hello_ymfm/packages/virtual-files/src/git.js`, built with
`npm run build:virtual-files`. Keep the bundle and license notice together.

Source base checkout: `77184264148b1835fcd3994142cec6a99c81f3fe`, with local Git clone support (2026-11-03).
Canonical `src/git.js` SHA-256: `31e096044b65a6eba0f3a31efd22e1e5b6f058716cdd9237cf0f40fe90277713`.
Copied SHA-256 values:

- `git.bundle.js`: `73d534801173e5a9afb2f6e88b4e2149d87c682823a1c1cff25ea989aa5e468f`
- `GIT_LICENSES.txt`: `1eaf635e98c5d8149cfae1089503c7fa67ced1e23830e67164f2f3c4765b1c3e`

The bundle includes isomorphic-git, Buffer, diff and the shared virtual filesystem.
MIDI Playground runs Git commands through its Shell. Its native adapter supplies
HTTPS transport and OS-stored credentials for remote operations. Files, staged
data and history stay in the project's virtual filesystem; this engine never
invokes host Git. Removing a remote retains local files, branches and commits.
Clone opens a remote as the single FILES project; an explicit `--replace` is
required to replace existing project files. Publication is atomic after validation.
