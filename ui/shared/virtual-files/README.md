Files copied unchanged from `hello_ymfm/packages/virtual-files/src` on 2026-11-03:
`filesystem.js`, `path.js`, `sync.js`, `reader.js`, `shell.js`, `pipeline.js`,
`agent_commands.js`, and `patch.js`. `LICENSE` is retained from
that package. MIDI Playground uses the memory filesystem with automatic file
checkpoints disabled; Sync and Revert are not part of its UI.

Application path protection, cassette limits, and JSON-safe binary conversion
live in `../../project-files.js`. Git integration is supplied separately.
`../../project-shell.js` executes commands on isolated drafts, protects app guides
and Git metadata, and disables the shared engine's snapshot/undo/diff commands.
The app does not invoke an operating-system shell or evaluate command text as JavaScript.
