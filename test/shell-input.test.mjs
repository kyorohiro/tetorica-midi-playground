import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem} from '../ui/shared/virtual-files/filesystem.js';
import {parsePipeline} from '../ui/shared/virtual-files/pipeline.js';
import {completeShellPath, installShellInput} from '../ui/shell-input.js';

function filesystem() {
  const fs = createVirtualFileSystem([
    {path: '/index.js', data: ''}, {path: '/lib/piano.js', data: ''}, {path: '/lib/picker.js', data: ''},
    {path: '/lib/preset one.json', data: '{}'}, {path: '/lib/quote"two.txt', data: ''},
    {path: '/lib/semicolon;name.txt', data: ''}, {path: '/sounds/lead.tfi', data: new Uint8Array([1, 2])},
  ]);
  fs.mkdir('/empty');
  return fs;
}

test('Tab completes relative/absolute directories and text or binary files without reading their bytes', () => {
  const fs = filesystem();
  for (const [cwd, source, expected] of [
    ['/', 'cd li', 'cd lib/'], ['/', 'cat in', 'cat index.js '],
    ['/', 'cat /sounds/le', 'cat /sounds/lead.tfi '],
    ['/lib', 'cat ./pia', 'cat ./piano.js '], ['/lib', 'cat ../in', 'cat ../index.js '],
    ['/', 'cd em', 'cd empty/'],
  ]) assert.equal(completeShellPath(fs, cwd, source).source, expected);
  assert.equal(fs.get('/sounds/lead.tfi').type, 'binary');
});

test('quoted/escaped spaces and shell syntax characters complete into executable literal arguments', () => {
  const fs = filesystem();
  for (const source of ['cat "lib/pre', "cat 'lib/pre", 'cat lib/preset\\ o']) {
    const result = completeShellPath(fs, '/', source);
    assert.equal(result.source, 'cat "lib/preset one.json" ');
    assert.deepEqual(parsePipeline(result.source)[0].args, ['cat', 'lib/preset one.json']);
  }
  const quote = completeShellPath(fs, '/lib', 'cat quo');
  assert.equal(quote.source, 'cat "quote\\"two.txt" ');
  assert.deepEqual(parsePipeline(quote.source)[0].args, ['cat', 'quote"two.txt']);
  assert.deepEqual(parsePipeline(completeShellPath(fs, '/lib', 'cat sem').source)[0].args, ['cat', 'semicolon;name.txt']);
});

test('pipeline and input/output redirect paths complete without treating commands as paths', () => {
  const fs = filesystem();
  for (const [source, expected] of [
    ['cat index.js | cat lib/pia', 'cat index.js | cat lib/piano.js '],
    ['echo hello >lib/pia', 'echo hello >lib/piano.js '],
    ['echo hello >> lib/pia', 'echo hello >> lib/piano.js '],
    ['cat < lib/pia', 'cat < lib/piano.js '],
  ]) assert.equal(completeShellPath(fs, '/', source).source, expected);
  for (const source of ['', 'li', 'cat lib/missing', 'cat ../../', 'cat lib/pia\\', 'echo foo; cat lib/pia']) {
    assert.deepEqual(completeShellPath(fs, '/', source), {source, matches: []});
  }
});

test('multiple matches extend their common prefix and remain available when no further extension exists', () => {
  const fs = filesystem();
  fs.remove('/lib/preset one.json');
  const expected = ['lib/piano.js', 'lib/picker.js'];
  assert.deepEqual(completeShellPath(fs, '/', 'cat lib/p'), {source: 'cat lib/pi', matches: expected});
  assert.deepEqual(completeShellPath(fs, '/', 'cat lib/pi'), {source: 'cat lib/pi', matches: expected});
  assert.equal(completeShellPath(fs, '/', 'cat lib/').matches.length, 4);
});

function inputFixture() {
  class Input extends EventTarget {
    value = ''; selectionStart = 0; selectionEnd = 0; readOnly = false; disabled = false;
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  }
  const input = new Input(), fs = filesystem(), matches = [];
  let fsReads = 0, scrolls = 0, changes = 0;
  input.addEventListener('input', () => changes++);
  const binding = installShellInput({input, getFs: () => { fsReads++; return fs; }, getCwd: () => '/', onMatches: (...args) => matches.push(args), scroll: () => scrolls++});
  return {
    input, fs, matches, binding,
    get fsReads() { return fsReads; }, get scrolls() { return scrolls; }, get changes() { return changes; },
    set(text, start = text.length, end = start) { input.value = text; input.setSelectionRange(start, end); },
    key(key, options = {}) {
      const event = Object.assign(new Event('keydown', {cancelable: true}), {key, ...options});
      input.dispatchEvent(event); return event;
    },
  };
}

test('completion reads the latest FILES view only when the caret is at the input end', () => {
  const f = inputFixture();
  f.fs.remove('/lib/preset one.json');
  f.set('cat lib/p'); f.key('Tab');
  assert.equal(f.input.value, 'cat lib/pi'); assert.equal(f.fsReads, 1); assert.equal(f.changes, 1);
  assert.deepEqual(f.matches[0], [['lib/piano.js', 'lib/picker.js'], 'cat lib/pi']);
  f.fs.remove('/lib/picker.js');
  f.key('Tab'); assert.equal(f.input.value, 'cat lib/piano.js '); assert.equal(f.fsReads, 2);
  assert.equal(f.input.selectionEnd, f.input.value.length);
  f.set('cat index.js', 4); assert.equal(f.key('Tab').defaultPrevented, true);
  f.set('cat index.js', 4, 12); f.key('Tab');
  assert.equal(f.input.value, 'cat index.js'); assert.equal(f.fsReads, 2);
});

test('Ctrl+A/E/B/F move within a line, collapse selections and preserve Unicode characters', () => {
  const f = inputFixture(); f.set('cat 🎹.js');
  f.key('a', {ctrlKey: true}); assert.equal(f.input.selectionStart, 0);
  f.key('e', {ctrlKey: true}); assert.equal(f.input.selectionStart, 9);
  f.set('cat 🎹.js', 4); f.key('f', {ctrlKey: true}); assert.equal(f.input.selectionStart, 6);
  f.key('b', {ctrlKey: true}); assert.equal(f.input.selectionStart, 4);
  f.input.setSelectionRange(2, 6); f.key('b', {ctrlKey: true}); assert.equal(f.input.selectionStart, 2);
  f.input.setSelectionRange(2, 6); f.key('f', {ctrlKey: true}); assert.equal(f.input.selectionStart, 6);
  assert.equal(f.input.value, 'cat 🎹.js'); assert.equal(f.changes, 0); assert.equal(f.fsReads, 0);
});

test('Ctrl+U/K/W remove the expected line regions or selected text and notify input observers', () => {
  const f = inputFixture();
  f.set('cat lib/piano.js', 4); f.key('u', {ctrlKey: true}); assert.equal(f.input.value, 'lib/piano.js'); assert.equal(f.input.selectionStart, 0);
  f.set('cat lib/piano.js', 4); f.key('k', {ctrlKey: true}); assert.equal(f.input.value, 'cat ');
  f.set('cat lib/piano.js   '); f.key('w', {ctrlKey: true}); assert.equal(f.input.value, 'cat ');
  f.set('cat lib/piano.js', 4, 7); f.key('w', {ctrlKey: true}); assert.equal(f.input.value, 'cat /piano.js'); assert.equal(f.input.selectionStart, 4);
  f.set('cat lib/piano.js', 4, 7); f.key('u', {ctrlKey: true}); assert.equal(f.input.value, '/piano.js');
  f.set('cat lib/piano.js', 4, 7); f.key('k', {ctrlKey: true}); assert.equal(f.input.value, 'cat ');
  assert.equal(f.changes, 6);
});

test('busy, disabled, composition and modified keys preserve native editing and existing history shortcuts', () => {
  const f = inputFixture(); f.set('cat in');
  for (const options of [{readOnly: true}, {disabled: true}]) {
    Object.assign(f.input, options);
    assert.equal(f.key('Tab').defaultPrevented, false);
    assert.equal(f.key('u', {ctrlKey: true}).defaultPrevented, false);
    Object.assign(f.input, {readOnly: false, disabled: false});
  }
  for (const [key, options] of [
    ['Tab', {shiftKey: true}], ['Tab', {ctrlKey: true}], ['Tab', {isComposing: true}],
    ['Tab', {keyCode: 229}], ['a', {metaKey: true}], ['a', {ctrlKey: true, metaKey: true}],
    ['a', {ctrlKey: true, altKey: true}], ['a', {ctrlKey: true, shiftKey: true}],
    ['u', {ctrlKey: true, isComposing: true}], ['c', {ctrlKey: true}], ['l', {ctrlKey: true}],
    ['ArrowUp', {}], ['ArrowDown', {}], ['Enter', {}],
  ]) assert.equal(f.key(key, options).defaultPrevented, false, key + JSON.stringify(options));
  assert.equal(f.input.value, 'cat in'); assert.equal(f.fsReads, 0); assert.equal(f.changes, 0);
  f.binding.dispose(); f.binding.dispose();
  assert.equal(f.key('Tab').defaultPrevented, false);
  assert.equal(f.key('a', {ctrlKey: true}).defaultPrevented, false);
});
