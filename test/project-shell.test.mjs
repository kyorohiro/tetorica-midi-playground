import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProjectFiles} from '../ui/project-files.js';
import {createProjectShell} from '../ui/project-shell.js';
import {createProjectGit} from '../ui/project-git.js';
import {binaryFile} from '../ui/project-assets.js';
import {withGuide, guides} from '../ui/guide.js';

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

test('failed pipeline, path/size validation and unavailable commands are atomic', async () => {
  const store = source(), shell = create(store), before = store.snapshot();
  await rejected(shell, 'write notes.txt changed | unknown-command', /Unknown command/);
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

test('Git metadata stays hidden and ordinary writes and moves still protect guides, ancestors and Git data', async () => {
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
    'echo hacked > /.git/HEAD', 'rm -r /.git', 'rm -rf /.git', 'mkdir /.Git/new',
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

test('the last script may be renamed or removed and an empty project can be rebuilt', async () => {
  const store=createProjectFiles({files:{'/index.js':'play(60)'}}),shell=create(store);
  await ok(shell,'mv index.js notes.txt');
  assert.deepEqual(store.snapshot().files,{'/notes.txt':'play(60)'});
  await ok(shell,'mv notes.txt index.js');await ok(shell,'rm index.js');
  assert.deepEqual(store.snapshot(),{files:{},directories:[]});
  await ok(shell,'write index.js "play(62)"');
  assert.equal(store.snapshot().files['/index.js'],'play(62)');
});

test('Shell can remove individual bundled guides, their subfolder and the entire sys tree', async () => {
  const store = source(), changes = [], shell = create(store, {onChanged:(snapshot, detail) => changes.push({snapshot, detail})});
  const allGuides = Object.keys(guides), libraryGuides = allGuides.filter(path => path.startsWith('/sys/lib/'));
  assert.ok(libraryGuides.length > 0);
  assert.match(await ok(shell, 'cat /sys/README.md'), /Tetorica MIDI Playground/);
  await ok(shell, 'rm /sys/README.md');
  assert.deepEqual(store.snapshot().removedGuides, ['/sys/README.md']);
  assert.deepEqual(changes.at(-1).snapshot.removedGuides, ['/sys/README.md']);
  assert.deepEqual(changes.at(-1).detail.removed, ['/sys/README.md']);
  await rejected(shell, 'cat /sys/README.md', /not found|does not exist/i);
  assert.match(await ok(shell, 'cat /sys/README_jp.md'), /MIDI Playground/);
  const beforeMissing = store.snapshot();
  await rejected(shell, 'rm /sys/missing.md', /not found|does not exist/i);
  assert.deepEqual(store.snapshot(), beforeMissing);
  await ok(shell, 'rm -f /sys/missing.md');
  assert.deepEqual(store.snapshot(), beforeMissing);
  await rejected(shell, 'rm /sys/lib', /directory|recursive/i);
  assert.deepEqual(store.snapshot(), beforeMissing);
  await ok(shell, 'rm -r /sys/lib');
  assert.deepEqual([...store.snapshot().removedGuides].sort(), ['/sys/README.md', ...libraryGuides].sort());
  assert.doesNotMatch(await ok(shell, 'ls /sys'), /lib/);
  assert.match(await ok(shell, 'cat /sys/README_jp.md'), /MIDI Playground/);
  assert.equal(Object.hasOwn(withGuide(store.snapshot().files, store.snapshot().removedGuides), '/sys/README.md'), false);
  await ok(shell, 'rm -rf sys');
  assert.deepEqual([...store.snapshot().removedGuides].sort(), allGuides.sort());
  assert.doesNotMatch(await ok(shell, 'ls /'), /sys/);
  assert.doesNotMatch(await ok(shell, 'find /'), /\/sys(?:\/|\n)/);
  await rejected(shell, 'cat /sys/README_jp.md', /not found|does not exist/i);
  assert.equal(store.snapshot().files['/index.js'], 'play("C4");\n');
  await rejected(shell, 'echo hacked > /sys/README.md', /protected/);
  await rejected(shell, 'mkdir /sys/lib', /protected/);
});

test('guide visibility metadata is atomic across pipeline failures and later ordinary file changes', async () => {
  const store = source(), shell = create(store);
  await ok(shell, 'rm /sys/README.md');
  const before = store.snapshot();
  await rejected(shell, 'rm -r /sys/lib | unknown-command', /Unknown command/);
  assert.deepEqual(store.snapshot(), before);
  assert.match(await ok(shell, 'cat /sys/lib/README.md'), /Libraries/);
  await ok(shell, 'echo updated > notes.txt');
  assert.deepEqual(store.snapshot().removedGuides, ['/sys/README.md']);
  await rejected(shell, 'cat /sys/README.md', /not found|does not exist/i);
  const reopened = createProjectFiles(store.snapshot()), reopenedShell = create(reopened);
  await rejected(reopenedShell, 'cat /sys/README.md', /not found|does not exist/i);
  assert.match(await ok(reopenedShell, 'cat /sys/lib/README.md'), /Libraries/);
});

test('force recursive root clearing removes real Git, nested metadata, empty folders and bundled guides', async () => {
  const store=source(),git=createProjectGit({getStore:()=>store}),changes=[];let gitCalls=0;
  await git.execute('init');
  store.fs.writeBinary('/parts/.git/HEAD',new Uint8Array([1,2]));store.mkdir('/parts/empty/deep');
  const shell=create(store,{git:()=>{gitCalls++;return git;},onChanged:(snapshot,detail)=>changes.push({snapshot,detail})});
  await ok(shell,'rm -rf .');
  assert.deepEqual(store.snapshot().files,{});assert.deepEqual(store.snapshot().directories,[]);
  assert.deepEqual([...store.snapshot().removedGuides].sort(),Object.keys(guides).sort());
  assert.equal(changes.at(-1).detail.clearedRoot,true);assert.deepEqual(changes.at(-1).detail.removed,['/']);
  const guide=Object.keys(withGuide({})).find(path=>path.endsWith('/README.md'));
  await rejected(shell,`cat ${guide}`,/not found|does not exist/i);
  assert.doesNotMatch(await ok(shell,'ls /'),/sys/);
  for(const command of ['rm -fr ./','rm --force --recursive /']){
    await ok(shell,command);assert.deepEqual(store.snapshot().files,{});assert.deepEqual(store.snapshot().directories,[]);
    assert.deepEqual([...store.snapshot().removedGuides].sort(),Object.keys(guides).sort());
    assert.equal(changes.at(-1).detail.clearedRoot,true);
  }
  assert.equal(gitCalls,0);
});

test('root clearing is transactional across pipeline failure and stays local to the current directory', async () => {
  const store=source(),git=createProjectGit({getStore:()=>store});await git.execute('init');
  store.remove('/sys/README.md');
  const shell=create(store),before=store.snapshot();
  await rejected(shell,'rm -rf . | unknown-command',/Unknown command/);
  assert.deepEqual(store.snapshot(),before);
  await ok(shell,'cd voices');await ok(shell,'rm -rf .');
  assert.equal(store.snapshot().files['/index.js'],before.files['/index.js']);
  assert.deepEqual(store.snapshot().files['/.git/HEAD'],before.files['/.git/HEAD']);
  assert.equal(Object.hasOwn(store.snapshot().files,'/voices/bell.tfi'),false);
  assert.equal(store.snapshot().directories.includes('/voices'),false);
  assert.deepEqual(store.snapshot().removedGuides,before.removedGuides);
  assert.match(await ok(shell,'cat /sys/README_jp.md'),/MIDI Playground/);
  assert.equal(shell.cwd,'/');
});

test('cancellation or replacing the project before root-clear mutation keeps the previous files intact', async () => {
  for(const action of ['cancel','replace']){
    let store=source(),resume;store.remove('/sys/README.md');const original=store,before=store.snapshot();let changes=0;
    const shell=createProjectShell({getStore:()=>store,beforeMutation:()=>new Promise(resolve=>{resume=resolve;}),onChanged:()=>changes++});
    const pending=shell.execute('rm -rf .');while(!resume)await Promise.resolve();
    if(action==='cancel')shell.stop();else store=createProjectFiles({files:{'/new.js':'new'}});
    resume();assert.notEqual((await pending).code,0);assert.deepEqual(original.snapshot(),before);assert.equal(changes,0);
    if(action==='replace'){
      assert.deepEqual(store.snapshot().files,{'/new.js':'new'});
      assert.equal(store.snapshot().removedGuides,undefined);
      assert.ok(Object.hasOwn(withGuide(store.snapshot().files,store.snapshot().removedGuides),'/sys/README.md'));
    }
  }
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

test('git remote rm and remove remove only the named remote without changing files or commits', async () => {
  const store = source(), git = createProjectGit({getStore: () => store});
  const shell = create(store, {git: () => git});
  await ok(shell, 'git init');
  await ok(shell, 'git config user.name "MIDI Test"');
  await ok(shell, 'git config user.email midi@example.invalid');
  await ok(shell, 'git add /');
  await ok(shell, 'git commit -m "Keep the song"');
  const history = await git.execute('log');
  const workingFiles = Object.fromEntries(Object.entries(store.snapshot().files).filter(([path]) => !path.startsWith('/.git/')));

  await ok(shell, 'git remote add origin https://example.invalid/first.git');
  assert.equal(await ok(shell, 'git remote rm origin'), '');
  assert.equal(await ok(shell, 'git remote'), '');
  await rejected(shell, 'git remote get-url origin', /remote/i);

  await ok(shell, 'git remote add origin https://example.invalid/replacement.git');
  await ok(shell, 'git remote add backup https://example.invalid/backup.git');
  assert.equal(await ok(shell, 'git remote remove origin'), '');
  assert.equal(await ok(shell, 'git remote'), 'backup\n');
  assert.equal(await ok(shell, 'git remote get-url backup'), 'https://example.invalid/backup.git\n');
  assert.deepEqual(await git.execute('log'), history);
  assert.deepEqual(Object.fromEntries(Object.entries(store.snapshot().files).filter(([path]) => !path.startsWith('/.git/'))), workingFiles);

  const beforeFailure = store.snapshot();
  await rejected(shell, 'git remote rm missing', /remote/i);
  await rejected(shell, 'git remote remove ../bad', /Invalid remote name/);
  assert.deepEqual(store.snapshot(), beforeFailure);
});
