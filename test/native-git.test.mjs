import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGit} from '../ui/native-git.js';

test('native HTTP carries every byte with allowed headers only and closes a session once', async () => {
  const calls = [];
  const native = createNativeGit({invoke: async (command, args) => {
    calls.push({command, args});
    if (command === 'git_https_begin') return 'fixture-session';
    if (command === 'git_https_request') return {url: args.request.url, statusCode: 200, statusMessage: 'OK', headers: {}, body: Buffer.from([0, 255, 128, 7]).toString('base64')};
  }});
  const session = await native.beginRemote({url: 'https://example.invalid/repo.git', operation: 'push', branch: 'main', commit: 'a'.repeat(40)});
  const bytes = Uint8Array.from({length: 70000}, (_, i) => i % 256);
  const response = await session.http.request({url: 'https://example.invalid/repo.git/git-receive-pack', method: 'POST', headers: {'Content-Type': 'application/x-git-receive-pack-request', Accept: 'application/x-git-receive-pack-result', 'Git-Protocol': 'version=1', Authorization: 'must never cross', Cookie: 'must never cross'}, body: [bytes.subarray(0, 35000), bytes.subarray(35000)]});
  const request = calls.find(call => call.command === 'git_https_request').args.request;
  assert.deepEqual(Buffer.from(request.body, 'base64'), Buffer.from(bytes));
  assert.deepEqual(Object.keys(request.headers), ['Content-Type', 'Accept', 'Git-Protocol']);
  assert.deepEqual(response.body[0], Uint8Array.from([0, 255, 128, 7]));
  await session.close(); await session.close();
  assert.equal(calls.filter(call => call.command === 'git_https_end').length, 1);
});

test('PAT operations pass public metadata only and normalize native string failures to Error', async () => {
  const calls = [], native = createNativeGit({invoke: async (command, args) => {
    calls.push({command, args});
    if (args.request.action === 'list') return {tokens: [{id: 't1', name: 'Fixture', host: 'https://example.invalid'}], selectedId: 't1', supported: true, storage: 'fixture'};
    if (args.request.action === 'delete') throw 'Selection cancelled';
    return {};
  }});
  assert.equal((await native.tokens.list()).tokens[0].id, 't1');
  await native.tokens.add({name: 'Fixture', host: 'https://example.invalid', secret: 'must never cross'});
  await native.tokens.select('t1');
  await assert.rejects(native.tokens.remove('t1'), error => error instanceof Error && error.message === 'Selection cancelled');
  assert.deepEqual(calls.map(call => call.args.request), [{action: 'list'}, {action: 'add', name: 'Fixture', host: 'https://example.invalid'}, {action: 'select', id: 't1'}, {action: 'delete', id: 't1'}]);
});

test('aborting native HTTP ends its credential session and prevents publication of late bytes', async () => {
  let release, started; const entered = new Promise(resolve => { started = resolve; }); let ends = 0;
  const native = createNativeGit({invoke: async command => {
    if (command === 'git_https_begin') return 'fixture';
    if (command === 'git_https_end') { ends++; return; }
    started(); await new Promise(resolve => { release = resolve; });
    return {body: '', statusCode: 200};
  }});
  const session = await native.beginRemote({}), abort = new AbortController();
  const pending = session.http.request({url: 'https://example.invalid/repo.git', signal: abort.signal});
  await entered; abort.abort(); release(); await assert.rejects(pending, {name: 'AbortError'}); await session.close();
  assert.equal(ends, 1);
});

test('oversized native request bodies are rejected before IPC and Error objects remain writable', async () => {
  let requests = 0;
  const native = createNativeGit({invoke: async command => {
    if (command === 'git_https_request') requests++;
    return 'fixture';
  }});
  const session = await native.beginRemote({});
  await assert.rejects(session.http.request({url: 'https://example.invalid', body: [new Uint8Array(64 * 1024 * 1024), new Uint8Array(1)]}), /exceeds 64 MiB/);
  assert.equal(requests, 0); await session.close();
  const failing = createNativeGit({invoke: async () => { throw {message: 'Native failure'}; }});
  await assert.rejects(failing.beginRemote({}), error => { error.caller = 'git.fetch'; return error.message === 'Native failure'; });
});
