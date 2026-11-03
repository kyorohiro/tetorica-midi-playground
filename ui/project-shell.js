import {createShell, parseRmArgs} from './shared/virtual-files/shell.js';
import {installShellInput} from './shell-input.js';
import {parsePipeline} from './shared/virtual-files/pipeline.js';
import {createVirtualFileSystem} from './shared/virtual-files/filesystem.js';
import {registerGitShell} from './vendor/virtual-git/git.bundle.js';
import {createProjectFiles, isInternalProjectPath, normalizeProjectPath} from './project-files.js';
import {binaryFile, isBinaryFile} from './project-assets.js';
import {withGuide, isGuide, guides} from './guide.js';

const readCommands = new Set(['pwd', 'ls', 'cd', 'cat', 'echo', 'find', 'rg', 'read', 'help']);
const unavailable = new Set(['snapshot', 'undo', 'diff']);
const usages = {
  pwd: 'pwd', ls: 'ls [PATH]', cd: 'cd [PATH]', cat: 'cat PATH|-', echo: 'echo [TEXT...]',
  mkdir: 'mkdir [-p] PATH', touch: 'touch PATH', write: 'write PATH TEXT', rm: 'rm [-r|-R|--recursive] [-f|--force] [--] PATH',
  cp: 'cp SOURCE DESTINATION', mv: 'mv SOURCE DESTINATION',
  find: 'find [PATH] [-name GLOB] [-type f|d] [--json] [--offset N] [--limit N]',
  rg: 'rg [-n] [-F] [-i] [-l] [--json] [--offset N] [--limit N] LITERAL [PATH]',
  read: 'read [--start N] [--end N] [--max-chars N] [--json] PATH',
  edit: 'edit [--revision N] [--expect N] [--dry-run] [--json] PATH OLD_TEXT NEW_TEXT',
  patch: 'patch [--json] [--dry-run] PATCH_FILE|-', pipeline: 'pipeline --json SOURCE',
  git: 'git help', help: 'help [COMMAND|--json]',
};
const inside = (path, parent) => path === parent || path.startsWith(parent + '/');
const protectedPath = path => isInternalProjectPath(path) || isGuide(path) || inside(path.toLowerCase(), '/sys') || path.toLowerCase() === '/metadata.json';
const fail = error => ({code: error?.name === 'AbortError' ? 130 : 1, stdout: '', stderr: String(error?.message ?? error)});
const sameData = (a, b) => typeof a === 'string' ? a === b : isBinaryFile(b) && a.bytes.length === b.bytes.length && a.bytes.every((byte, i) => byte === b.bytes[i]);
function changed(before, after) {
  const paths = Object.keys(before.files);
  return paths.length !== Object.keys(after.files).length || paths.some(path => !sameData(before.files[path], after.files[path])) ||
    before.directories.length !== after.directories.length || before.directories.some((path, i) => path !== after.directories[i]) ||
    JSON.stringify(before.removedGuides ?? []) !== JSON.stringify(after.removedGuides ?? []);
}

/** Virtual FILES commands only: never evaluates JavaScript or invokes an OS shell.
 * Each ordinary command/pipeline validates a private draft before one publication.
 * Git uses the same controller as the Git panel and has its own transactions. */
export function createProjectShell({getStore, beforeCommand = () => {}, beforeMutation = () => {}, onChanged = () => {}, git = () => null}) {
  let cwd = '/', active = null, generation = 0, disposed = false;
  const assertProject = (store, epoch, signal) => {
    signal?.throwIfAborted();
    if (disposed || generation !== epoch || getStore() !== store) throw Error('Project changed during Shell command; retry with the current project');
  };
  const api = {
    get cwd() { return cwd; },
    get busy() { return active !== null; },
    stop() { active?.abort(new DOMException('Shell command cancelled', 'AbortError')); },
    invalidate() { generation++; cwd = '/'; api.stop(); },
    dispose() { disposed = true; api.invalidate(); },
    async execute(source) {
      if (disposed) return fail(Error('Shell is closed'));
      if (active) return fail(Error('A Shell command is already running'));
      if (typeof source !== 'string' || source.length > 1000000) return fail(Error('Shell command must be text up to 1,000,000 characters'));
      let plan;
      try { plan = parsePipeline(source); } catch (error) { return fail(error); }
      if (!plan.length) return {code: 0, stdout: '', stderr: ''};
      const gitCommand = plan.some(stage => stage.args[0] === 'git');
      if (gitCommand && (plan.length !== 1 || plan[0].input || plan[0].output)) return fail(Error('Run Git commands separately from pipelines and redirection'));
      const controller = new AbortController(), epoch = generation, store = getStore();
      active = controller;
      let shell;
      try {
        await beforeCommand();
        assertProject(store, epoch, controller.signal);
        const mutating = !gitCommand && plan.some(stage => stage.output || !readCommands.has(stage.args[0]));
        if (mutating) {
          await beforeMutation();
          assertProject(store, epoch, controller.signal);
        }
        const revision = store.revision, before = store.snapshot();
        const assertActive = () => {
          assertProject(store, epoch, controller.signal);
          if (!gitCommand && store.revision !== revision) throw Error('Files changed during Shell command; retry with the current project');
        };
        const hiddenFiles = Object.fromEntries(Object.entries(before.files).filter(([path]) => isInternalProjectPath(path)));
        const hiddenDirectories = before.directories.filter(isInternalProjectPath);
        const visible = withGuide(Object.fromEntries(Object.entries(before.files).filter(([path]) => !isInternalProjectPath(path))), before.removedGuides);
        const draft = createVirtualFileSystem(Object.entries(visible).map(([path, value]) => ({path, data: typeof value === 'string' ? value : Uint8Array.from(value.bytes)})), {autoCheckpoint: false});
        draft.replace(draft.list(), [...draft.listDirectories(), ...before.directories.filter(path => !isInternalProjectPath(path))]);
        const guideOnlyDirectories = new Set(draft.listDirectories().filter(path => !before.directories.includes(path) && path !== '/'));
        const transfers = [], removed = [];
        let clearedRoot = false;
        const authorize = (operation, paths) => {
          assertActive();
          for (const input of paths) {
            const path = normalizeProjectPath(input);
            if (path === '/' || protectedPath(path) || Object.keys(visible).some(candidate => isGuide(candidate) && inside(candidate, path)) ||
              [...Object.keys(hiddenFiles), ...hiddenDirectories].some(candidate => inside(candidate, path))) throw Error('This project path is protected: ' + path);
          }
          if (operation === 'mv') transfers.push({from: paths[0], to: paths[1]});
          if (operation === 'rm') removed.push(paths[0]);
        };
        let start = cwd;
        try { if (draft.stat(start).type !== 'directory') start = '/'; } catch { start = '/'; }
        shell = createShell({fs: draft, cwd: start, authorize});
        shell.register('rm', context => {
          const {path:input,recursive,force} = parseRmArgs(context.args), path = context.resolve(input);
          context.assertActive();assertActive();
          if (path === '/') {
            if (!recursive || !force) throw Error('This project root is protected without recursive force. Use rm -rf . to clear it.');
            // Clear the virtual project, including guides and hidden Git.
            context.fs.replace([],[]);
            clearedRoot = true;removed.push('/');return;
          }
          if (isGuide(path)) removed.push(path);
          else authorize('rm',[path]);
          if (force && !context.fs.has(path) && !context.fs.listDirectories().includes(path)) return;
          context.fs.remove(path,{recursive});
        });
        for (const name of unavailable) shell.register(name, () => { throw Error('Shell snapshots and undo are not available. Use git diff and git log for saved history.'); });
        shell.register('help', ({args}) => {
          if (args.length > 1) throw Error('Usage: help [COMMAND|--json]');
          if (args[0] === '--json') return JSON.stringify(Object.entries(usages).map(([name, usage]) => ({name, usage}))) + '\n';
          if (args.length) { if (!Object.hasOwn(usages, args[0])) throw Error('Unknown or unavailable command: ' + args[0]); return usages[args[0]] + '\n'; }
          return 'Virtual FILES Shell — paths stay inside this project.\n' + Object.keys(usages).join(' ') + '\nPipelines: cat notes.txt | rg C4 -\nRedirect: echo hello > notes.txt\nNo host commands, command chaining, expansion, or JavaScript evaluation.\n';
        });
        if (gitCommand) {
          const repository = git();
          if (!repository?.execute) throw Error('Git controller is unavailable');
          registerGitShell(shell, {async execute(action, args, guards) {
            const result = await repository.execute(action, args, {
              ...guards, signal: controller.signal, assertActive: () => { assertActive(); guards?.assertActive?.(); },
            });
            if (action === 'clone' && result.completed) cwd = '/';
            return result;
          }});
        } else shell.register('git', () => { throw Error('Run Git commands directly, separately from nested commands or pipelines'); });
        const result = await shell.execute(source, {signal: controller.signal});
        assertActive();
        if (result.code !== 0) return result;
        if (!gitCommand) {
          const snapshot = {
            files: {...(clearedRoot ? {} : hiddenFiles), ...Object.fromEntries(draft.list().filter(file => !isGuide(file.path)).map(file => [file.path, typeof file.data === 'string' ? file.data : binaryFile(file.data)]))},
            directories: [...(clearedRoot ? [] : hiddenDirectories), ...draft.listDirectories().filter(path => path !== '/' && !isGuide(path) && !inside(path.toLowerCase(), '/sys') && !guideOnlyDirectories.has(path))],
            removedGuides: Object.keys(guides).filter(path => !draft.has(path)),
          };
          // The validator also catches a non-portable or protected path introduced
          // indirectly by a nested patch/redirect before it can reach the live fs.
          for (const path of Object.keys(snapshot.files)) if (!Object.hasOwn(before.files, path) && protectedPath(path)) throw Error('This project path is protected: ' + path);
          // Use the same limits/path rules as FILES and cassette imports.
          const validated = createProjectFiles(snapshot).snapshot();
          assertActive();
          if (clearedRoot || changed(before, validated)) {
            store.sync(validated.files, validated.directories, validated.removedGuides ?? []);
            onChanged(store.snapshot(), {transfers, removed, ...(clearedRoot ? {clearedRoot:true} : {})});
          }
          cwd = shell.cwd;
          const remaining = withGuide(validated.files, validated.removedGuides);
          if (cwd !== '/' && !validated.directories.includes(cwd) && !Object.keys(remaining).some(path => path.startsWith(cwd + '/'))) cwd = '/';
        }
        return result;
      } catch (error) {
        return controller.signal.aborted ? {code: 130, stdout: '', stderr: 'Shell command cancelled; no pending FILES changes applied.'} : fail(error);
      } finally {
        shell?.dispose();
        if (active === controller) active = null;
      }
    },
  };
  return api;
}

/** Mounts a compact Shell panel. The caller owns its tab/panel visibility. */
export function mountProjectShell({root, stopButton, onError = () => {}, ...options}) {
  root.innerHTML = `<div class="project-shell-terminal" data-shell-terminal aria-label="Project terminal"><pre data-shell-output tabindex="0" aria-label="Shell output"></pre><form data-shell-form><label for="projectShellInput" data-shell-prompt>/ $</label><input id="projectShellInput" data-shell-input autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Shell command" placeholder="help"></form></div>`;
  const find = selector => root.querySelector(selector);
  const output = find('[data-shell-output]'), input = find('[data-shell-input]'), form = find('[data-shell-form]'), terminal = find('[data-shell-terminal]'), prompt = find('[data-shell-prompt]');
  const controller = createProjectShell(options), history = [];
  let historyIndex = 0, draftInput = '', disposed = false, viewGeneration = 0;
  output.textContent = 'Virtual FILES Shell. Type help for commands.\n';
  const scroll = () => {terminal.scrollTop = terminal.scrollHeight;};
  function append(text) { output.textContent = (output.textContent + text).slice(-200000); scroll(); }
  function controls(busy) {
    input.readOnly = busy;
    if (stopButton) {stopButton.disabled = !busy;stopButton.hidden = !busy;}
    prompt.textContent = controller.cwd + ' $';
  }
  function clearOutput() {output.textContent = '';scroll();input.focus();}
  const lineInput = installShellInput({input,getCwd:() => controller.cwd,scroll,
    getFs() {
      options.beforeCommand?.();
      const snapshot=options.getStore().snapshot();
      const visible=withGuide(Object.fromEntries(Object.entries(snapshot.files).filter(([path])=>!isInternalProjectPath(path))),snapshot.removedGuides);
      const fs=createVirtualFileSystem(Object.entries(visible).map(([path,value])=>({path,data:typeof value==='string'?value:Uint8Array.from(value.bytes)})),{autoCheckpoint:false});
      fs.replace(fs.list(),[...fs.listDirectories(),...snapshot.directories.filter(path=>!isInternalProjectPath(path))]);
      return fs;
    },onMatches:(matches,source) => append(`${controller.cwd} $ ${source}\n${matches.join('  ')}\n`),
  });
  async function execute(source = input.value) {
    if (disposed || controller.busy || !source.trim()) return;
    const epoch = viewGeneration;
    if (history.at(-1) !== source) history.push(source);
    if (history.length > 100) history.shift();
    historyIndex = history.length; draftInput = ''; input.value = '';
    append(`${controller.cwd} $ ${source}\n`); controls(true);
    const result = await controller.execute(source);
    if (!disposed && epoch === viewGeneration) {
      if (result.stdout) append(result.stdout + (result.stdout.endsWith('\n') ? '' : '\n'));
      if (result.stderr) append(result.stderr + (result.stderr.endsWith('\n') ? '' : '\n'));
      if (result.code !== 0) { append(`[exit ${result.code}]\n`); onError(Error(result.stderr || `Shell command exited ${result.code}`)); }
    }
    if (!disposed) { controls(false); if (epoch === viewGeneration) input.focus(); }
    return result;
  }
  form.onsubmit = event => { event.preventDefault(); void execute(); };
  input.onkeydown = event => {
    if (event.isComposing || input.readOnly) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    if (historyIndex === history.length) draftInput = input.value;
    historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
    input.value = historyIndex === history.length ? draftInput : history[historyIndex];
    input.setSelectionRange(input.value.length, input.value.length);
  };
  const stop = () => controller.stop();
  const shortcut = event => {
    if (event.isComposing || !event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === 'l') {event.preventDefault();clearOutput();}
    else if (event.key.toLowerCase() === 'c') {
      if (globalThis.getSelection?.()?.toString() || (event.target === input && input.selectionStart !== input.selectionEnd)) return;
      event.preventDefault();append(`${controller.cwd} $ ${input.value}^C\n`);input.value = '';draftInput = '';historyIndex = history.length;
      stop();input.focus();scroll();
    }
  };
  const focusTerminal = event => {if (event.target === terminal && !globalThis.getSelection?.()?.toString()) input.focus();};
  root.addEventListener('keydown',shortcut);
  terminal.addEventListener('click',focusTerminal);
  stopButton?.addEventListener('click',stop);
  controls(false);
  return {
    execute, clearOutput, focus() { input.focus();scroll(); },
    invalidate() { viewGeneration++; controller.invalidate(); history.length = 0; historyIndex = 0; draftInput = ''; input.value = ''; output.textContent = 'Project changed. Shell working directory reset to /.\n'; prompt.textContent = '/ $';scroll(); },
    dispose() { disposed = true; viewGeneration++; controller.dispose();lineInput.dispose(); root.removeEventListener('keydown',shortcut);terminal.removeEventListener('click',focusTerminal);stopButton?.removeEventListener('click',stop);root.replaceChildren(); },
  };
}
