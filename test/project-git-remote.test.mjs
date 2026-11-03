import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync, deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createProjectFiles} from '../ui/project-files.js';
import {createProjectGit} from '../ui/project-git.js';
import {createProjectShell} from '../ui/project-shell.js';
import {binaryFile} from '../ui/project-assets.js';

const author = {name: 'Fixture', email: 'fixture@example.invalid'};
const packet = value => {
  const bytes = Buffer.from(value);
  return Buffer.concat([Buffer.from((bytes.length + 4).toString(16).padStart(4, '0')), bytes]);
};
const flush = Buffer.from('0000');
const create = () => createProjectFiles({files: {'/index.js': 'play("C4");\n'}});
const repo = (store, options = {}) => createProjectGit({getStore: () => store, ...options});
async function commit(git, message) {
  await git.execute('stage', {paths: ['/']});
  return (await git.execute('commit', {...author, message})).commit;
}
async function initial(store) {
  const git = repo(store); await git.execute('init');
  const oid = await commit(git, 'First');
  await git.execute('remote', {url: 'https://example.invalid/fixture'});
  return oid;
}

// A tiny smart-HTTPS upload-pack fixture, built only from the in-memory Git
// objects. No server, host Git, network, PAT or external package is involved.
function packFrom(store) {
  const objects = store.fs.list().filter(file => /^\/\.git\/objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/.test(file.path));
  const header = Buffer.alloc(12); header.write('PACK'); header.writeUInt32BE(2, 4); header.writeUInt32BE(objects.length, 8);
  const chunks = [header];
  for (const object of objects) {
    const inflated = inflateSync(object.data), zero = inflated.indexOf(0);
    const [type] = inflated.subarray(0, zero).toString().split(' '), bytes = inflated.subarray(zero + 1);
    let size = bytes.length, first = ({commit: 1, tree: 2, blob: 3, tag: 4}[type] << 4) | (size & 15);
    size >>>= 4; const sizes = [];
    if (size) first |= 128; sizes.push(first);
    while (size) { let next = size & 127; size >>>= 7; if (size) next |= 128; sizes.push(next); }
    chunks.push(Buffer.from(sizes), deflateSync(bytes));
  }
  const bytes = Buffer.concat(chunks);
  return Buffer.concat([bytes, createHash('sha1').update(bytes).digest()]);
}
function upload(store, oid, hooks = {}, branch = 'main') {
  const pack = packFrom(store);
  return {async request({url, method = 'GET', signal}) {
    signal?.throwIfAborted(); await hooks.beforeRequest?.(method); signal?.throwIfAborted();
    if (method === 'GET') return {url, statusCode: 200, statusMessage: 'OK', headers: {'content-type': 'application/x-git-upload-pack-advertisement'}, body: [packet('# service=git-upload-pack\n'), flush, packet(`${oid} HEAD\0multi_ack_detailed side-band-64k ofs-delta symref=HEAD:refs/heads/${branch}\n`), packet(`${oid} refs/heads/${branch}\n`), flush]};
    return {url, statusCode: 200, statusMessage: 'OK', headers: {'content-type': 'application/x-git-upload-pack-result'}, body: [packet('NAK\n'), packet(Buffer.concat([Buffer.from([1]), pack])), flush]};
  }};
}

test('fetch and fast-forward pull use an isolated HTTPS pack and retain binary Git metadata', async () => {
  const local = create(), first = await initial(local);
  const remote = createProjectFiles(local.snapshot()), remoteGit = repo(remote);
  remote.write('/index.js', 'play("D4");\n');
  remote.createFile('/README.md', 'Remote project\n');
  remote.createFile('/lib/added.js', '\uFEFFexport const note = "D4";\n');
  remote.createFile('/voices/bell.tfi', binaryFile([0, 12, 255, 9]));
  const second = await commit(remoteGit, 'Second');
  const scopes = []; let closed = 0;
  const git = repo(local, {beginRemote: async request => { scopes.push(request); return {http: upload(remote, second), close: async () => { closed++; }}; }});
  await git.execute('fetch');
  assert.equal(local.snapshot().files['/index.js'], 'play("C4");\n');
  assert.equal((await git.execute('log'))[0].id, first);
  assert.ok((await git.execute('branch')).remotes.includes('origin/main'));
  await git.execute('pull');
  assert.equal(local.snapshot().files['/index.js'], 'play("D4");\n');
  assert.equal(local.snapshot().files['/README.md'], 'Remote project\n');
  assert.equal(local.snapshot().files['/lib/added.js'], '\uFEFFexport const note = "D4";\n');
  assert.deepEqual(local.snapshot().files['/voices/bell.tfi'], binaryFile([0, 12, 255, 9]));
  assert.equal((await git.execute('log'))[0].id, second);
  assert.equal((await git.execute('status')).files.length, 0);
  assert.equal(closed, 2);
  assert.deepEqual(scopes.map(value => value.operation), ['fetch', 'pull']);
  assert.ok(scopes.every(value => value.url === 'https://example.invalid/fixture.git' && value.branch === 'main' && value.commit === first));
});

test('push reviews the exact commit and sends a Git pack before closing the native session', async () => {
  const store = create(), oid = await initial(store); let scope, pack, closed = 0;
  const git = repo(store, {beginRemote: async request => {
    scope = request;
    return {close: async () => { closed++; }, http: {async request({url, method = 'GET', body}) {
      if (method === 'GET') return {url, statusCode: 200, statusMessage: 'OK', headers: {'content-type': 'application/x-git-receive-pack-advertisement'}, body: [packet('# service=git-receive-pack\n'), flush, packet('0000000000000000000000000000000000000000 capabilities^{}\0report-status side-band-64k\n'), flush]};
      const chunks = []; for await (const chunk of body) chunks.push(Buffer.from(chunk)); pack = Buffer.concat(chunks);
      return {url, statusCode: 200, statusMessage: 'OK', headers: {'content-type': 'application/x-git-receive-pack-result'}, body: [packet(Buffer.concat([Buffer.from([1]), packet('unpack ok\n'), packet('ok refs/heads/main\n'), flush])), flush]};
    }}};
  }});
  await git.execute('push', {setUpstream: true});
  assert.deepEqual(scope, {url: 'https://example.invalid/fixture.git', operation: 'push', branch: 'main', commit: oid});
  assert.ok(pack.includes(Buffer.from('PACK'))); assert.ok(pack.includes(Buffer.from('refs/heads/main'))); assert.equal(closed, 1);
});

test('pull refuses dirty files and divergent history without replacing current work', async () => {
  const store = create(); await initial(store);
  const remote = createProjectFiles(store.snapshot()); remote.write('/index.js', 'remote change\n');
  const remoteOid = await commit(repo(remote), 'Remote'); let sessions = 0;
  const git = repo(store, {beginRemote: async () => { sessions++; return {http: upload(remote, remoteOid), close: async () => {}}; }});
  await assert.rejects(git.execute('pull', {branch: 'other'}), /current branch/); assert.equal(sessions, 0);
  store.write('/index.js', 'local change\n');
  await assert.rejects(git.execute('pull'), /Commit local changes/); assert.equal(sessions, 0);
  await commit(git, 'Local'); const before = store.snapshot();
  await assert.rejects(git.execute('pull'), /fast.forward|FastForward|Cannot merge/i);
  assert.deepEqual(store.snapshot(), before);
});

test('replacement, editing or cancellation while native approval is pending prevents requests and stale publication', async () => {
  for (const mode of ['replace', 'edit', 'abort']) {
    let store = create(); await initial(store);
    let approve, started; const entered = new Promise(resolve => { started = resolve; }); let requests = 0, closed = 0;
    const git = createProjectGit({getStore: () => store, beginRemote: async () => { started(); await new Promise(resolve => { approve = resolve; }); return {http: {request() { requests++; throw Error('must not send'); }}, close: async () => { closed++; }}; }});
    const abort = new AbortController(), pending = git.execute('fetch', {}, {signal: abort.signal});
    await entered;
    if (mode === 'replace') store = create();
    else if (mode === 'edit') store.write('/index.js', 'new editor work\n');
    else abort.abort();
    const before = store.snapshot(); approve(); await assert.rejects(pending);
    assert.deepEqual(store.snapshot(), before); assert.equal(requests, 0); assert.equal(closed, 1);
  }
});

test('a rejected remote draft cannot publish refs or pulled content', async () => {
  const local = create(); await initial(local);
  const remote = createProjectFiles(local.snapshot()); remote.write('/index.js', 'changed\n');
  const oid = await commit(repo(remote), 'Changed');
  const before = local.snapshot(); let closed = 0;
  const git = repo(local, {beginRemote: async () => ({http: upload(remote, oid), close: async () => { closed++; }}), validateReplacement() { throw Error('Rejected project content'); }});
  await assert.rejects(git.execute('pull'), /Rejected project content/);
  assert.deepEqual(local.snapshot(), before); assert.equal(closed, 1);
});

test('an editor change or cancellation during HTTP cannot publish downloaded Git objects', async () => {
  for (const mode of ['edit', 'abort']) {
    const local = create(); await initial(local);
    const remote = createProjectFiles(local.snapshot()); remote.write('/index.js', 'remote edit\n');
    const oid = await commit(repo(remote), 'Remote'); let release, started;
    const entered = new Promise(resolve => { started = resolve; }); let closed = 0;
    const git = repo(local, {beginRemote: async () => ({close: async () => { closed++; }, http: upload(remote, oid, {async beforeRequest(method) {
      if (method === 'POST') { started(); await new Promise(resolve => { release = resolve; }); }
    }})})});
    const abort = new AbortController(), pending = git.execute('fetch', {}, {signal: abort.signal});
    await entered;
    if (mode === 'edit') local.write('/index.js', 'keep new editor work\n'); else abort.abort();
    const before = local.snapshot(); release(); await assert.rejects(pending);
    assert.deepEqual(local.snapshot(), before); assert.equal(closed, 1);
  }
});

test('clone replaces FILES atomically, decodes source text, retains full history and resets Shell cwd', async () => {
  const remote = create(); await initial(remote);
  remote.write('/index.js', '\uFEFFplay("E4");\n');
  remote.createFile('/voices/bell.tfi', binaryFile([0, 12, 255, 9]));
  const oid = await commit(repo(remote), 'Second');
  for (const explicitBranch of [false, true]) {
    const local = create(); local.createFile('/old/local-only.txt', 'Keep until clone succeeds');
    const scopes = [], publications = []; let closed = 0;
    const git = repo(local, {onChanged:(snapshot,detail)=>publications.push({snapshot,detail}),beginRemote: async request => {
      scopes.push(request);
      return {http: upload(remote, oid, {}, 'trunk'), close: async () => { closed++; }};
    }});
    const shell = createProjectShell({getStore: () => local, git: () => git});
    assert.equal((await shell.execute('cd old')).code, 0);
    const plainBefore = local.snapshot();
    const plain = await shell.execute('git clone https://example.invalid/clone .');
    assert.notEqual(plain.code, 0); assert.equal(scopes.length, 0); assert.deepEqual(local.snapshot(), plainBefore);
    const nested = await shell.execute('git clone --replace https://example.invalid/clone .');
    assert.notEqual(nested.code, 0); assert.equal(scopes.length, 0); assert.deepEqual(local.snapshot(), plainBefore);
    const result = await shell.execute(`git clone --replace ${explicitBranch ? '-b trunk ' : ''}https://example.invalid/clone`);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(shell.cwd, '/');
    assert.equal(local.snapshot().files['/index.js'], '\uFEFFplay("E4");\n');
    assert.deepEqual(local.snapshot().files['/voices/bell.tfi'], binaryFile([0, 12, 255, 9]));
    assert.equal(Object.hasOwn(local.snapshot().files, '/old/local-only.txt'), false);
    assert.equal((await git.execute('status')).branch, 'trunk');
    assert.deepEqual((await git.execute('status')).files, []);
    assert.deepEqual((await git.execute('log')).map(value => value.id), (await repo(remote).execute('log')).map(value => value.id));
    assert.deepEqual(await git.execute('remote'), [{remote: 'origin', url: 'https://example.invalid/clone.git'}]);
    assert.deepEqual(scopes, [{url: 'https://example.invalid/clone.git', operation: 'clone', branch: explicitBranch ? 'trunk' : '', commit: ''}]);
    const clonePublications=publications.filter(value=>value.detail.action==='clone');
    assert.equal(clonePublications.length,1);
    assert.equal(clonePublications[0].detail.result.operation,'clone');
    assert.equal(clonePublications[0].snapshot.files['/index.js'],'\uFEFFplay("E4");\n');
    assert.equal(closed, 1);
  }
});

test('failed clone, rejected project content and cancellation during HTTP preserve the previous project', async () => {
  const remote = create(); const oid = await initial(remote);
  for (const mode of ['network', 'content', 'edit', 'abort']) {
    const local = create(); await initial(local);
    const abort = new AbortController(); let entered, release, closed = 0;
    const started = new Promise(resolve => { entered = resolve; });
    const git = repo(local, {
      validateReplacement() { if (mode === 'content') throw Error('Remote project needs JavaScript'); },
      beginRemote: async () => ({close: async () => { closed++; }, http: mode === 'network' ? {request() { throw Error('Fixture connection failed'); }} : upload(remote, oid, {async beforeRequest(method) {
        if (method === 'POST' && ['edit', 'abort'].includes(mode)) { entered(); await new Promise(resolve => { release = resolve; }); }
      }})}),
    });
    const before = local.snapshot();
    const pending = git.execute('clone', {url: 'https://example.invalid/clone', replace: true}, {signal: abort.signal});
    if (mode === 'edit' || mode === 'abort') {
      await started;
      if (mode === 'edit') local.write('/index.js', 'newer editor work\n'); else abort.abort();
      const current = local.snapshot(); release(); await assert.rejects(pending);
      assert.deepEqual(local.snapshot(), current);
    } else { await assert.rejects(pending, /Fixture connection failed|Remote project needs JavaScript/); assert.deepEqual(local.snapshot(), before); }
    assert.equal(closed, 1);
  }
});

test('project replacement while clone approval is pending closes the session without sending requests', async () => {
  let local = create(), entered, approve, requests = 0, closed = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const git = createProjectGit({getStore: () => local, beginRemote: async () => {
    entered(); await new Promise(resolve => { approve = resolve; });
    return {close: async () => { closed++; }, http: {request() { requests++; throw Error('Must not request'); }}};
  }});
  const pending = git.execute('clone', {url: 'https://example.invalid/clone', replace: true});
  await started; local = create(); const before = local.snapshot(); approve();
  await assert.rejects(pending, /Project changed/);
  assert.equal(requests, 0); assert.equal(closed, 1); assert.deepEqual(local.snapshot(), before);
});
