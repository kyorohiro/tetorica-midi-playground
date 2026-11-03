import {createVirtualGit, formatGitStatus} from './vendor/virtual-git/git.bundle.js';

const actions = new Set(['init', 'status', 'diff', 'stage', 'commit', 'log', 'branch', 'config', 'remote', 'fetch', 'pull', 'push']);

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
      if (!actions.has(action)) throw Error('Unsupported Git operation; checkout, merge and clone are not available');
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
          if (action === 'pull') {
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
        onChanged(store.snapshot());
        return result;
      } finally {
        guards.signal?.removeEventListener('abort', onAbort);
        if (active === controller) active = null;
      }
    },
  };
}

/** Git UI shares the Shell controller. Credentials are app-wide native metadata. */
export function mountProjectGit({button, getStore, beforeCommand, onChanged, beginRemote, tokens, http, validateReplacement, onError = () => {}, onStatus = () => {}}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'project-git-dialog';
  dialog.setAttribute('aria-label', 'Project Git');
  dialog.style.cssText = 'width:min(840px,92vw);max-height:86vh;overflow:auto;padding:22px;background:#f5fafb;color:#193a43;border:2px solid #54747d;border-radius:8px;';
  dialog.innerHTML = `<form method="dialog" style="display:flex;align-items:center;gap:12px"><h2 style="margin:0;flex:1">Project Git</h2><button value="close" aria-label="Close Git">Close</button></form>
    <p>Git history for FILES is included in project saves and cassettes. HTTPS remotes, including GitHub, use native approval and the OS credential store.</p>
    <p data-git-status role="status" aria-live="polite"></p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">
      <button type="button" data-git-action="init">Initialize repository</button>
      <button type="button" data-git-action="status">Refresh status</button>
      <button type="button" data-git-action="stage">Stage all changes</button>
      <button type="button" data-git-action="diff">Unstaged diff</button>
      <button type="button" data-git-action="staged">Staged diff</button>
      <button type="button" data-git-action="log">History</button>
      <button type="button" data-git-action="branches">Branches</button>
    </div>
    <div data-git-files style="display:grid;gap:6px"></div>
    <fieldset style="margin:14px 0"><legend>Commit staged changes</legend>
      <label>Author name <input data-git-name autocomplete="name" style="width:190px"></label>
      <label>Email <input data-git-email type="email" autocomplete="email" style="width:230px"></label>
      <label style="display:block;margin-top:8px">Message <input data-git-message style="width:min(580px,90%)" placeholder="Describe the change"></label>
      <button type="button" data-git-action="commit" style="margin-top:8px">Commit staged</button>
    </fieldset>
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px"><label>New branch <input data-git-branch placeholder="experiment"></label><button type="button" data-git-action="branch">Create branch</button><small>Creates a branch at the current commit. Switching branches is not available.</small></div>
    <fieldset style="margin:14px 0"><legend>HTTPS remote</legend>
      <label>Remote <input data-git-remote value="origin" style="width:120px" autocomplete="off"></label>
      <label>Branch <input data-git-remote-branch value="main" style="width:150px" autocomplete="off"></label>
      <label style="display:block;margin:8px 0">Repository URL <input data-git-url type="url" placeholder="https://github.com/owner/repository.git" style="width:min(580px,95%)" autocomplete="off"></label>
      <button type="button" data-git-action="save-remote">Save remote URL</button>
      <button type="button" data-git-action="fetch">Fetch</button>
      <button type="button" data-git-action="pull">Pull (fast-forward)</button>
      <button type="button" data-git-action="push">Push…</button>
      <p data-git-network-help>Fetch updates remote history. Pull targets the current branch and requires a clean working tree and compatible history. Push asks for approval of the repository, branch and commit in a native dialog. Checkout, merge and clone are not available.</p>
    </fieldset>
    <fieldset data-git-tokens hidden style="margin:14px 0"><legend>Saved personal access tokens</legend>
      <label>Name <input data-token-name autocomplete="off" placeholder="GitHub"></label>
      <label>HTTPS host <input data-token-host autocomplete="off" value="https://github.com"></label>
      <button type="button" data-token-action="add">Add token…</button>
      <p>The PAT is entered in a native dialog. Only its name and host appear here.</p>
      <label>Saved token <select data-token-list></select></label>
      <button type="button" data-token-action="select">Use selected token…</button>
      <button type="button" data-token-action="delete">Delete selected token…</button>
      <p data-token-storage></p>
    </fieldset>
    <pre data-git-output tabindex="0" style="white-space:pre-wrap;overflow-wrap:anywhere;background:#17252d;color:#d5eaf0;min-height:110px;max-height:36vh;overflow:auto;padding:12px"></pre>`;
  document.body.append(dialog);
  const find = selector => dialog.querySelector(selector);
  const status = find('[data-git-status]'), output = find('[data-git-output]'), files = find('[data-git-files]');
  const authorName = find('[data-git-name]'), authorEmail = find('[data-git-email]'), message = find('[data-git-message]'), branch = find('[data-git-branch]');
  const remote = find('[data-git-remote]'), remoteBranch = find('[data-git-remote-branch]'), remoteUrl = find('[data-git-url]');
  const tokenSection = find('[data-git-tokens]'), tokenList = find('[data-token-list]'), tokenName = find('[data-token-name]'), tokenHost = find('[data-token-host]');
  let currentStatus = null, busy = false, disposed = false, viewGeneration = 0, tokenSupported = false;
  const repository = createProjectGit({getStore, beforeCommand, onChanged, beginRemote, http, validateReplacement});
  if (!beginRemote && !http) find('[data-git-network-help]').textContent = 'Remote transfers require the native app. Local history and remote URL configuration remain available.';
  tokenSection.hidden = !tokens;
  function controls() {
    const initialized = currentStatus?.initialized === true;
    dialog.querySelectorAll('[data-git-action]').forEach(control => {
      control.disabled = busy || (control.dataset.gitAction === 'init' ? initialized : control.dataset.gitAction !== 'status' && !initialized);
      if (['fetch', 'pull', 'push'].includes(control.dataset.gitAction) && !beginRemote && !http) control.disabled = true;
    });
    dialog.querySelectorAll('[data-git-path]').forEach(control => control.disabled = busy);
    for (const field of [authorName, authorEmail, message, branch, remote, remoteBranch, remoteUrl, tokenName, tokenHost, tokenList]) field.disabled = busy;
    dialog.querySelectorAll('[data-token-action]').forEach(control => control.disabled = busy || !tokenSupported);
    if (button) button.disabled = busy;
  }
  function showStatus(value) {
    currentStatus = value;
    status.textContent = formatGitStatus(value).trim();
    status.style.whiteSpace = 'pre-wrap';
    files.replaceChildren();
    for (const entry of value.files ?? []) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px';
      const label = document.createElement('code');
      label.textContent = `${entry.path} — ${entry.untracked ? 'untracked' : [entry.staged && 'staged', entry.worktree && 'unstaged'].filter(Boolean).join(', ')}`;
      label.style.cssText = 'flex:1;overflow-wrap:anywhere';
      row.append(label);
      for (const [title, action, args] of [['Stage', 'stage', {paths: ['/' + entry.path]}], ['Diff', 'diff', {paths: ['/' + entry.path], staged: !entry.worktree && entry.staged}]]) {
        const control = document.createElement('button');
        control.type = 'button'; control.textContent = title; control.dataset.gitPath = entry.path;
        control.onclick = () => void command(action, args);
        row.append(control);
      }
      files.append(row);
    }
    controls();
  }
  async function refresh(epoch) {
    const result = await repository.execute('status');
    if (epoch === viewGeneration && !disposed) showStatus(result);
    return result;
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
    find('[data-token-storage]').textContent = result.supported ? `App-wide token storage: ${result.storage ?? 'OS credential store'}. Secrets are excluded from FILES and cassettes.` : 'Saved tokens are not supported on this OS.';
    controls();
  }
  async function command(action, args = {}) {
    if (busy || disposed) return;
    busy = true; controls();
    const epoch = viewGeneration;
    try {
      const result = await repository.execute(action, args);
      if (epoch !== viewGeneration || disposed) return;
      if (action === 'diff') output.textContent = (result.text || (args.staged ? 'No staged changes.' : 'No unstaged changes.')) + (result.truncated ? '\n[Diff truncated]' : '');
      else if (action === 'log') output.textContent = result.length ? result.map(commit => `${commit.id.slice(0, 10)}  ${commit.message.trim()}\n  ${commit.author} · ${new Date(commit.time * 1000).toLocaleString()}`).join('\n\n') : 'No commits yet.';
      else if (action === 'branch') output.textContent = [...result.local.map(name => `${name === result.current ? '* ' : '  '}${name}`), ...(args.name ? [`\nCreated ${args.name}; current branch remains ${result.current}.`] : [])].join('\n');
      else if (action === 'commit') { output.textContent = `Committed ${result.commit}`; message.value = ''; onStatus('Project Git commit saved.'); }
      else if (action === 'stage') output.textContent = 'Changes staged. Review Staged diff before committing.';
      else if (action === 'init') output.textContent = 'Local repository initialized on main. Stage files and make the first commit.';
      else if (action === 'remote') output.textContent = result.map(entry => `${entry.remote}\t${entry.url}`).join('\n') || 'No remote configured.';
      else if (['fetch', 'pull', 'push'].includes(action)) output.textContent = `${action === 'fetch' ? 'Fetched remote history' : action === 'pull' ? 'Pulled compatible history (fast-forward)' : 'Push completed'}.`;
      if (['init', 'status', 'stage'].includes(action)) showStatus(result);
      else await refresh(epoch);
      if (action === 'status' && result.initialized) {
        const name = await repository.execute('config', {path: 'user.name'}), email = await repository.execute('config', {path: 'user.email'});
        if (epoch === viewGeneration && !disposed) { authorName.value = name.value ?? ''; authorEmail.value = email.value ?? ''; }
        const remotes = await repository.execute('remote');
        if (epoch === viewGeneration && !disposed) {
          remoteBranch.value = result.branch ?? 'main';
          remoteUrl.value = remotes.find(entry => entry.remote === remote.value)?.url ?? '';
        }
      }
    } catch (error) {
      if (epoch === viewGeneration && !disposed) {
        output.textContent = error.message;
        onError(error);
      }
    } finally {
      busy = false;
      if (!disposed) controls();
    }
  }
  dialog.querySelectorAll('[data-git-action]').forEach(control => control.onclick = () => {
    const action = control.dataset.gitAction;
    if (action === 'stage') return void command('stage', {paths: ['/']});
    if (action === 'staged') return void command('diff', {staged: true});
    if (action === 'commit') return void command('commit', {message: message.value, name: authorName.value.trim(), email: authorEmail.value.trim()});
    if (action === 'branch') return void command('branch', {name: branch.value.trim()});
    if (action === 'branches') return void command('branch');
    if (action === 'save-remote') {
      if (!remoteUrl.value.trim()) { output.textContent = 'Enter an HTTPS repository URL.'; return; }
      return void command('remote', {remote: remote.value.trim(), url: remoteUrl.value.trim()});
    }
    if (['fetch', 'pull', 'push'].includes(action)) return void command(action, {remote: remote.value.trim(), branch: remoteBranch.value.trim()});
    return void command(action);
  });
  tokenSection.addEventListener('click', async event => {
    const action = event.target.closest('[data-token-action]')?.dataset.tokenAction;
    if (!tokens || !action || busy || disposed) return;
    busy = true; controls(); const epoch = viewGeneration;
    try {
      let preferred;
      if (action === 'add') {
        const result = await tokens.add({name: tokenName.value.trim(), host: tokenHost.value.trim()});
        preferred = result.entry.id;
        if (epoch === viewGeneration && !disposed) { tokenName.value = ''; output.textContent = 'Token saved in the OS credential store.'; }
      } else {
        if (!tokenList.value) throw Error('Select a saved token.');
        if (action === 'select') { preferred = tokenList.value; await tokens.select(preferred); }
        else await tokens.remove(tokenList.value);
        if (epoch === viewGeneration && !disposed) output.textContent = action === 'select' ? 'App token selected.' : 'Saved token deleted. The token itself is not revoked on GitHub.';
      }
      await refreshTokens(epoch, preferred);
    } catch (error) { if (epoch === viewGeneration && !disposed) { output.textContent = error.message; onError(error); } }
    finally { busy = false; if (!disposed) controls(); }
  });
  async function open() {
    if (disposed) return;
    if (!dialog.open) dialog.showModal();
    await command('status');
    try { await refreshTokens(viewGeneration); } catch (error) { if (!disposed) { output.textContent = error.message; onError(error); } }
  }
  const onOpen = () => void open();
  button?.addEventListener('click', onOpen);
  return {
    open,
    close() { dialog.close(); },
    invalidate() { viewGeneration++; repository.invalidate(); currentStatus = null; output.textContent = ''; files.replaceChildren(); authorName.value = ''; authorEmail.value = ''; remote.value = 'origin'; remoteBranch.value = 'main'; remoteUrl.value = ''; status.textContent = 'Project changed. Refresh status to inspect this project.'; controls(); },
    dispose() { disposed = true; viewGeneration++; repository.dispose(); button?.removeEventListener('click', onOpen); dialog.remove(); },
    execute: repository.execute,
  };
}
