import {parsePipeline} from './shared/virtual-files/pipeline.js';
import {resolvePath} from './shared/virtual-files/path.js';

/** Complete only the final path argument; command text is never evaluated.
 * The caller supplies a read-only view of the current virtual FILES tree.
 * Unfinished quotes and escaped spaces are accepted, like FM2612 Playground.
 */
export function completeShellPath(fs, cwd, source) {
  let start = 0, word = '', quote = '', escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (escaped) { word += char; escaped = false; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; else word += char; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (/\s/.test(char) || '|<>'.includes(char)) { start = index + 1; word = ''; continue; }
    word += char;
  }
  const unchanged = {source, matches: []};
  try {
    const commandPrefix = source.slice(0, start);
    const args = /(?:>>|[<>])\s*$/.test(commandPrefix) ? ['redirect'] : parsePipeline(commandPrefix).at(-1)?.args ?? [];
    if (!args.length || escaped) return unchanged;
    const slash = word.lastIndexOf('/'), prefix = word.slice(0, slash + 1), name = word.slice(slash + 1);
    const directory = resolvePath(prefix || '.', cwd);
    const matches = fs.readdir(directory).filter(item => item.startsWith(name)).map(item => {
      const path = prefix + item;
      return path + (fs.stat(resolvePath(path, cwd)).type === 'directory' ? '/' : '');
    }).sort();
    if (!matches.length) return unchanged;
    let common = matches[0];
    for (const match of matches) while (!match.startsWith(common)) common = common.slice(0, -1);
    // Do not introduce an incomplete Unicode character for a shared prefix.
    if (/[\uD800-\uDBFF]$/.test(common)) common = common.slice(0, -1);
    if (common.length <= word.length && matches.length > 1) return {source, matches};
    const encoded = /[\s"'\\|;&<>]/.test(common) ? '"' + common.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : common;
    return {source: source.slice(0, start) + encoded + (matches.length === 1 && !common.endsWith('/') ? ' ' : ''), matches};
  } catch { return unchanged; }
}

/** Tab completion and readline-style movement/editing, scoped to the Shell input.
 * getFs is called synchronously only when a valid completion is requested, so
 * the caller can flush editor changes before constructing the current view.
 * History, Ctrl+C/L, Cmd shortcuts and IME input remain the caller's concern.
 */
export function installShellInput({input, getFs, getCwd, onMatches = () => {}, scroll = () => {}}) {
  let disposed = false;
  const consume = event => { event.preventDefault(); event.stopPropagation(); };
  const selection = position => input.setSelectionRange(position, position);
  function replace(start, end, text) {
    if (start === end && !text) return;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    selection(start + text.length);
    const InputEvent = input.ownerDocument?.defaultView?.Event ?? Event;
    input.dispatchEvent(new InputEvent('input', {bubbles: true}));
  }
  const previous = (text, offset) => offset > 1 && /[\uDC00-\uDFFF]/.test(text[offset - 1]) && /[\uD800-\uDBFF]/.test(text[offset - 2]) ? offset - 2 : Math.max(0, offset - 1);
  const next = (text, offset) => offset + (text.codePointAt(offset) > 0xffff ? 2 : 1);
  function keydown(event) {
    if (disposed || event.defaultPrevented || event.isComposing || event.keyCode === 229 || input.readOnly || input.disabled) return;
    const start = input.selectionStart, end = input.selectionEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return;
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      consume(event);
      // Keep ordinary Tab within the terminal, but never replace a selection or
      // text after the caret. Shift+Tab still leaves the input normally.
      if (start !== end || end !== input.value.length) return;
      let completed;
      try { completed = completeShellPath(getFs(), getCwd(), input.value); } catch { return; }
      if (completed.source !== input.value) replace(0, input.value.length, completed.source);
      if (completed.matches.length > 1) onMatches(completed.matches, completed.source);
      scroll();
      return;
    }
    if (!event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase(), text = input.value;
    if (!['a', 'e', 'b', 'f', 'u', 'k', 'w'].includes(key)) return;
    consume(event);
    if (key === 'a') selection(0);
    else if (key === 'e') selection(text.length);
    else if (key === 'b') selection(start !== end ? start : previous(text, start));
    else if (key === 'f') selection(start !== end ? end : Math.min(text.length, next(text, end)));
    else if (key === 'u') replace(0, end, '');
    else if (key === 'k') replace(start, text.length, '');
    else if (start !== end) replace(start, end, '');
    else {
      let boundary = start;
      while (boundary && /\s/.test(text[boundary - 1])) boundary--;
      while (boundary && !/\s/.test(text[boundary - 1])) boundary--;
      replace(boundary, start, '');
    }
    scroll();
  }
  input.addEventListener('keydown', keydown, true);
  return {dispose() { disposed = true; input.removeEventListener('keydown', keydown, true); }};
}
