import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProjectFiles, isInternalProjectPath, normalizeProjectPath} from '../ui/project-files.js';
import {binaryFile} from '../ui/project-assets.js';

test('FILES moves nested text, binary voices and empty directories as one project edit', () => {
  const voice = binaryFile([0, 255, 128, 4]);
  const store = createProjectFiles({files: {'/index.js': 'await import("./parts/lead.js")', '/parts/lead.js': 'export const lead = 1;', '/parts/bell.tfi': voice}, directories: ['/parts/empty']});
  const fs = store.fs;
  const moved = store.transfer('/parts', '/voices');
  assert.deepEqual(moved, [{from: '/parts/lead.js', to: '/voices/lead.js'}, {from: '/parts/bell.tfi', to: '/voices/bell.tfi'}]);
  assert.deepEqual(store.snapshot(), {files: {'/index.js': 'await import("./parts/lead.js")', '/voices/lead.js': 'export const lead = 1;', '/voices/bell.tfi': voice}, directories: ['/voices', '/voices/empty']});
  assert.strictEqual(store.fs, fs);
  assert.equal(store.fs.checkpoints.auto, false);
  store.transfer('/voices', '/copy', {copy: true});
  store.write('/copy/lead.js', 'edited');
  assert.equal(store.snapshot().files['/voices/lead.js'], 'export const lead = 1;');
  store.remove('/voices');
  assert.ok(!Object.hasOwn(store.snapshot().files, '/voices/bell.tfi'));
  assert.ok(store.listDirectories().includes('/copy/empty'));
});

test('failed FILES operations publish nothing and protect guides, metadata, and portable paths', () => {
  const store = createProjectFiles({files: {'/index.js': 'play(60)', '/parts/lead.js': 'lead', '/taken.js': 'taken', '/.git/HEAD': binaryFile([1, 2])}});
  const before = store.snapshot(), revision = store.revision;
  const attempts = [
    () => store.transfer('/parts', '/parts/nested'),
    () => store.transfer('/parts/lead.js', '/taken.js'),
    () => store.transfer('/parts', '/INDEX.js'),
    () => store.createFile('/INDEX.js'),
    () => store.createFile('/lib/README.md'),
    () => store.createFile('/README.md/child.js'),
    () => store.mkdir('/LIB'),
    () => store.createFile('/metadata.json'),
    () => store.write('/.git/HEAD', 'changed'),
    () => store.transfer('/.git', '/repo'),
    () => store.remove('/.git'),
    () => store.createFile('/bad\nname.js'),
    () => store.createFile('/nul.txt'),
    () => store.createFile('/trailing. /a.js'),
    () => store.createFile('../../escape.js'),
    () => store.mkdir('/parts/lead.js/sub'),
    () => store.write('/index.js', binaryFile([1])),
  ];
  for (const attempt of attempts) {
    assert.throws(attempt);
    assert.deepEqual(store.snapshot(), before);
    assert.equal(store.revision, revision);
  }
  assert.ok(isInternalProjectPath('/.git/objects/ab/01'));
  assert.ok(!isInternalProjectPath('/.gitignore'));
  assert.equal(normalizeProjectPath('parts/../new.js'), '/new.js');
});

test('sync preserves unchanged revisions while New or Import invalidates a same-content draft', () => {
  const store = createProjectFiles({files: {'/index.js': 'abc', '/voice.tfi': binaryFile([2, 3])}});
  const revision = store.revision, fileRevision = store.fs.getRevision('/index.js');
  const original = store.fs.checkpoint();
  assert.equal(store.sync(store.snapshot().files), false);
  assert.equal(store.revision, revision);
  assert.deepEqual(store.fs.checkpoint(), original);
  store.sync({...store.snapshot().files, '/index.js': 'xyz'});
  assert.ok(store.fs.getRevision('/index.js') > fileRevision);
  assert.ok(store.revision > revision);
  const beforeReset = store.revision, same = store.snapshot();
  store.replace(same.files, same.directories);
  assert.ok(store.revision > beforeReset);
  assert.strictEqual(store.fs.checkpoint().scope, original.scope);
  const afterReset = store.revision;
  store.write('/index.js', 'xyz');
  assert.equal(store.revision, afterReset);
});

test('snapshots preserve Git bytes and isolate binary edits; generated guides stay outside the store', () => {
  const source = {'/index.js': 'entry', '/README.md': 'generated', '/.git/objects/ab/12': binaryFile([0, 255, 254, 128])};
  const store = createProjectFiles({files: source, directories: ['/empty/nested']});
  const snapshot = store.snapshot();
  assert.equal(snapshot.files['/README.md'], undefined);
  assert.deepEqual(snapshot.files['/.git/objects/ab/12'], source['/.git/objects/ab/12']);
  source['/.git/objects/ab/12'].bytes[0] = 9;
  snapshot.files['/.git/objects/ab/12'].bytes[0] = 8;
  assert.equal(store.snapshot().files['/.git/objects/ab/12'].bytes[0], 0);
  store.mkdir('/new/deep');
  store.createFile('/new/deep/note.js', 'play(60)');
  assert.equal(store.fs.get('/new/deep/note.js').data, 'play(60)');
  assert.ok(store.listDirectories().includes('/empty/nested'));
  assert.throws(() => createProjectFiles({files: {'/lib': 'blocks the guide'}}), /guide/);
});

test('project limits and file-directory collisions are checked before replacing the current project', () => {
  const store = createProjectFiles({files: {'/index.js': 'keep'}}), before = store.snapshot();
  assert.throws(() => store.replace({'/index.js': 'x'.repeat(16 * 1024 * 1024 + 1)}), /16 MiB/);
  assert.throws(() => store.replace(Object.fromEntries(Array.from({length: 1024}, (_, i) => [`/${i}.txt`, '']))), /1024/);
  assert.throws(() => store.replace({'/index.js': 'entry', '/a': 'file', '/a/b.js': 'child'}), /File blocks/);
  assert.doesNotThrow(() => store.validateReplacement([{path: '/index.js', data: 'entry'}, {path: '/.git/refs/heads/voice.js', data: new Uint8Array([0, 255])}], ['/', '/.git/refs/heads']));
  assert.throws(() => store.validateReplacement([{path: '/README.md', data: 'overwrite'}]), /protected/);
  assert.throws(() => store.validateReplacement([{path: '/index.js', data: 'entry'}, {path: '/index.js', data: 'again'}]), /duplicate/);
  assert.throws(() => store.validateReplacement([{path: '/index.js', data: new Uint8Array([0])}]), /JavaScript/);
  assert.deepEqual(store.snapshot(), before);
});
