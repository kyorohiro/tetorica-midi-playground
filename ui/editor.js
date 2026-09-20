// Worker scripts use ECMAScript built-ins, not the browser Window/DOM API.
export function configureJavaScript(monaco) {
  const defaults = monaco.languages.typescript.javascriptDefaults;
  defaults.setCompilerOptions({...defaults.getCompilerOptions(), lib: ['es2022']});
  defaults.setDiagnosticsOptions({noSemanticValidation: true, noSyntaxValidation: true});
}

// Models retain per-file undo history and cursor/scroll state across FILES switches.
export function createFileEditor(monaco, container, onChange) {
  const models = new Map(), views = new Map();
  let current = null;
  const editor = monaco.editor.create(container, {
    model: null, theme: 'vs-dark', automaticLayout: true,
    minimap: {enabled: false}, fontSize: 14, tabSize: 2,
    scrollBeyondLastLine: false, ariaLabel: 'JavaScript editor',
  });
  const listener = editor.onDidChangeModelContent(() => {
    if (current && !current.readOnly) onChange(current.path, editor.getValue());
  });
  return {
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
  enableSoundChip: 'await enableSoundChip("ym2612" | "sega-psg"): initialize the native sound rack. Existing audio is preserved.',
  midi: 'midi.output(name, {channel: 1}): output handle. Internal IDs: tetorica-ym2612, tetorica-sega-psg. Call handle.play(note, {duration, velocity}).',
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
export function registerHelpers(monaco) {
  return monaco.languages.registerCompletionItemProvider('javascript', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn};
      return {suggestions: Object.entries(helperDocs).map(([name, detail]) => ({label: name, insertText: name, detail, kind: monaco.languages.CompletionItemKind.Function, range}))};
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
