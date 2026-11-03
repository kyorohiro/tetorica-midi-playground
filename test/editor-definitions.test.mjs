import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {apiTypes} from '../ui/api-types.js';
import {
  declarationTarget, definitionSource, runtimeImport, runtimeSourceFile, sourcePosition,
} from '../ui/editor-definitions.js';

function selectedText(text, range) {
  assert.ok(range, 'A declaration range is required');
  assert.equal(range.startLineNumber, range.endLineNumber);
  return text.split('\n')[range.startLineNumber - 1].slice(range.startColumn - 1, range.endColumn - 1);
}

test('public types, globals and qualified members select their actual declaration tokens', () => {
  for (const name of ['MidiOutput', 'MidiPlayOptions', 'Ym2612Preset', 'midi', 'play', 'CH16', 'MIDI_OUTPUT_01','livePrepare','LivePrepareContext','tween','TweenDuration']) {
    assert.equal(selectedText(apiTypes, declarationTarget(name)), name);
  }
  for (const name of ['MidiOutput.play', 'MidiOutput.setVoice', 'MidiOutput.loadVoice', 'MidiPlayOptions.duration', 'midi.output', 'midi.enableSoundChip', 'Ym2612Preset.operators', 'TetoricaContext.noteOff', 'TetoricaContext.playOutput']) {
    assert.equal(selectedText(apiTypes, declarationTarget(name)), name.split('.').at(-1), name);
  }
  assert.deepEqual(declarationTarget('PlaygroundAPI.play'), declarationTarget('TetoricaContext.play'));
  assert.deepEqual(declarationTarget('MidiNoteOptions.duration'), declarationTarget('MidiPlayOptions.duration'));
  assert.deepEqual(declarationTarget('MidiOnOptions.channel'), declarationTarget('MidiChannelOptions.channel'));
  assert.deepEqual(declarationTarget('MidiOffOptions.channel'), declarationTarget('MidiChannelOptions.channel'));
});

test('declaration links reject unknown names, comment words, nested nonpublic fields and paths', () => {
  for (const value of ['', null, {}, 'unknown', 'duration', 'MidiOutput.noSuchMethod', 'PlaygroundAPI.pg', 'MidiOutput.play.duration', 'Ym2612Preset.left', '../runner.js', 'file:///runner.js', 'MidiOutput?x', 'MidiOutput%2Eplay']) {
    assert.equal(declarationTarget(value), null, String(value));
  }
  const text = `/** interface Pretend { ghost(): void; } */
interface Real {
  /** phantom: string; */
  play(note: string, options?: {velocity?: number}): void;
  state: {nested: boolean};
}
declare const route: { first: number; second: number; };
`;
  for (const name of ['Pretend', 'Real.ghost', 'Real.phantom', 'Real.note', 'Real.options', 'Real.velocity', 'Real.nested']) assert.equal(declarationTarget(name, text), null, name);
  for (const name of ['Real', 'Real.play', 'Real.state', 'route.first', 'route.second']) assert.equal(selectedText(text, declarationTarget(name, text)), name.split('.').at(-1), name);
});

test('type declarations lead to the functions that implement the MIDI API', async () => {
  const cases = [
    ['MidiOutput', 'midi-output.js', 'output'],
    ['MidiOutput.play', 'midi-output.js', 'playOutput'],
    ['MidiOutput.setVoice', 'midi-output.js', 'setVoice'],
    ['midi.output', 'midi-output.js', 'output'],
    ['midi.enableSoundChip', 'midi-output.js', 'enableSoundChip'],
    ['MidiPlayOptions', 'runtime.js', 'play'],
    ['Ym2612Preset', 'ym2612-voice.js', 'voiceBytes'],
    ['Ym2612Operator.multi', 'ym2612-voice.js', 'voiceBytes'],
    ['TetoricaContext.noteOff', 'midi-primitives.js', 'noteOff'],
    ['liveLoop', 'loops.js', 'liveLoop'],
    ['onKeyboardPressKey', 'keyboard.js', 'onKeyboardPressKey'],
    ['MIDI_OUTPUT_04', 'output-mappings.js', 'outputSlots'],
    ['CH1', 'midi-channels.js', 'channels'],
    ['livePrepare','live-prepare.js','createLivePrepare'],
    ['LivePrepareContext','live-prepare.js','createLivePrepare'],
    ['PlaygroundAPI.livePrepare','live-prepare.js','createLivePrepare'],
    ['tween','tween.js','createTween'],
    ['TweenDuration','tween.js','createTween'],
    ['TetoricaContext.tween','tween.js','createTween'],
  ];
  for (const [name, file, symbol] of cases) {
    assert.deepEqual(definitionSource(apiTypes, declarationTarget(name)), {file, symbol}, name);
    const source = await readFile(new URL(`../ui/${file}`, import.meta.url), 'utf8');
    const position = sourcePosition(source, symbol);
    assert.notDeepEqual(position, {lineNumber: 1, column: 1}, name);
    assert.equal(source.split('\n')[position.lineNumber - 1].slice(position.column - 1, position.column - 1 + symbol.length), symbol, name);
  }
});

test('implementation position prefers a function body over a forwarding property or comment', () => {
  const source = `// function setVoice(wrong) {}
const handle={setVoice:input=>setVoice(input)};
async function setVoice(input) { return input; }
`;
  assert.deepEqual(sourcePosition(source, 'setVoice'), {lineNumber: 3, column: 16});
  assert.deepEqual(sourcePosition('const api={noteOn(note){return note;}};', 'noteOn'), {lineNumber: 1, column: 12});
  assert.deepEqual(sourcePosition(source, '../app.js'), {lineNumber: 1, column: 1});
});

test('runtime import lookup follows local aliases and cache versions without executing code', () => {
  const source = `import {voiceSysEx as makeVoice, voiceBytes} from './ym2612-voice.js?v=1';
import {noteNumber} from './runtime.js';
import elsewhere from 'https://example.com/script.js';
import parser from './vendor/acorn.mjs';
import * as music from '../runtime.js';
`;
  assert.deepEqual(runtimeImport(source, 'makeVoice'), {specifier: './ym2612-voice.js?v=1', symbol: 'voiceSysEx'});
  assert.deepEqual(runtimeImport(source, 'voiceBytes'), {specifier: './ym2612-voice.js?v=1', symbol: 'voiceBytes'});
  assert.deepEqual(runtimeImport(source, 'noteNumber'), {specifier: './runtime.js', symbol: 'noteNumber'});
  assert.deepEqual(runtimeImport(source, 'parser'), {specifier: './vendor/acorn.mjs', symbol: 'default'});
  assert.deepEqual(runtimeImport(source, 'music'), {specifier: '../runtime.js', symbol: 'default'});
  assert.equal(runtimeImport(source, 'elsewhere'), null);
  assert.equal(runtimeImport(source, 'unknown'), null);
});

test('runtime sources are contained in a fixed allowlist separate from project files', () => {
  assert.equal(runtimeSourceFile('file:///tetorica-runtime/midi-output.js'), 'midi-output.js');
  assert.equal(runtimeSourceFile('file:///tetorica-runtime/shared/vgi.js?v=1#anchor'), 'shared/vgi.js');
  assert.equal(runtimeSourceFile('file:///tetorica-runtime/vendor/acorn.mjs'), 'vendor/acorn.mjs');
  assert.equal(runtimeSourceFile('file:///tetorica-runtime/live-prepare.js'),'live-prepare.js');
  assert.equal(runtimeSourceFile('file:///tetorica-runtime/tween.js'),'tween.js');
  for (const path of [
    'file:///index.js', 'file:///tetorica-api.d.ts', 'file:///tetorica-runtime/app.js',
    'file:///tetorica-runtime/../../app.js', 'file:///tetorica-runtime/%2e%2e/app.js',
    'file:///tetorica-runtime/%6didi-output.js', 'file://example.com/tetorica-runtime/midi-output.js',
    'https://example.com/tetorica-runtime/midi-output.js', 'file:///tetorica-runtime/sub/../app.js',
    '../midi-output.js', 'data:text/javascript,alert(1)',
  ]) assert.equal(runtimeSourceFile(path), null, path);
});
