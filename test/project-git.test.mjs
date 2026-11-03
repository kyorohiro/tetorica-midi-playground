import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProjectFiles} from '../ui/project-files.js';
import {createProjectGit} from '../ui/project-git.js';
import {binaryFile, isBinaryFile} from '../ui/project-assets.js';
import {exportProject, importProject} from '../ui/project-cassette.js';

const author = {name: 'MIDI Test', email: 'midi@example.invalid'};
const source = () => createProjectFiles({files: {'/index.js': 'play("C4");\n', '/voices/bell.tfi': binaryFile([0, 12, 255, 7]), '/delete-me.txt': 'old file\n'}, directories: ['/empty']});
const repository = (store, options = {}) => createProjectGit({getStore: () => store, ...options});
const firstCommit = async git => {
  await git.execute('init');
  await git.execute('stage', {paths: ['/']});
  return git.execute('commit', {...author, message: 'First notes'});
};

test('local Git stages text and binary, commits history, and preserves history and empty folders in a cassette', async () => {
  const store = source(), published = [];
  const git = repository(store, {onChanged: snapshot => published.push(snapshot)});
  assert.deepEqual(await git.execute('status'), {initialized: false, branch: null, files: []});
  const committed = await firstCommit(git);
  assert.match(committed.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual((await git.execute('status')).files, []);
  assert.equal(store.snapshot().files['/index.js'], 'play("C4");\n');
  assert.deepEqual(store.snapshot().files['/voices/bell.tfi'], binaryFile([0, 12, 255, 7]));
  assert.ok(Object.entries(store.snapshot().files).filter(([path]) => path.startsWith('/.git/')).every(([, data]) => isBinaryFile(data)));
  const project = {...store.snapshot(), runPath: '/index.js', selected: '/index.js', bpm: 120, clockMode: 'internal'};
  const restored = createProjectFiles(importProject(exportProject(project)));
  assert.ok(restored.snapshot().directories.includes('/empty'));
  const restoredGit = repository(restored);
  const history = await restoredGit.execute('log');
  assert.equal(history.length, 1); assert.equal(history[0].id, committed.commit); assert.match(history[0].message, /First notes/);
  assert.deepEqual((await restoredGit.execute('status')).files, []);
  assert.equal((await restoredGit.execute('config', {path: 'user.email'})).value, author.email);
  assert.ok(published.length >= 4);
  assert.equal(store.fs.checkpoints.auto, false);
  assert.equal(store.fs.list().some(file => file.path.startsWith('/.tet.ss/')), false);
});

test('staged and unstaged diffs distinguish edits, binary replacement and deletion', async () => {
  const store = source(), git = repository(store);
  await firstCommit(git);
  store.write('/index.js', 'play("D4");\n');
  store.write('/voices/bell.tfi', binaryFile([0, 20, 255, 8]));
  store.remove('/delete-me.txt');
  const unstaged = await git.execute('diff');
  assert.match(unstaged.text, /-play\("C4"\);/); assert.match(unstaged.text, /\+play\("D4"\);/);
  assert.match(unstaged.text, /Binary files a\/voices\/bell.tfi and b\/voices\/bell.tfi differ/);
  assert.match(unstaged.text, /-old file/);
  await git.execute('stage', {paths: ['/']});
  assert.equal((await git.execute('status')).files.every(file => file.staged && !file.worktree), true);
  assert.equal((await git.execute('diff')).text, '');
  assert.match((await git.execute('diff', {staged: true})).text, /\+play\("D4"\);/);
  store.write('/index.js', 'play("E4");\n');
  assert.match((await git.execute('diff')).text, /\+play\("E4"\);/);
  await git.execute('commit', {message: 'Change notes and voice'});
  assert.equal((await git.execute('log')).length, 2);
  assert.equal((await git.execute('status')).files.length, 1);
  assert.equal(store.snapshot().files['/index.js'], 'play("E4");\n');
});

test('branches can be created at HEAD without switching and unsupported actions are rejected', async () => {
  const store = source(), git = repository(store);
  await firstCommit(git);
  assert.deepEqual(await git.execute('branch', {name: 'experiment'}), {current: 'main', local: ['experiment', 'main'], remotes: []});
  assert.deepEqual((await git.execute('branch', {name: 'experiment.js'})).local, ['experiment', 'experiment.js', 'main']);
  assert.ok(isBinaryFile(store.snapshot().files['/.git/refs/heads/experiment.js']));
  const reloaded = createProjectFiles(importProject(exportProject({...store.snapshot(), runPath: '/index.js', selected: '/index.js', bpm: 120, clockMode: 'internal'})));
  assert.deepEqual((await repository(reloaded).execute('branch')).local, ['experiment', 'experiment.js', 'main']);
  for (const action of ['checkout', 'merge']) await assert.rejects(git.execute(action), /Unsupported Git operation/);
  for (const action of ['push', 'fetch', 'pull']) await assert.rejects(git.execute(action), /Tauri app/);
  await git.execute('remote', {url: 'https://example.invalid/repo'});
  assert.deepEqual(await git.execute('remote'), [{remote: 'origin', url: 'https://example.invalid/repo.git'}]);
  await assert.rejects(git.execute('config', {path: 'remote.origin.url', value: 'https://example.invalid/repo.git'}), /Supported settings/);
  await assert.rejects(git.execute('stage', {paths: ['/.git/HEAD']}), /metadata/);
});

test('editor flush happens before the transaction and an edit during an operation is never overwritten', async () => {
  const store = source(); let flushes = 0;
  const git = repository(store, {beforeCommand() { flushes++; }});
  await firstCommit(git);
  const pending = git.execute('status');
  await Promise.resolve();
  store.write('/index.js', 'new edit during Git\n');
  await assert.rejects(pending, /Files changed during Git operation/);
  assert.equal(store.snapshot().files['/index.js'], 'new edit during Git\n');
  assert.ok(flushes >= 4);
  assert.equal((await git.execute('status')).files[0].path, 'index.js');
});

test('project replacement, explicit invalidation and same-content New reject stale publication', async () => {
  let current = source(), changed = 0;
  const git = createProjectGit({getStore: () => current, onChanged() { changed++; }});
  const stale = git.execute('init');
  await Promise.resolve();
  current = createProjectFiles({files: {'/index.js': 'fresh project'}});
  await assert.rejects(stale, /Project changed during Git operation/);
  assert.equal(changed, 0); assert.equal(current.fs.has('/.git/HEAD'), false);
  const invalidated = git.execute('init');
  await Promise.resolve(); git.invalidate();
  await assert.rejects(invalidated);
  assert.equal(changed, 0); assert.equal(current.fs.has('/.git/HEAD'), false);
  const reset = git.execute('init');
  await Promise.resolve();
  current.replace(current.snapshot().files, current.snapshot().directories);
  await assert.rejects(reset, /Files changed during Git operation/);
  assert.equal(changed, 0); assert.equal(current.fs.has('/.git/HEAD'), false);
  await git.execute('init');
  assert.equal(changed, 1);
});

test('a failed size/path validation cannot publish partial Git objects', async () => {
  const store = source(), git = repository(store);
  const previous = store.snapshot();
  store.validateReplacement = () => { throw Error('Project exceeds the limit'); };
  await assert.rejects(git.execute('init'), /exceeds the limit/);
  assert.deepEqual(store.snapshot(), previous);
});
