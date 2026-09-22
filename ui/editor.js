import {apiTypes} from './api-types.js';
import {tokenizer} from './vendor/acorn.mjs';
// Worker scripts use ECMAScript built-ins, not the browser Window/DOM API.
export function configureJavaScript(monaco) {
  const defaults = monaco.languages.typescript.javascriptDefaults;
  defaults.setCompilerOptions({...defaults.getCompilerOptions(), lib: ['es2022']});
  defaults.addExtraLib(apiTypes, 'file:///tetorica-api.d.ts');
  defaults.setEagerModelSync(true);
  defaults.setDiagnosticsOptions({noSemanticValidation: true, noSyntaxValidation: true});
}

// Models retain per-file undo history and cursor/scroll state across FILES switches.
export function createFileEditor(monaco, container, onChange) {
  const models = new Map(), views = new Map();
  let current = null;
  const editor = monaco.editor.create(container, {
    model: null, theme: 'vs-dark', automaticLayout: true,
    minimap: {enabled: false}, fontSize: 14, tabSize: 2,
    // Suggest/hover widgets may extend beyond the workspace's clipped edges.
    fixedOverflowWidgets: true,
    scrollBeyondLastLine: false, ariaLabel: 'JavaScript editor',
    quickSuggestions: {other: true, comments: false, strings: true},
  });
  const listener = editor.onDidChangeModelContent(() => {
    if (current && !current.readOnly) onChange(current.path, editor.getValue());
  });
  return {
    replaceFiles(files) {
      // Detach before disposal so replacement never saves stale text into the new project.
      current = null;
      editor.setModel(null);
      for (const model of models.values()) model.dispose();
      models.clear(); views.clear();
      this.syncFiles(files);
    },
    syncFiles(files) {
      for (const [path, text] of Object.entries(files)) {
        if (/\.m?js$/i.test(path) && !models.has(path)) {
          models.set(path, monaco.editor.createModel(text, 'javascript', monaco.Uri.from({scheme: 'file', path})));
        }
      }
    },
    open(path, text, readOnly) {
      if (current) views.set(current.path, editor.saveViewState());
      let model = models.get(path);
      if (!model) {
        model = monaco.editor.createModel(text, /\.m?js$/i.test(path) ? 'javascript' : 'markdown', monaco.Uri.from({scheme: 'file', path}));
        models.set(path, model);
      }
      current = {path, readOnly};
      editor.setModel(model);
      editor.updateOptions({readOnly});
      if (views.has(path)) editor.restoreViewState(views.get(path));
    },
    dispose() {listener.dispose(); editor.dispose(); for (const model of models.values()) model.dispose();},
  };
}

export const helperDocs = {
  noteOn: 'noteOn(note, {channel: 1, velocity: 90}): hold a note on the selected MIDI output until noteOff or Stop.',
  noteOff: 'noteOff(note, {channel: 1, velocity: 0}): release a note; release velocity 0–127.',
  cc: 'cc(controller, value, {channel: 1}): control change; controller/value 0–127.',
  programChange: 'programChange(program, {channel: 1}): raw MIDI program number 0–127.',
  pitchBend: 'pitchBend(value, {channel: 1}): -1 minimum, 0 center, +1 maximum; range depends on receiver.',
  channelPressure: 'channelPressure(value, {channel: 1}): channel aftertouch, 0–127.',
  polyPressure: 'polyPressure(note, value, {channel: 1}): per-note aftertouch, 0–127.',
  send: 'send(bytes): one complete MIDI message (Array or Uint8Array); raw notes are not automatically cleaned up.',

  context: 'Shared user state: context.value = ... . Preserved by Apply; reset by Run. Also available as pg.context.',
  pg: 'MIDI Playground API namespace: pg.play(), pg.liveLoop(), pg.midi.output(), pg.context.',
  ...Object.fromEntries([1,2,3,4].map(i=>[`MIDI_OUTPUT_0${i}`,`Logical output slot ${i}: assign a destination in MIDI connections, then pass to midi.output().`])),
  enableSoundChip: 'await enableSoundChip("ym2612" | "sega-psg"): initialize the native sound rack. Existing audio is preserved.',
  midi: 'midi.output(name, {channel: 1}): output handle. Internal IDs: tetorica-ym2612, tetorica-sega-psg. Call handle.play(note, {duration, velocity}). YM2612: handle.setVoice(preset), handle.loadVoice(path). Omit channel to set all channel voices.',
  playOutput: 'playOutput(handle, note, options): use the loop-local helper for imported functions or explicit liveLoop callbacks.',

  play: 'play(note, {duration, channel, velocity}): Promise<void>. Duration in beats; MIDI channel 1–16.',
  beat: 'beat(count = 1): Promise<void>. Wait in beats.',
  nextBeat: 'nextBeat(): Promise<void>. Wait for the next internal beat.',
  setBpm: 'setBpm(bpm): change internal tempo.',
  choose: 'choose(array): choose a random element.',
  cycle: 'cycle(array) or cycle(key, array): next element.',
  scale: 'scale(root, name, octaves = 1): note names. major, minor, majorPentatonic, minorPentatonic.',
  chord: 'chord(root, name): note names. major, minor, major7, minor7, dominant7.',
  rand: 'rand(): random number in [0, 1).',
  rrange: 'rrange(min, max): random number.',
  randInt: 'randInt(min, max): inclusive random integer.',
  lerp: 'lerp(a, b, t): linear interpolation.',
  noteLerp: 'noteLerp(from, to, t): nearest integer MIDI note, not Pitch Bend.',
  log: 'log(...values): write to Console.',
  liveLoop: 'liveLoop(name, async ({play, beat, cycle}) => {...}): named repeating loop.',
  stopLoop: 'stopLoop(name): stop a loop and release its scoped notes.',
  stopAllLoops: 'stopAllLoops(): stop all loops.',
  onKeyboardPressKey: 'onKeyboardPressKey(name, callback): focused Keyboard input keydown.',
  onKeyboardReleaseKey: 'onKeyboardReleaseKey(name, callback): focused Keyboard input keyup.',
};
// Inspect tokens so text resembling import() inside comments/strings is ignored.
function importPathRange(model, position) {
  if (!model.getValue || !model.getOffsetAt) return null;
  const source = model.getValue(), offset = model.getOffsetAt(position);
  const match = /(["'])([^"'\\\r\n]*)$/.exec(source.slice(0, offset));
  if (!match) return null;
  const quote = offset - match[0].length;
  try {
    const tokens = [...tokenizer(source.slice(0, quote) + '""', {ecmaVersion: 'latest'})];
    const [keyword, open, string] = tokens.slice(-3);
    if (keyword?.type.label !== 'import' || open?.type.label !== '(' || string?.type.label !== 'string' || string.start !== quote) return null;
    if (['.', '?.'].includes(tokens.at(-4)?.type.label)) return null;
  } catch { return null; }
  const suffix = /^[^"'\\\r\n]*/.exec(source.slice(offset))[0];
  return {
    startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
    startColumn: position.column - match[2].length, endColumn: position.column + suffix.length,
  };
}

function relativeImportPath(from, to) {
  const base = from.split('/').slice(1, -1), target = to.split('/').slice(1);
  while (base.length && target.length && base[0] === target[0]) {base.shift(); target.shift();}
  return (base.length ? '../'.repeat(base.length) : './') + target.join('/');
}

export function registerHelpers(monaco, getFilePaths = () => []) {
  return monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['"', "'", '/', '.'],
    provideCompletionItems(model, position) {
      const importRange = importPathRange(model, position);
      if (importRange) {
        const from = model.uri.path;
        return {suggestions: getFilePaths()
          .filter(path => path !== from && /\.m?js$/i.test(path))
          .sort()
          .map(path => {
            const specifier = relativeImportPath(from, path);
            return {label: specifier, insertText: specifier, detail: path,
              kind: monaco.languages.CompletionItemKind.File, range: importRange};
          })};
      }
      const word = model.getWordUntilPosition(position);
      // Member completion comes from the language service, not global helper names.
      const prefix=model.getLineContent?.(position.lineNumber).slice(0,word.startColumn-1)??'';
      if(/\.\s*$/.test(prefix))return {suggestions:[]};
      const range = {startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn};
      return {suggestions: Object.entries(helperDocs).map(([name, detail]) => ({label: name, insertText: name, detail, kind: monaco.languages.CompletionItemKind[name==='pg'||name==='context'?'Variable':'Function'], range}))};
    },
  });
}
export async function loadMonaco() {
  const base = new URL('./vendor/monaco/vs', import.meta.url).href;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = base + '/loader.js'; script.onload = resolve;
    script.onerror = () => reject(new Error('Monaco unavailable; using text editor.'));
    document.head.append(script);
  });
  window.require.config({paths: {vs: base}});
  return new Promise((resolve, reject) => window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject));
}
