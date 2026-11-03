import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProjectFiles, isInternalProjectPath, normalizeProjectPath} from '../ui/project-files.js';
import {binaryFile} from '../ui/project-assets.js';
import {guides, withGuide} from '../ui/guide.js';

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
    () => store.createFile('/sys/lib/README.md'),
    () => store.createFile('/sys/unknown.js'),
    () => store.mkdir('/SYS'),
    () => store.remove('/sys/unknown'),
    () => store.transfer('/parts', '/sys/parts'),
    () => store.createFile('/metadata.json'),
    () => store.createFile('/metadata.json/child.js'),
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
  const source = {'/index.js': 'entry', '/sys/README.md': 'generated', '/README.md': 'project documentation', '/lib/README.md':'project library documentation', '/.git/objects/ab/12': binaryFile([0, 255, 254, 128])};
  const store = createProjectFiles({files: source, directories: ['/empty/nested']});
  const snapshot = store.snapshot();
  assert.equal(snapshot.files['/sys/README.md'], undefined);
  assert.equal(snapshot.files['/README.md'], 'project documentation');
  assert.equal(snapshot.files['/lib/README.md'], 'project library documentation');
  assert.deepEqual(snapshot.files['/.git/objects/ab/12'], source['/.git/objects/ab/12']);
  source['/.git/objects/ab/12'].bytes[0] = 9;
  snapshot.files['/.git/objects/ab/12'].bytes[0] = 8;
  assert.equal(store.snapshot().files['/.git/objects/ab/12'].bytes[0], 0);
  store.mkdir('/new/deep');
  store.createFile('/new/deep/note.js', 'play(60)');
  assert.equal(store.fs.get('/new/deep/note.js').data, 'play(60)');
  assert.ok(store.listDirectories().includes('/empty/nested'));
  assert.doesNotThrow(() => createProjectFiles({files: {'/lib': 'ordinary project file'}}));
  assert.throws(() => createProjectFiles({files: {'/sys': 'blocks the guide namespace'}}), /guide/);
});

test('project limits and file-directory collisions are checked before replacing the current project', () => {
  const store = createProjectFiles({files: {'/index.js': 'keep'}}), before = store.snapshot();
  assert.throws(() => store.replace({'/index.js': 'x'.repeat(16 * 1024 * 1024 + 1)}), /16 MiB/);
  assert.throws(() => store.replace(Object.fromEntries(Array.from({length: 1024}, (_, i) => [`/${i}.txt`, '']))), /1024/);
  assert.throws(() => store.replace({'/index.js': 'entry', '/a': 'file', '/a/b.js': 'child'}), /File blocks/);
  assert.doesNotThrow(() => store.validateReplacement([{path: '/index.js', data: 'entry'}, {path: '/.git/refs/heads/voice.js', data: new Uint8Array([0, 255])}], ['/', '/.git/refs/heads']));
  assert.doesNotThrow(() => store.validateReplacement([{path: '/index.js', data: 'entry'}, {path: '/README.md', data: 'GitHub project README'}, {path: '/lib/README.md', data: 'GitHub library README'}]));
  for(const path of ['/sys','/sys/README.md','/sys/payload.js','/SYS/payload']) assert.throws(() => store.validateReplacement([{path, data: 'overwrite'}]), /protected/);
  for(const path of ['/sys','/sys/nested','/SYS']) assert.throws(() => store.validateReplacement([{path:'/index.js',data:'entry'}], [path]), /Protected/);
  assert.throws(() => store.validateReplacement([{path: '/index.js', data: 'entry'}, {path: '/index.js', data: 'again'}]), /duplicate/);
  assert.throws(() => store.validateReplacement([{path: '/index.js', data: new Uint8Array([0])}]), /JavaScript/);
  assert.deepEqual(store.snapshot(), before);
});

test('bundled guide deletions persist separately from editable files and advance project revision', () => {
  const store = createProjectFiles({files: {'/index.js':'entry','/README.md':'project README'}});
  const firstRevision = store.revision;
  assert.equal(store.remove('/sys/README.md'), true);
  assert.ok(store.revision > firstRevision);
  assert.deepEqual(store.snapshot(), {files: {'/index.js':'entry','/README.md':'project README'}, directories: [], removedGuides: ['/sys/README.md']});
  const revision = store.revision;
  assert.equal(store.removeGuides('/sys/README.md'), false);
  assert.equal(store.revision, revision);
  assert.equal(store.remove('/SYS/lib'), true);
  const selected = ['/sys/README.md','/sys/lib/README.md','/sys/lib/README_jp.md'];
  assert.deepEqual(store.snapshot().removedGuides, selected);
  const visible = withGuide(store.snapshot().files, store.snapshot().removedGuides);
  assert.deepEqual(Object.keys(visible).sort(), ['/README.md','/index.js','/sys/README_jp.md']);
  assert.equal(store.fs.has('/sys/README.md'), false);
  assert.deepEqual(createProjectFiles(store.snapshot()).snapshot(), store.snapshot());
  const snapshot = store.snapshot();
  snapshot.removedGuides.length = 0;
  assert.deepEqual(store.snapshot().removedGuides, selected);
  assert.equal(store.removeGuides('/'), true);
  assert.deepEqual(store.snapshot().removedGuides, Object.keys(guides));
  assert.equal(store.remove('/sys'), false);
  for (const operation of [() => store.write('/sys/README.md','edited'), () => store.createFile('/sys/new.js'), () => store.mkdir('/sys/new')]) assert.throws(operation, /protected/);
});

test('project edits and Git replacements retain deleted guides until an explicit project reset', () => {
  const removedGuides = ['/sys/README.md'];
  const store = createProjectFiles({files: {'/index.js':'entry'}, removedGuides});
  removedGuides.length = 0;
  store.write('/index.js','edit');
  store.mkdir('/empty');
  store.createFile('/new.js','new');
  store.transfer('/new.js','/moved.js');
  store.remove('/moved.js');
  assert.deepEqual(store.snapshot().removedGuides, ['/sys/README.md']);
  store.sync({'/index.js':'editor'});
  store.replace({'/index.js':'import'}, []);
  store.validateReplacement([{path:'/index.js',data:'Git'}]);
  store.fs.replace([{path:'/index.js',data:'Git'}]);
  assert.deepEqual(store.snapshot().removedGuides, ['/sys/README.md']);
  const beforeRevision = store.revision;
  const snapshot = store.snapshot();
  assert.equal(store.sync(snapshot.files, snapshot.directories), false);
  assert.equal(store.revision, beforeRevision);
  assert.equal(store.sync(snapshot.files, snapshot.directories, []), true);
  assert.ok(store.revision > beforeRevision);
  assert.equal(Object.hasOwn(store.snapshot(),'removedGuides'), false);
  store.remove('/sys');
  store.replace({'/index.js':'new project'}, [], []);
  assert.deepEqual(store.snapshot(), {files:{'/index.js':'new project'},directories:[]});
});

test('combined file and guide changes validate everything before publishing', () => {
  const store = createProjectFiles({files: {'/index.js':'keep'}, removedGuides: ['/sys/README.md']});
  const before = store.snapshot(), revision = store.revision;
  for (const invalid of [null, {}, ['/sys'], ['/sys/unknown.md'], ['/sys/README.md','/sys/README.md']]) {
    assert.throws(() => createProjectFiles({files:{},removedGuides:invalid}), /removed guide/i);
    for (const method of ['sync','replace','validate']) assert.throws(() => store[method]({'/new.js':'new'}, [], invalid), /removed guide/i);
    assert.deepEqual(store.snapshot(), before);
    assert.equal(store.revision, revision);
  }
  for (const method of ['sync','replace']) assert.throws(() => store[method]({'/sys/payload.js':'payload'}, [], []), /protected/);
  assert.throws(() => store.removeGuides('/sys/missing'), /does not exist/);
  assert.throws(() => store.removeGuides('/index.js'), /does not exist/);
  assert.deepEqual(store.snapshot(), before);
  assert.equal(store.revision, revision);
  let published;
  store.fs.onDidChange(() => {published=store.snapshot();});
  store.sync({}, [], Object.keys(guides));
  assert.deepEqual(published, {files:{},directories:[],removedGuides:Object.keys(guides)});
  assert.ok(store.revision > revision);
});
