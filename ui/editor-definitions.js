import {apiTypes} from './api-types.js';

const declarationUri = 'file:///tetorica-api.d.ts';
const runtimePrefix = '/tetorica-runtime/';
// Only shipped sources are readable. Never turn a project path or URL into a fetch.
const runtimeFiles = new Set([
  'runtime.js', 'loops.js', 'midi-primitives.js', 'keyboard.js', 'runner.js',
  'midi-output.js', 'output-mappings.js', 'midi-channels.js', 'ym2612-voice.js',
  'project-assets.js', 'loop-context.js', 'clock-wait.js', 'clock-receiver.js',
  'live-prepare.js', 'tween.js',
  'external-clock.js', 'modules.js', 'shared/tfi.js', 'shared/vgi.js', 'shared/pitch.js',
  'shared/playground_execution.js', 'vendor/acorn.mjs', 'vendor/module-lexer.js',
]);

const identifier = /^[A-Za-z_$][\w$]*$/;
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Preserve offsets while hiding comments and strings from the declaration index.
function maskNonCode(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    match => match.replace(/[^\n]/g, ' '));
}

function textRange(text, offset, length) {
  const prefix = text.slice(0, offset), line = prefix.split('\n').length;
  const column = offset - prefix.lastIndexOf('\n');
  return {startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column + length};
}

let indexedText = null, indexedSymbols = null;
function declarationIndex(text) {
  if (text === indexedText) return indexedSymbols;
  const code = maskNonCode(text), symbols = new Map();
  const declarations = [...code.matchAll(/^(?:declare\s+)?(interface|type|function|const|let|var|class|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm)];
  for (const declaration of declarations) {
    const [, kind, name] = declaration;
    const offset = declaration.index + declaration[0].lastIndexOf(name);
    if (!symbols.has(name)) symbols.set(name, {offset, length: name.length, owner: name});
    // Interfaces and declared object globals have addressable top-level members.
    if (kind !== 'interface' && !['const', 'let', 'var'].includes(kind)) continue;
    const lineEnd = code.indexOf('\n', offset);
    const open = code.indexOf('{', offset);
    if (open < 0 || (lineEnd >= 0 && open > lineEnd)) continue;
    let braces = 1, parentheses = 0, brackets = 0, start = open + 1;
    for (let i = start; i < code.length && braces; i++) {
      const char = code[i];
      if (braces === 1 && parentheses === 0 && brackets === 0 && (i === start || code[i - 1] === ';')) {
        const member = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*(?::|\()/.exec(code.slice(i));
        if (member) {
          const memberOffset = i + member[0].indexOf(member[1]);
          const key = `${name}.${member[1]}`;
          if (!symbols.has(key)) symbols.set(key, {offset: memberOffset, length: member[1].length, owner: name});
        }
      }
      if (char === '{') braces++;
      else if (char === '}') braces--;
      else if (char === '(') parentheses++;
      else if (char === ')') parentheses--;
      else if (char === '[') brackets++;
      else if (char === ']') brackets--;
    }
  }
  indexedText = text; indexedSymbols = symbols;
  return symbols;
}

const apiSymbols = declarationIndex(apiTypes);

/** Resolve a public type/global/member without executing or inspecting project code. */
export function declarationTarget(symbol, text = apiTypes) {
  if (typeof symbol !== 'string' || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(symbol)) return null;
  const symbols = text === apiTypes ? apiSymbols : declarationIndex(text);
  let entry = symbols.get(symbol);
  if (!entry && symbol.startsWith('PlaygroundAPI.') && symbol !== 'PlaygroundAPI.pg') {
    entry = symbols.get(symbol.replace('PlaygroundAPI.', 'TetoricaContext.'));
  }
  if (!entry && symbol.startsWith('MidiNoteOptions.')) entry = symbols.get(symbol.replace('MidiNoteOptions.', 'MidiPlayOptions.'));
  if (!entry && /^(MidiOnOptions|MidiOffOptions)\.channel$/.test(symbol)) entry = symbols.get('MidiChannelOptions.channel');
  return entry ? textRange(text, entry.offset, entry.length) : null;
}

function offsetAt(text, position) {
  const line = position?.startLineNumber ?? position?.lineNumber ?? 1;
  const column = position?.startColumn ?? position?.column ?? 1;
  const lines = text.split('\n');
  return lines.slice(0, line - 1).reduce((length, value) => length + value.length + 1, 0) + column - 1;
}

/** Map the declaration being read to the code that implements it. */
export function definitionSource(text, position) {
  const offset = offsetAt(text, position);
  const entry = [...(text === apiTypes ? apiSymbols : declarationIndex(text))].find(([, value]) => offset >= value.offset && offset <= value.offset + value.length);
  if (!entry) return null;
  const [qualified, {owner}] = entry;
  let symbol = qualified.split('.').at(-1);
  if (['PlaygroundAPI', 'TetoricaContext'].includes(owner) && symbol !== owner) return sourceForGlobal(symbol);
  if (owner === 'MidiOutput') {
    return {file: 'midi-output.js', symbol: {play: 'playOutput', setVoice: 'setVoice'}[symbol] ?? 'output'};
  }
  if (owner === 'midi') return {file: 'midi-output.js', symbol: symbol === 'enableSoundChip' ? symbol : symbol === 'output' ? symbol : 'createOutputApi'};
  if (['Ym2612Preset', 'Ym2612Operator'].includes(owner)) return {file: 'ym2612-voice.js', symbol: 'voiceBytes'};
  if (['MidiPlayOptions', 'MidiNoteOptions'].includes(owner)) return {file: 'runtime.js', symbol: 'play'};
  if (['MidiChannelOptions', 'MidiOnOptions', 'MidiOffOptions'].includes(owner)) return {file: 'midi-primitives.js', symbol: 'createMidiPrimitives'};
  if (['MidiOutputSlot', 'MidiDestination'].includes(owner)) return {file: 'output-mappings.js', symbol: owner === 'MidiOutputSlot' ? 'outputSlots' : 'resolveOutput'};
  if (['Ym2612ChipId', 'SoundChipId', 'Ym2612SoundChipOptions'].includes(owner)) return {file: 'midi-output.js', symbol: 'enableSoundChip'};
  if (owner === 'PlaygroundKeyEvent') return {file: 'keyboard.js', symbol: 'keyData'};
  if (owner === 'LivePrepareContext') return {file: 'live-prepare.js', symbol: 'createLivePrepare'};
  if (owner === 'TweenDuration') return {file: 'tween.js', symbol: 'createTween'};
  if (owner === 'MidiNote') return {file: 'runtime.js', symbol: 'noteNumber'};
  if (['PlaygroundAPI', 'TetoricaContext', 'PlaygroundContext'].includes(owner)) return {file: 'runner.js', symbol: 'api'};
  return sourceForGlobal(symbol);
}

function sourceForGlobal(symbol) {
  if (symbol === 'livePrepare') return {file: 'live-prepare.js', symbol: 'createLivePrepare'};
  if (symbol === 'tween') return {file: 'tween.js', symbol: 'createTween'};
  if (['noteOn', 'noteOff', 'cc', 'programChange', 'pitchBend', 'channelPressure', 'polyPressure', 'send'].includes(symbol)) return {file: 'midi-primitives.js', symbol};
  if (['play', 'beat', 'nextBeat', 'setBpm', 'choose', 'cycle', 'scale', 'chord', 'rand', 'rrange', 'randInt', 'lerp', 'noteLerp'].includes(symbol)) return {file: 'runtime.js', symbol};
  if (['liveLoop', 'stopLoop', 'stopAllLoops'].includes(symbol)) return {file: 'loops.js', symbol};
  if (['onKeyboardPressKey', 'onKeyboardReleaseKey'].includes(symbol)) return {file: 'keyboard.js', symbol};
  if (['playOutput', 'enableSoundChip'].includes(symbol)) return {file: 'midi-output.js', symbol};
  if (/^MIDI_OUTPUT_0[1-4]$/.test(symbol)) return {file: 'output-mappings.js', symbol: 'outputSlots'};
  if (/^CH(?:[1-9]|1[0-6])$/.test(symbol)) return {file: 'midi-channels.js', symbol: 'channels'};
  if (['pg', 'context', 'log', 'console'].includes(symbol)) return {file: 'runner.js', symbol: symbol === 'console' ? 'log' : symbol};
  return null;
}

/** Find a function, binding, method or object property in a shipped source file. */
export function sourcePosition(text, symbol) {
  if (!identifier.test(symbol)) return {lineNumber: 1, column: 1};
  const escaped = escapeRegex(symbol), code = maskNonCode(text);
  // Prefer the implementation function over an earlier forwarding object property.
  const patterns = [
    new RegExp(`\\b(?:async\\s+)?function\\s+(${escaped})\\s*\\(`, 'm'),
    new RegExp(`\\b(?:const|let|var|class)\\s+(${escaped})\\s*(?:=|\\{)`, 'm'),
    new RegExp(`(?:^|[;{,]\\s*)\\s*(?:async\\s+)?(${escaped})\\s*(?:\\(|:|=|\\{)`, 'm'),
  ];
  const match = patterns.map(pattern => pattern.exec(code)).find(Boolean);
  if (!match) return {lineNumber: 1, column: 1};
  const offset = match.index + match[0].lastIndexOf(match[1]);
  const range = textRange(text, offset, symbol.length);
  return {lineNumber: range.startLineNumber, column: range.startColumn};
}

/** Relative static imports only; loading a source model never evaluates that module. */
export function runtimeImport(text, symbol) {
  if (!identifier.test(symbol)) return null;
  const imports = /^\s*import\s+([\w$\s{},*]+?)\s+from\s*['"]([^'"]+)['"]/gm;
  for (const [, bindings, specifier] of text.matchAll(imports)) {
    if (!/^\.\.?\//.test(specifier)) continue;
    for (const entry of (/\{([^}]+)\}/.exec(bindings)?.[1] ?? '').split(',')) {
      const [imported, local = imported] = entry.trim().split(/\s+as\s+/);
      if (local === symbol) return {specifier, symbol: imported};
    }
    if (/^\s*([\w$]+)/.exec(bindings)?.[1] === symbol) return {specifier, symbol: 'default'};
    const namespace = /\*\s+as\s+([\w$]+)/.exec(bindings)?.[1];
    if (namespace === symbol) return {specifier, symbol: 'default'};
  }
  return null;
}

/** Return the allowlisted app-relative filename for an isolated runtime model. */
export function runtimeSourceFile(value) {
  try {
    const uri = new URL(String(value));
    if (uri.protocol !== 'file:' || uri.host || !uri.pathname.startsWith(runtimePrefix)) return null;
    const file = uri.pathname.slice(runtimePrefix.length);
    return runtimeFiles.has(file) ? file : null;
  } catch { return null; }
}

/** A separate read-only editor: library models never enter FILES or project saves. */
export function createDefinitionViewer(monaco, mainEditor, options = {}) {
  const uri = monaco.Uri.parse(declarationUri);
  const existingDeclaration = monaco.editor.getModel(uri);
  if (existingDeclaration && existingDeclaration.getValue() !== apiTypes) throw new Error('Reserved API definition path is already in use.');
  const declarations = existingDeclaration ?? monaco.editor.createModel(apiTypes, 'typescript', uri);
  const sources = new Map(), pendingSources = new Map(), ownedSources = new Set(), disposables = [];
  let viewer = null, target = null, revision = 0, disposed = false;
  const history = [];

  const dialog = document.createElement('dialog');
  dialog.dataset.monacoDefinition = 'true';
  dialog.setAttribute('aria-label', 'API definitions and implementation');
  Object.assign(dialog.style, {width: 'min(1100px, 94vw)', maxWidth: '94vw', padding: '16px', background: '#111827', color: '#e5e7eb', border: '1px solid #475569', borderRadius: '10px'});
  const header = document.createElement('div');
  Object.assign(header.style, {display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '12px'});
  const title = document.createElement('strong'); title.style.flex = '1';
  const button = label => {const element = document.createElement('button'); element.type = 'button'; element.textContent = label; return element;};
  const back = button('Back'), implementation = button('View implementation'), close = button('Close');
  const message = document.createElement('p'); message.setAttribute('role', 'status'); message.style.margin = '0 0 8px';
  const host = document.createElement('div'); Object.assign(host.style, {height: 'min(65vh, 620px)', width: '100%'});
  header.append(back, title, implementation, close); dialog.append(header, message, host); document.body.append(dialog);

  // Native context menus render outside the top-layer dialog; keep this one inside it.
  const contextMenu = document.createElement('div'); contextMenu.setAttribute('role', 'menu'); contextMenu.hidden = true;
  Object.assign(contextMenu.style, {position: 'absolute', zIndex: '10', padding: '6px', background: '#1e293b', border: '1px solid #475569', borderRadius: '6px'});
  const goDefinition = button('Go to Definition'); goDefinition.setAttribute('role', 'menuitem');
  contextMenu.append(goDefinition); dialog.append(contextMenu);

  function listen(element, event, callback) {
    element.addEventListener(event, callback);
    disposables.push({dispose: () => element.removeEventListener(event, callback)});
  }
  function point(position) {
    return position?.startLineNumber ? {lineNumber: position.startLineNumber, column: position.startColumn} : position ?? {lineNumber: 1, column: 1};
  }
  function updateImplementation() {
    const model = viewer?.getModel();
    target = model === declarations ? definitionSource(model.getValue(), viewer.getPosition()) : null;
    implementation.hidden = !target; implementation.disabled = false;
  }
  function show(model, position, remember = true) {
    if (disposed) return;
    if (remember && viewer && dialog.open && viewer.getModel()) history.push({model: viewer.getModel(), position: viewer.getPosition(), view: viewer.saveViewState()});
    if (!dialog.open) dialog.showModal();
    if (!viewer) {
      viewer = monaco.editor.create(host, {model, readOnly: true, domReadOnly: true, theme: 'vs-dark', automaticLayout: true, minimap: {enabled: false}, fontSize: 13, scrollBeyondLastLine: false, renderValidationDecorations: 'off', occurrencesHighlight: 'off', contextmenu: false, ariaLabel: 'Read-only API definition'});
      disposables.push(viewer.onDidChangeCursorPosition(updateImplementation));
      disposables.push(viewer.onContextMenu(event => {
        event.event.preventDefault();
        if (event.target.position) viewer.setPosition(event.target.position);
        const rect = dialog.getBoundingClientRect(), mouse = event.event.browserEvent;
        contextMenu.style.left = Math.max(0, Math.min(rect.width - 180, mouse.clientX - rect.left)) + 'px';
        contextMenu.style.top = Math.max(0, Math.min(rect.height - 50, mouse.clientY - rect.top)) + 'px';
        contextMenu.hidden = false;
      }));
    } else viewer.setModel(model);
    title.textContent = `${model.uri.path.split('/').at(-1)} (read-only)`;
    message.textContent = ''; contextMenu.hidden = true;
    const selected = point(position); viewer.setPosition(selected); viewer.revealLineInCenter(selected.lineNumber);
    updateImplementation(); back.disabled = history.length === 0; viewer.focus();
  }

  async function loadSource(resource) {
    const file = runtimeSourceFile(resource.toString());
    if (!file || disposed) return null;
    const normalized = monaco.Uri.parse(`file://${runtimePrefix}${file}`), key = normalized.toString();
    if (sources.has(key)) return sources.get(key);
    if (!pendingSources.has(key)) {
      pendingSources.set(key, (async () => {
        const response = await fetch(new URL(file, import.meta.url), {cache: 'no-cache'});
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${file}`);
        const text = await response.text();
        if (disposed) return null;
        let model = monaco.editor.getModel(normalized);
        if (model && model.getValue() !== text) throw new Error(`Reserved source path is already in use: ${file}`);
        if (!model) {model = monaco.editor.createModel(text, 'javascript', normalized); ownedSources.add(model);}
        sources.set(key, model); return model;
      })().finally(() => pendingSources.delete(key)));
    }
    return pendingSources.get(key);
  }

  async function definitions(model, position, token) {
    const runtime = sources.has(model.uri.toString());
    const api = model === declarations;
    const project = model.uri.scheme === 'file' && options.isProjectFile?.(model.uri.path);
    if ((!runtime && !api && !project) || token?.isCancellationRequested || disposed) return null;
    try {
      const word = model.getWordAtPosition(position), imported = runtime && word ? runtimeImport(model.getValue(), word.word) : null;
      let importedModel = null;
      if (imported) {
        const resolved = new URL(imported.specifier, model.uri.toString()); resolved.search = ''; resolved.hash = '';
        importedModel = await loadSource(monaco.Uri.parse(resolved.href));
      }
      if (token?.isCancellationRequested || disposed) return null;
      // Use the same worker/configuration as the Run scripts, including the API extra lib.
      const getWorker = await monaco.languages.typescript.getJavaScriptWorker();
      const worker = await getWorker(declarations.uri, model.uri, ...[importedModel?.uri].filter(Boolean));
      const found = await worker.getDefinitionAtPosition(model.uri.toString(), model.getOffsetAt(position));
      if (token?.isCancellationRequested || disposed) return null;
      const resolved = found?.flatMap(definition => {
        const targetUri = monaco.Uri.parse(definition.fileName), targetModel = monaco.editor.getModel(targetUri);
        if (!targetModel || (runtime && definition.kind === 'alias' && targetUri.toString() === model.uri.toString())) return [];
        const start = targetModel.getPositionAt(definition.textSpan.start), end = targetModel.getPositionAt(definition.textSpan.start + definition.textSpan.length);
        return [{uri: targetUri, range: {startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column}}];
      });
      if (resolved?.length) return resolved;
      if (importedModel) {
        const selected = sourcePosition(importedModel.getValue(), imported.symbol);
        return {uri: importedModel.uri, range: {startLineNumber: selected.lineNumber, startColumn: selected.column, endLineNumber: selected.lineNumber, endColumn: selected.column}};
      }
      return null;
    } catch (error) {
      if (!disposed && !token?.isCancellationRequested && dialog.open) message.textContent = `Could not load definition: ${error.message}`;
      return null;
    }
  }

  // Runtime imports are loaded on demand before asking the worker to resolve aliases.
  disposables.push(monaco.languages.registerDefinitionProvider({language: 'javascript', scheme: 'file', pattern: '**/tetorica-runtime/**', exclusive: true}, {provideDefinition: definitions}));
  disposables.push(monaco.languages.registerDefinitionProvider('javascript', {provideDefinition: definitions}));
  disposables.push(monaco.languages.registerDefinitionProvider('typescript', {provideDefinition: definitions}));
  disposables.push(monaco.editor.registerEditorOpener({
    async openCodeEditor(source, resource, position) {
      if (disposed || (source !== mainEditor && source !== viewer)) return false;
      const model = resource.toString() === declarationUri ? declarations : sources.get(resource.toString());
      if (model) {revision++; show(model, position); return true;}
      if (resource.scheme === 'file' && options.isProjectFile?.(resource.path) && options.openProjectFile) {
        if (await options.openProjectFile(resource.path) === false || disposed) return false;
        if (position?.startLineNumber) mainEditor.setSelection(position); else if (position) mainEditor.setPosition(position);
        mainEditor.revealLineInCenter(point(position).lineNumber);
        if (dialog.open) dialog.close();
        mainEditor.focus(); return true;
      }
      return false;
    },
  }));
  listen(implementation, 'click', async () => {
    const selected = target, request = ++revision;
    if (!selected) return;
    implementation.disabled = true; message.textContent = 'Loading implementation…';
    try {
      const model = await loadSource(monaco.Uri.parse(`file://${runtimePrefix}${selected.file}`));
      if (model && !disposed && request === revision) show(model, sourcePosition(model.getValue(), selected.symbol));
    } catch (error) {
      if (!disposed && request === revision) {message.textContent = `Could not load implementation: ${error.message}`; implementation.disabled = false;}
    }
  });
  listen(back, 'click', () => {
    revision++;
    const previous = history.pop();
    if (!previous || previous.model.isDisposed()) return;
    show(previous.model, previous.position, false); viewer.restoreViewState(previous.view); updateImplementation();
  });
  listen(close, 'click', () => dialog.close());
  listen(dialog, 'close', () => {revision++; history.length = 0; contextMenu.hidden = true; mainEditor.focus();});
  listen(goDefinition, 'mousedown', event => event.preventDefault());
  listen(goDefinition, 'click', () => {contextMenu.hidden = true; viewer?.focus(); viewer?.trigger('definition-context-menu', 'editor.action.revealDefinition', {});});
  listen(dialog, 'mousedown', event => {if (!contextMenu.contains(event.target)) contextMenu.hidden = true;});
  listen(dialog, 'cancel', event => {if (!contextMenu.hidden) {event.preventDefault(); contextMenu.hidden = true; viewer?.focus();}});

  return {
    openSymbol(symbol) {
      const location = declarationTarget(symbol);
      if (!location || disposed) return false;
      revision++; show(declarations, location); return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true; revision++;
      for (const disposable of disposables) disposable.dispose();
      viewer?.dispose();
      for (const model of ownedSources) model.dispose();
      if (!existingDeclaration) declarations.dispose();
      dialog.remove();
    },
  };
}
