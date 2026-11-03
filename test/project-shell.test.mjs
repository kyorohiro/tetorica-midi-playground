import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProjectFiles} from '../ui/project-files.js';
import {createProjectShell} from '../ui/project-shell.js';
import {binaryFile} from '../ui/project-assets.js';
import {withGuide} from '../ui/guide.js';

const source = () => createProjectFiles({files: {'/index.js': 'play("C4");\n', '/notes.txt': 'C4\nE4\nG4\n', '/voices/bell.tfi': binaryFile([0, 255, 12, 7])}, directories: ['/empty']});
const create = (store, options = {}) => createProjectShell({getStore: () => store, ...options});
async function ok(shell, command) { const result = await shell.execute(command); assert.equal(result.code, 0, `${command}: ${result.stderr}`); return result.stdout; }
async function rejected(shell, command, reason) { const result = await shell.execute(command); assert.notEqual(result.code, 0, command); assert.match(result.stderr, reason); return result; }

test('Shell navigation and bounded read commands inspect FILES without stopping playback or changing revisions', async () => {
  const store = source(); let flushed = 0, stopped = 0, published = 0;
  const shell = create(store, {beforeCommand() { flushed++; }, beforeMutation() { stopped++; }, onChanged() { published++; }});
  const revision = store.revision;
  assert.equal(await ok(shell, 'pwd'), '/\n');
  const listing = await ok(shell, 'ls');
  assert.match(listing, /index\.js/); assert.match(listing, /empty\//);
  await ok(shell, 'cd voices'); assert.equal(shell.cwd, '/voices');
  assert.equal(await ok(shell, 'pwd'), '/voices\n');
  await ok(shell, 'cd ..');
  assert.equal(await ok(shell, 'cat notes.txt | rg -n C4 -'), '-:1:C4\n');
  assert.match(await ok(shell, 'read --start 2 --end 2 notes.txt'), /2\tE4/);
  assert.match(await ok(shell, 'find / -name "*.tfi"'), /\/voices\/bell\.tfi/);
  assert.equal(store.revision, revision); assert.equal(stopped, 0); assert.equal(published, 0); assert.ok(flushed >= 8);
});

test('mkdir, redirects, exact edits, binary copy and folder move publish complete drafts and change details', async () => {
  const store = source(), changes = []; let stops = 0;
  const shell = create(store, {beforeMutation() { stops++; }, onChanged(snapshot, detail) { changes.push({snapshot, detail}); }});
  await ok(shell, 'mkdir -p parts/bass');
  await ok(shell, 'echo "hello world" > parts/bass/notes.txt');
  await ok(shell, 'echo again >> parts/bass/notes.txt');
  assert.equal(store.snapshot().files['/parts/bass/notes.txt'], 'hello world\nagain\n');
  await ok(shell, 'edit parts/bass/notes.txt "hello world" "hello bass"');
  assert.equal(store.snapshot().files['/parts/bass/notes.txt'], 'hello bass\nagain\n');
  await ok(shell, 'cp voices/bell.tfi parts/bass/bell.tfi');
  assert.deepEqual(store.snapshot().files['/parts/bass/bell.tfi'], binaryFile([0, 255, 12, 7]));
  await ok(shell, 'mv parts/bass parts/lead');
  assert.equal(Object.hasOwn(store.snapshot().files, '/parts/bass/bell.tfi'), false);
  assert.deepEqual(store.snapshot().files['/parts/lead/bell.tfi'], binaryFile([0, 255, 12, 7]));
  assert.deepEqual(changes.at(-1).detail.transfers, [{from: '/parts/bass', to: '/parts/lead'}]);
  await ok(shell, 'rm -r parts/lead');
  assert.deepEqual(changes.at(-1).detail.removed, ['/parts/lead']);
  assert.equal(store.snapshot().files['/index.js'], 'play("C4");\n');
  assert.ok(store.snapshot().directories.includes('/empty')); assert.equal(stops, 7); assert.equal(changes.length, 7);
  assert.equal(store.fs.checkpoints.auto, false); assert.equal(Object.keys(store.snapshot().files).some(path => path.startsWith('/.tet.ss/')), false);
});

test('failed pipeline, last-JS deletion, path/size validation and unavailable commands are atomic', async () => {
  const store = source(), shell = create(store), before = store.snapshot();
  await rejected(shell, 'write notes.txt changed | unknown-command', /Unknown command/);
  assert.deepEqual(store.snapshot(), before);
  await rejected(shell, 'rm index.js', /at least one JavaScript/);
  assert.deepEqual(store.snapshot(), before);
  await rejected(shell, 'mv index.js index.txt', /at least one JavaScript/);
  assert.deepEqual(store.snapshot(), before);
  await rejected(shell, 'echo blocked > CON.txt', /portable/);
  await rejected(shell, "echo blocked > '/bad\\name.txt'", /Invalid (?:project|virtual) path/);
  await rejected(shell, 'touch "/Index.js"', /letter case/);
  assert.deepEqual(store.snapshot(), before);
  for (const name of ['snapshot', 'undo', 'diff']) await rejected(shell, name, /not available/);
  await rejected(shell, 'echo first; echo second', /chaining is not supported/);
  await rejected(shell, 'js index.js', /Unknown command/);
  assert.deepEqual(store.snapshot(), before);
  // A bounded redirection can still cross the full project's cassette limit.
  const full = createProjectFiles({files: {'/index.js': 'x'.repeat(16 * 1024 * 1024 - 1)}}), fullShell = create(full);
  const original = full.snapshot();
  await rejected(fullShell, 'echo overflow > extra.txt', /16 MiB/);
  assert.deepEqual(full.snapshot(), original);
  const crowded = createProjectFiles({files: {'/index.js': '', ...Object.fromEntries(Array.from({length: 1022}, (_, i) => [`/note-${i}.txt`, '']))}}), crowdedShell = create(crowded);
  const previous = crowded.snapshot();
  await rejected(crowdedShell, 'touch extra.txt', /1024 file/); assert.deepEqual(crowded.snapshot(), previous);
});

test('Git metadata stays hidden and every ordinary path mutation protects guides, ancestors and Git data', async () => {
  const store = source();
  store.fs.writeBinary('/.git/HEAD', new Uint8Array([1, 2, 3]));
  store.fs.writeBinary('/parts/.git/HEAD', new Uint8Array([4, 5]));
  const shell = create(store), before = store.snapshot();
  assert.doesNotMatch(await ok(shell, 'ls /'), /\.git/);
  assert.doesNotMatch(await ok(shell, 'find /'), /\.git/);
  await rejected(shell, 'cat /.git/HEAD', /not found/i);
  await rejected(shell, 'cd /.git', /not found/i);
  const guide = Object.keys(withGuide({})).find(path => path.endsWith('/README.md'));
  assert.ok(guide); assert.match(await ok(shell, `cat ${guide}`), /Tetorica MIDI Playground/);
  for (const command of [
    'echo hacked > /.git/HEAD', 'rm -r /.git', 'mkdir /.Git/new',
    'mv parts somewhere', 'rm -r parts', `write ${guide} hacked`,
    'mkdir /sys/new', 'echo hacked > /metadata.json', 'rm -r /',
  ]) await rejected(shell, command, /protected/);
  assert.deepEqual(store.snapshot(), before);
  await ok(shell, 'echo editable > ordinary.txt');
  await ok(shell, 'echo "project notes" > README.md');
  await ok(shell, 'mkdir lib'); await ok(shell, 'echo "library notes" > lib/README.md');
  assert.equal(store.snapshot().files['/README.md'], 'project notes\n');
  assert.equal(store.snapshot().files['/lib/README.md'], 'library notes\n');
  assert.equal(Object.keys(store.snapshot().files).some(path => path.startsWith('/sys/')), false);
  assert.equal(store.snapshot().directories.some(path => path === '/sys' || path.startsWith('/sys/')), false);
  assert.deepEqual(store.snapshot().files['/.git/HEAD'], before.files['/.git/HEAD']);
  assert.deepEqual(store.snapshot().files['/parts/.git/HEAD'], before.files['/parts/.git/HEAD']);
});

test('an edit during async inspection prevents pending writes and retains the newer text', async () => {
  const store = source(), shell = create(store);
  const large = Array.from({length: 20000}, (_, i) => `line ${i}`).join('\n');
  store.write('/notes.txt', large);
  const pending = shell.execute('rg line notes.txt > search.txt');
  // rg yields every 2048 lines, so the edit occurs after draft capture.
  await new Promise(resolve => setTimeout(resolve, 0));
  store.write('/notes.txt', 'newer editor text\n');
  const result = await pending;
  assert.notEqual(result.code, 0); assert.match(result.stderr, /Files changed/);
  assert.equal(store.snapshot().files['/notes.txt'], 'newer editor text\n');
  assert.equal(Object.hasOwn(store.snapshot().files, '/search.txt'), false);
});

test('New/Import replacement, explicit cancellation and busy guards never publish stale drafts', async () => {
  let store = source(), continueFlush;
  const wait = () => new Promise(resolve => { continueFlush = resolve; });
  let published = 0;
  const shell = createProjectShell({getStore: () => store, beforeCommand: wait, onChanged() { published++; }});
  const replacement = shell.execute('echo stale > stale.txt');
  await Promise.resolve();
  assert.equal(shell.busy, true);
  await rejected(shell, 'pwd', /already running/);
  store = source(); continueFlush();
  assert.match((await replacement).stderr, /Project changed/);
  assert.equal(published, 0); assert.equal(Object.hasOwn(store.snapshot().files, '/stale.txt'), false);
  const cancelled = shell.execute('echo cancelled > cancelled.txt');
  await Promise.resolve(); shell.stop(); continueFlush();
  assert.equal((await cancelled).code, 130); assert.equal(published, 0);
  const reset = shell.execute('echo invalid > invalid.txt');
  await Promise.resolve(); shell.invalidate(); continueFlush();
  assert.equal((await reset).code, 130); assert.equal(shell.cwd, '/');
  shell.dispose(); await rejected(shell, 'pwd', /closed/);
});

test('patch changes multiple files atomically and cannot smuggle a protected path', async () => {
  const store = source(), shell = create(store);
  const patch = [{path: '/notes.txt', oldText: 'C4', newText: 'D4'}, {path: '/parts/new.js', type: 'create', text: 'play("D4");'}];
  store.createFile('/patch.json', JSON.stringify(patch));
  await ok(shell, 'patch patch.json');
  assert.equal(store.snapshot().files['/notes.txt'], 'D4\nE4\nG4\n'); assert.equal(store.snapshot().files['/parts/new.js'], 'play("D4");');
  store.write('/patch.json', JSON.stringify([{path: '/notes.txt', oldText: 'D4', newText: 'F4'}, {path: '/.git/HEAD', type: 'create', text: 'bad'}]));
  const before = store.snapshot();
  await rejected(shell, 'patch patch.json', /protected/); assert.deepEqual(store.snapshot(), before);
});

test('git shell commands use the shared controller and never replay stale draft data', async () => {
  const store = source(), actions = [];
  const shell = create(store, {git: () => ({async execute(action, args, guards) {
    guards.assertActive(); assert.ok(guards.signal instanceof AbortSignal); actions.push({action, args});
    if (action === 'init') { store.fs.writeBinary('/.git/HEAD', new Uint8Array([9])); return {initialized: true, branch: 'main', files: []}; }
    if (action === 'status') return {initialized: true, branch: 'main', files: [{path: 'index.js', untracked: true}]};
    return {completed: true};
  }})});
  assert.match(await ok(shell, 'git init'), /branch main/);
  assert.deepEqual(store.snapshot().files['/.git/HEAD'], binaryFile([9]));
  assert.equal(await ok(shell, 'git status -s'), '?? index.js\n');
  await ok(shell, 'git add index.js'); await ok(shell, 'git commit -m "First notes"');
  assert.deepEqual(actions.map(item => item.action), ['init', 'status', 'stage', 'commit']);
  assert.deepEqual(actions[2].args, {paths: ['/index.js']}); assert.deepEqual(actions[3].args, {message: 'First notes'});
  const count = actions.length;
  await rejected(shell, 'git status | cat -', /separately/);
  await rejected(shell, 'git diff > result.txt', /separately/);
  const nested = await shell.execute('pipeline --json "git init"');
  assert.notEqual(nested.code, 0); assert.match(JSON.parse(nested.stdout).stderr, /directly/);
  assert.equal(actions.length, count); assert.equal(Object.hasOwn(store.snapshot().files, '/result.txt'), false);
});
