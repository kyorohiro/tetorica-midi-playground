import {apiTypes} from './api-types.js';
import {tokenizer} from './vendor/acorn.mjs';
// Worker scripts use ECMAScript built-ins, not the browser Window/DOM API.
export function configureJavaScript(monaco) {
  const typescript = monaco.languages.typescript;
  const defaults = typescript.javascriptDefaults;
  defaults.setCompilerOptions({
    ...defaults.getCompilerOptions(),
    allowJs: true, allowNonTsExtensions: true, checkJs: true, noLib: false,
    lib: ['es2022'], target: typescript.ScriptTarget.ES2020,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.NodeJs,
    // Every FILES script has its own async evaluation scope at runtime.
    // Monaco 0.52 does not expose ModuleDetectionKind, but its worker supports Force (3).
    moduleDetection: 3,
  });
  defaults.addExtraLib(apiTypes, 'file:///tetorica-api.d.ts');
  defaults.setEagerModelSync(true);
  defaults.setDiagnosticsOptions({
    noSemanticValidation: false, noSyntaxValidation: false,
    // A Run file is the body of an async function, so an early return is valid.
    diagnosticCodesToIgnore: [1108],
  });
}

// Models retain per-file undo history and cursor/scroll state across FILES switches.
export function createFileEditor(monaco, container, onChange) {
  const models = new Map(), views = new Map();
  let current = null, reconciling = false;
  const editor = monaco.editor.create(container, {
    model: null, theme: 'vs-dark', automaticLayout: true,
    minimap: {enabled: false}, fontSize: 14, tabSize: 2,
    // Monaco 0.52's delayed word highlighter leaks a cancellation when switching models.
    occurrencesHighlight: 'off',
    // Suggest/hover widgets may extend beyond the workspace's clipped edges.
    fixedOverflowWidgets: true,
    scrollBeyondLastLine: false, ariaLabel: 'JavaScript editor',
    quickSuggestions: {other: true, comments: false, strings: true},
  });
  const listener = editor.onDidChangeModelContent(() => {
    if (current && !current.readOnly && !reconciling) onChange(current.path, editor.getValue());
  });
  return {
    editor,
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
        if (/\.m?js$/i.test(path) && typeof text === 'string' && !path.split('/').some(part=>part.toLowerCase()==='.git') && !models.has(path)) {
          models.set(path, monaco.editor.createModel(text, 'javascript', monaco.Uri.from({scheme: 'file', path})));
        }
      }
    },
    reconcileFiles(files, transfer = null) {
      // Unchanged models keep their undo history. Renamed models retain view state.
      reconciling = true;
      try {
        if (current) views.set(current.path, editor.saveViewState());
        for (const [path, model] of models) {
          if (!Object.hasOwn(files, path)) {
            if (transfer && (path === transfer.from || path.startsWith(transfer.from + '/'))) {
              const destination = transfer.to + path.slice(transfer.from.length);
              if (views.has(path)) views.set(destination, views.get(path));
            }
            if (current?.path === path) {current = null; editor.setModel(null);}
            model.dispose(); models.delete(path); views.delete(path);
          } else if (typeof files[path] === 'string' && model.getValue() !== files[path]) {
            model.setValue(files[path]);
          }
        }
        this.syncFiles(files);
      } finally { reconciling = false; }
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
  noteOn: 'noteOn(note, {channel: CH1, velocity: 90}): hold a note on the selected MIDI output until noteOff or Stop.',
  noteOff: 'noteOff(note, {channel: CH1, velocity: 0}): release a note; release velocity 0–127.',
  cc: 'cc(controller, value, {channel: CH1}): control change; controller/value 0–127.',
  programChange: 'programChange(program, {channel: CH1}): raw MIDI program number 0–127.',
  pitchBend: 'pitchBend(value, {channel: CH1}): -1 minimum, 0 center, +1 maximum; range depends on receiver.',
  channelPressure: 'channelPressure(value, {channel: CH1}): channel aftertouch, 0–127.',
  polyPressure: 'polyPressure(note, value, {channel: CH1}): per-note aftertouch, 0–127.',
  send: 'send(bytes): one complete MIDI message (Array or Uint8Array); raw notes are not automatically cleaned up.',

  context: 'Shared user state: context.value = ... . Preserved by Apply; reset by Run. Also available as pg.context.',
  pg: 'MIDI Playground API namespace: pg.play(), pg.liveLoop(), pg.midi.output(), pg.context.',
  ...Object.fromEntries(Array.from({length:16},(_,i)=>[`CH${i+1}`,`MIDI channel ${i+1}: numeric index ${i}.`])),
  ...Object.fromEntries([1,2,3,4].map(i=>[`MIDI_OUTPUT_0${i}`,`Logical output slot ${i}: assign a destination in MIDI connections, then pass to midi.output().`])),
  enableSoundChip: 'await enableSoundChip("ym2612" | "sega-psg"): initialize the native sound rack. Optional {roundRobin:false} pins YM2612 CH1..CH6; changing mode silences its notes.',
  midi: 'midi.output(name, {channel: CH1}): output handle. Internal IDs: tetorica-ym2612, tetorica-sega-psg. Call handle.play(note, {duration, velocity}). YM2612: handle.setVoice(preset), handle.loadVoice(path). Omit channel to set all channel voices.',
  playOutput: 'playOutput(handle, note, options): use the loop-local helper for imported functions or explicit liveLoop callbacks.',

  play: 'play(note, {duration, channel, velocity}): Promise<void>. Duration in beats; MIDI channel 0–15.',
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
  stopLoop: 'stopLoop(name): stop a loop and release its scoped notes. Quoted names complete from liveLoop calls in this file.',
  livePrepare: 'await livePrepare(name, async ({midi, context}) => value): initialize once per Run; Apply reuses the inferred result. Concurrent calls share initialization.',
  tween: 'await tween({seconds: 1}, async t => {...}) or tween({beats: 4}, callback): progress from 0 to 1; callbacks run in order. Loop-local tweens stop with their loop.',
  stopAllLoops: 'stopAllLoops(): stop all loops.',
  onKeyboardPressKey: 'onKeyboardPressKey(name, callback): focused Keyboard input keydown.',
  onKeyboardReleaseKey: 'onKeyboardReleaseKey(name, callback): focused Keyboard input keyup.',
};
// Inspect tokens so text resembling import() inside comments/strings is ignored.
function quotedCall(model, position) {
  if (!model.getValue || !model.getOffsetAt) return null;
  const source = model.getValue(), offset = model.getOffsetAt(position);
  const match = /(["'])((?:\\.|(?!\1)[^\\\r\n])*\\?)$/.exec(source.slice(0, offset));
  if (!match) return null;
  const quote = offset - match[0].length;
  let tokens;
  try {
    tokens = [...tokenizer(source.slice(0, quote) + '""', {ecmaVersion: 'latest'})];
    const [keyword, open, string] = tokens.slice(-3);
    if (open?.type.label !== '(' || string?.type.label !== 'string' || string.start !== quote) return null;
    const member = ['.', '?.'].includes(tokens.at(-4)?.type.label);
    const call = keyword?.type.label === 'import' ? 'import' : keyword?.value;
    if (!['import', 'stopLoop'].includes(call)) return null;
    if (member && (call === 'import' || tokens.at(-5)?.value !== 'pg' || ['.', '?.'].includes(tokens.at(-6)?.type.label))) return null;
    tokens.call = call;
  } catch { return null; }
  let end=offset,escaped=/\\+$/.exec(match[2])?.[0].length%2===1;
  for(;end<source.length;end++){
    const character=source[end];
    if(/[\r\n]/.test(character)||(!escaped&&character===match[1]))break;
    escaped=!escaped&&character==='\\';
  }
  return {call: tokens.call, quote: match[1], range: {
    startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
    startColumn: position.column - match[2].length, endColumn: position.column + end-offset,
  }};
}

function loopNames(source) {
  const tokens = [];
  try { for (const token of tokenizer(source, {ecmaVersion: 'latest'})) tokens.push(token); } catch { /* Keep valid tokens before unfinished code. */ }
  const names = new Set();
  tokens.forEach((token, i) => {
    if (token.type.label !== 'name' || token.value !== 'liveLoop' || tokens[i + 1]?.type.label !== '(' || tokens[i + 2]?.type.label !== 'string') return;
    if (['.', '?.'].includes(tokens[i - 1]?.type.label) && (tokens[i - 2]?.value !== 'pg' || ['.', '?.'].includes(tokens[i - 3]?.type.label))) return;
    names.add(tokens[i + 2].value);
  });
  return [...names].sort();
}

function relativeImportPath(from, to) {
  const base = from.split('/').slice(1, -1), target = to.split('/').slice(1);
  while (base.length && target.length && base[0] === target[0]) {base.shift(); target.shift();}
  return (base.length ? '../'.repeat(base.length) : './') + target.join('/');
}

export function registerHelpers(monaco, getFilePaths = () => [], definitionLinks = null) {
  return monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['"', "'", '/', '.'],
    provideCompletionItems(model, position) {
      const quoted = quotedCall(model, position);
      if (quoted?.call === 'stopLoop') {
        return {suggestions: loopNames(model.getValue()).map(name => ({label: name,
          insertText: JSON.stringify(name).slice(1,-1).replace(/'/g, quoted.quote === "'" ? "\\'" : "'"),
          detail: 'liveLoop in this file', kind: monaco.languages.CompletionItemKind.Value, range: quoted.range}))};
      }
      if (quoted?.call === 'import') {
        const from = model.uri.path;
        return {suggestions: getFilePaths()
          .filter(path => path !== from && /\.m?js$/i.test(path))
          .sort()
          .map(path => {
            const specifier = relativeImportPath(from, path);
            return {label: specifier, insertText: specifier, detail: path,
              kind: monaco.languages.CompletionItemKind.File, range: quoted.range};
          })};
      }
      const word = model.getWordUntilPosition(position);
      // Member completion comes from the language service, not global helper names.
      const prefix=model.getLineContent?.(position.lineNumber).slice(0,word.startColumn-1)??'';
      if(/\.\s*$/.test(prefix))return {suggestions:[]};
      const range = {startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn};
      return {suggestions: Object.entries(helperDocs).map(([name, detail]) => ({label: name, insertText: name, detail,
        documentation: definitionLinks?.documentation(detail,name) ?? detail,
        kind: monaco.languages.CompletionItemKind[name==='pg'||name==='context'?'Variable':'Function'], range}))};
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
