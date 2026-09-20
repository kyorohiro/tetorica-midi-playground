"""Package the native arm64 app, user guide and dependency source notices."""
import json, pathlib, subprocess, tarfile, shutil, hashlib
root = pathlib.Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
app = root / 'src-tauri/target/release/bundle/macos/Tetorica MIDI Playground.app'
if not app.is_dir():
    raise SystemExit('Run npm run build on Apple Silicon first.')
subprocess.run(['lipo', str(app / 'Contents/MacOS/tetorica-midi-playground'), '-verify_arch', 'arm64'], check=True)
subprocess.run(['codesign', '--force', '--deep', '--sign', '-', str(app)], check=True)
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
release = root / 'release'
release.mkdir(exist_ok=True)
stage = release / f'tetorica-midi-playground-{version}-macos-arm64'
if stage.exists():
    raise SystemExit(f'{stage} already exists. Move the previous package aside before packaging again.')
stage.mkdir()
subprocess.run(['ditto', str(app), str(stage / app.name)], check=True)
for name in ['README.md', 'README_jp.md']:
    shutil.copy2(root / 'ui' / name, stage / name)
(stage / 'BUILD.txt').write_text(f'Tetorica MIDI Playground {version}\nmacOS Apple Silicon (arm64)\nExperimental build. Not notarized; no Developer ID distribution signature.\nSource: https://github.com/kyorohiro/tetorica-midi-playground\n')
metadata = json.loads(subprocess.check_output(['cargo','metadata','--manifest-path',str(root/'src-tauri/Cargo.toml'),'--locked','--offline','--format-version','1','--filter-platform','aarch64-apple-darwin']))
packages = sorted([p for p in metadata['packages'] if p['source']], key=lambda p:p['name'])
# Include original dependency sources, which also preserve nested license files
# and the source of MPL-covered dependencies. Some are build-only dependencies.
with tarfile.open(stage / 'THIRD_PARTY_SOURCES.tar.gz', 'w:gz') as archive:
    for package in packages:
        archive.add(pathlib.Path(package['manifest_path']).parent, arcname=f"{package['name']}-{package['version']}")
(stage / 'THIRD_PARTY.json').write_text(json.dumps([{k:p.get(k) for k in ['name','version','license','repository']} for p in packages],indent=2)+'\n')
shutil.copy2(root / 'ui/shared/LICENSE', stage / 'PLAYGROUND_LICENSE.txt')
archive = release / f'{stage.name}.zip'
subprocess.run(['ditto','-c','-k','--sequesterRsrc','--keepParent',str(stage),str(archive)],check=True)
checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
(archive.with_suffix('.zip.sha256')).write_text(f'{checksum}  {archive.name}\n')
print(f'{archive}\n{archive.stat().st_size:,} bytes\nSHA256 {checksum}')
