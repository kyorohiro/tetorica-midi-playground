# itch.io release — macOS experimental build

## Build and package

On Apple Silicon macOS:

```sh
npm ci
npm test
npm run build
python3 scripts/package-macos.py
```

The ZIP under `release/` contains the `.app`, the English/Japanese GarageBand setup
guides, build information, and third-party sources/notices. Preserve executable
permissions (the script uses macOS `ditto`). Packaging refuses to replace an
existing staging directory. Move the previous package aside for a rebuild.

The packaging script applies an ad-hoc signature and verifies bundle integrity.
This is not Developer ID signing or notarization.

This initial build is arm64 only, not Windows or Intel macOS. It is not
Developer ID signed/notarized. Test a browser-downloaded copy on another Mac
before advertising installation as frictionless. Do not claim notarization.
For Developer ID signing and notarization, follow Tauri's distribution guide:
https://v2.tauri.app/distribute/sign/macos/

## itch.io page

Proposed project slug: `tetorica-midi-playground` (confirm destination).

- Title: Tetorica MIDI Playground
- Classification: Tools
- Kind of project: Downloadable
- Release status: Prototype
- Platform on the ZIP: macOS
- File display name: macOS Apple Silicon — experimental 0.1.0
- Start with a Draft page. Download the upload and test before changing visibility.
- Do not mark this upload as a browser-playable HTML game.

Page description draft:

> Live-code MIDI instruments in JavaScript on your Mac.
>
> Connect Tetorica to GarageBand through macOS IAC Driver, choose a software
> instrument, then run the included melody or loop example. The built-in
> README in FILES walks you through setup.
>
> Includes a JavaScript editor, Run/Stop, Console, MIDI port settings and local
> script storage. Requires an Apple Silicon Mac and a MIDI-receiving instrument
> app such as GarageBand. Tetorica itself does not generate audio.
>
> Experimental release: scripts use internal BPM. The external MIDI Clock
> monitor/test is separate from script execution. No Windows/Intel build or
> external-clock-driven scripts yet. This build is not notarized.

## Download test

1. Extract the ZIP and open the `.app`.
2. Confirm README.md appears beside melody.js and loop.js; Run is disabled there.
3. Follow README.md to set up IAC and GarageBand.
4. Connect Note output; run melody.js, then loop.js; verify Stop silences notes.
5. Rerun and disconnect while playing; verify no hanging notes.
6. Close/reopen and verify saved code survives and README remains present.

macOS archive guidance: https://itch.io/docs/itch/integrating/platforms/macos.html

## App icon

Source artwork: `assets/app-icon.png`. Regenerate platform icons with:

```sh
npm run icons
npm run build
```

The bundle icon paths are configured in `src-tauri/tauri.conf.json`.

## Developer ID builds (Intel and Apple Silicon)

Install the Developer ID certificate and private key in your Keychain.
Supply `APPLE_PASSWORD` through the environment (an Apple app-specific password).
The script does not store the password.

```sh
npm ci
npm test
rustup target add x86_64-apple-darwin aarch64-apple-darwin
# zsh: enter the password without displaying it or saving it in shell history.
read -rs 'APPLE_PASSWORD?Apple app-specific password: '
export APPLE_PASSWORD
bash deploy_mac.sh
unset APPLE_PASSWORD
```

The script invokes Tauri for each architecture and stops if a build fails.
Tauri uses the Apple environment variables for signing and notarization.
Outputs are `.app` bundles under
`src-tauri/target/<target>/release/bundle/macos/` by default.
Signed builds and Intel runtime behavior have not yet been verified here.

This script does not create upload ZIPs or publish to itch.io.
Do not use `scripts/package-macos.py` for these signed builds: it replaces the
signature with an ad-hoc signature. Release archives should preserve the signed
app and include the guides and third-party sources/notices described above.
