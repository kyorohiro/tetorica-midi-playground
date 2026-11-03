import {createVirtualGit} from './vendor/virtual-git/git.bundle.js';

const actions = new Set(['init', 'status', 'diff', 'stage', 'commit', 'log', 'branch', 'config', 'remote', 'fetch', 'pull', 'push', 'clone']);

/** Git over virtual FILES; optional transport owns native HTTPS and credentials. */
export function createProjectGit({getStore, beforeCommand = () => {}, onChanged = () => {}, beginRemote, http, validateReplacement = () => {}}) {
  let active = null, generation = 0, disposed = false;
  const assertProject = (store, epoch) => {
    if (disposed || epoch !== generation || getStore() !== store) throw Error('Project changed during Git operation; retry with the current project');
  };
  return {
    get busy() { return active !== null; },
    invalidate() { generation++; active?.abort(); },
    dispose() { disposed = true; generation++; active?.abort(); },
    async execute(action, args = {}, guards = {}) {
      if (!actions.has(action)) throw Error('Unsupported Git operation; checkout and merge are not available');
      if (disposed) throw Error('Git panel is closed');
      if (active) throw Error('A Git operation is already running');
      const controller = new AbortController(), epoch = generation, store = getStore();
      const onAbort = () => controller.abort(guards.signal.reason);
      guards.signal?.addEventListener('abort', onAbort, {once: true});
      if (guards.signal?.aborted) onAbort();
      active = controller;
      try {
        controller.signal.throwIfAborted();
        await beforeCommand(action, args);
        assertProject(store, epoch);
        if (action === 'pull' && args.branch) {
          const data = store.fs.get('/.git/HEAD')?.data;
          const head = typeof data === 'string' ? data : data && new TextDecoder().decode(data);
          if (head?.trim() !== `ref: refs/heads/${args.branch}`) throw Error('Pull targets the current branch. Switching branches is not available.');
        }
        const revision = store.revision;
        const assertActive = () => {
          guards.assertActive?.();
          assertProject(store, epoch);
          if (store.revision !== revision) throw Error('Files changed during Git operation; retry with the current project');
        };
        // Validate the complete draft before publishing Git objects and refs.
        // This retains cassette limits without rolling back newer editor work.
        const fs = {...store.fs, replace(entries, directories, options) {
          if (action === 'pull' || action === 'clone') {
            const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
            entries = entries.map(entry => {
              if (typeof entry.data === 'string' || entry.path.startsWith('/.git/') || /\.(?:tfi|vgi)$/i.test(entry.path)) return entry;
              try { return {...entry, data: decoder.decode(entry.data)}; } catch { return entry; }
            });
          }
          store.validateReplacement(entries, directories);
          validateReplacement(entries, directories, action);
          store.fs.replace(entries, directories, options);
        }};
        const transport = beginRemote && (async request => {
          const session = await beginRemote(request);
          try { controller.signal.throwIfAborted(); assertActive(); }
          catch (error) { await session.close(); throw error; }
          return {...session, http: {request(options) {
            controller.signal.throwIfAborted(); assertActive();
            return session.http.request({...options, signal: controller.signal});
          }}};
        });
        const repository = createVirtualGit({fs, beginRemote: transport, http});
        const result = await repository.execute(action, args, {signal: controller.signal, assertActive});
        // The successful publication itself advances the store's revision.
        assertProject(store, epoch);
        onChanged(store.snapshot(), {action, result});
        return result;
      } finally {
        guards.signal?.removeEventListener('abort', onAbort);
        if (active === controller) active = null;
      }
    },
  };
}

/** Git commands stay in the Shell; this dialog only manages app-wide tokens. */
export function mountProjectGit({button, getStore, beforeCommand, onChanged, beginRemote, tokens, http, validateReplacement, onError = () => {}}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'project-git-dialog';
  dialog.setAttribute('aria-label', 'Git settings');
  dialog.innerHTML = `<h2>Git settings</h2>
    <p>Run Git commands in the Shell using <code>git</code>.</p>
    <section data-git-tokens hidden>
      <p>Saved tokens are shared across the app. Choose a token when pushing or connecting to a remote.</p>
      <label>Token name <input data-token-name autocomplete="off" placeholder="e.g. GitHub"></label>
      <label>HTTPS host <input data-token-host autocomplete="off" value="https://github.com"></label>
      <button type="button" data-token-action="add">Add token…</button>
      <p>Add token opens a native dialog. Paste your personal access token (PAT) there.</p>
      <hr>
      <label>Saved tokens <select data-token-list></select></label>
      <button type="button" data-token-action="delete">Delete selected token…</button>
      <p data-token-binding role="status"></p>
      <small data-token-storage></small>
    </section>
    <p data-git-network-help></p>
    <pre data-git-output role="status"></pre>
    <button type="button" data-git-close>Close</button>`;
  document.body.append(dialog);
  const find = selector => dialog.querySelector(selector);
  const output = find('[data-git-output]');
  const tokenSection = find('[data-git-tokens]'), tokenList = find('[data-token-list]');
  const tokenName = find('[data-token-name]'), tokenHost = find('[data-token-host]');
  let busy = false, disposed = false, viewGeneration = 0, tokenSupported = false;
  const repository = createProjectGit({getStore, beforeCommand, onChanged, beginRemote, http, validateReplacement});
  tokenSection.hidden = !tokens;
  find('[data-git-network-help]').textContent = tokens ? '' : 'The browser version supports local Git operations. Use the Tauri app to connect to remotes.';
  function controls() {
    for (const field of [tokenName, tokenHost, tokenList]) field.disabled = busy || !tokenSupported;
    dialog.querySelectorAll('[data-token-action]').forEach(control => control.disabled = busy || !tokenSupported);
  }
  async function refreshTokens(epoch, preferred) {
    if (!tokens) return;
    const result = await tokens.list();
    if (epoch !== viewGeneration || disposed) return;
    tokenSupported = result.supported;
    tokenList.replaceChildren();
    const none = document.createElement('option'); none.value = ''; none.textContent = 'Select a token'; tokenList.append(none);
    for (const entry of result.tokens) {
      const option = document.createElement('option'); option.value = entry.id; option.textContent = `${entry.name} (${entry.host})`; tokenList.append(option);
    }
    tokenList.value = preferred ?? result.selectedId ?? '';
    find('[data-token-binding]').textContent = result.supported ? 'Choose a token when pushing or connecting to a remote. Your previous selection is used by default.' : 'Saved tokens are not supported on this OS.';
    find('[data-token-storage]').textContent = result.supported ? `Token contents are stored in ${result.storage ?? 'the OS credential store'} and are not included in Cassettes.` : '';
    controls();
  }
  const onTokenAction = async event => {
    const action = event.target.closest('[data-token-action]')?.dataset.tokenAction;
    if (!tokens || !action || busy || disposed || !tokenSupported) return;
    busy = true; controls(); const epoch = viewGeneration;
    try {
      let preferred;
      if (action === 'add') {
        const result = await tokens.add({name: tokenName.value.trim(), host: tokenHost.value.trim()});
        preferred = result.entry.id;
        if (epoch === viewGeneration && !disposed) { tokenName.value = ''; output.textContent = 'Token added.'; }
      } else if (action === 'delete') {
        if (!tokenList.value) throw Error('Select a saved token.');
        await tokens.remove(tokenList.value);
        if (epoch === viewGeneration && !disposed) output.textContent = 'Saved token deleted. The token itself is not revoked on GitHub.';
      } else return;
      if (epoch === viewGeneration && !disposed) await refreshTokens(epoch, preferred);
    } catch (error) {
      if (epoch === viewGeneration && !disposed) { output.textContent = error.message; onError(error); }
    } finally { busy = false; if (!disposed) controls(); }
  };
  tokenSection.addEventListener('click', onTokenAction);
  async function open() {
    if (disposed) return;
    if (!dialog.open) dialog.showModal();
    if (busy || !tokens) return;
    busy = true; controls(); const epoch = viewGeneration;
    try { await refreshTokens(epoch); }
    catch (error) { if (epoch === viewGeneration && !disposed) { output.textContent = error.message; onError(error); } }
    finally { busy = false; if (!disposed) controls(); }
  }
  const onOpen = () => void open();
  const onClose = () => dialog.close();
  button?.addEventListener('click', onOpen);
  find('[data-git-close]').addEventListener('click', onClose);
  controls();
  return {
    open,
    close: onClose,
    invalidate() { viewGeneration++; repository.invalidate(); output.textContent = ''; controls(); },
    dispose() {
      disposed = true; viewGeneration++; repository.dispose();
      button?.removeEventListener('click', onOpen);
      tokenSection.removeEventListener('click', onTokenAction);
      find('[data-git-close]').removeEventListener('click', onClose);
      dialog.remove();
    },
    execute: repository.execute,
  };
}
