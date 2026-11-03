import {createVirtualGit, formatGitStatus} from './vendor/virtual-git/git.bundle.js';

const localActions = new Set(['init', 'status', 'diff', 'stage', 'commit', 'log', 'branch', 'config']);

/** Local Git over the current project's virtual FILES. Never accesses host Git or a remote. */
export function createProjectGit({getStore, beforeCommand = () => {}, onChanged = () => {}}) {
  let active = null, generation = 0, disposed = false;
  const assertProject = (store, epoch) => {
    if (disposed || epoch !== generation || getStore() !== store) throw Error('Project changed during Git operation; retry with the current project');
  };
  return {
    get busy() { return active !== null; },
    invalidate() { generation++; active?.abort(); },
    dispose() { disposed = true; generation++; active?.abort(); },
    async execute(action, args = {}) {
      if (!localActions.has(action)) throw Error('Only local init, status, diff, stage, commit, log, branch and author config are available');
      if (disposed) throw Error('Git panel is closed');
      if (active) throw Error('A Git operation is already running');
      const controller = new AbortController(), epoch = generation, store = getStore();
      active = controller;
      try {
        await beforeCommand();
        assertProject(store, epoch);
        const revision = store.revision;
        const assertActive = () => {
          assertProject(store, epoch);
          if (store.revision !== revision) throw Error('Files changed during Git operation; retry with the current project');
        };
        // Validate the complete draft before publishing Git objects and refs.
        // This retains cassette limits without rolling back newer editor work.
        const fs = {...store.fs, replace(entries, directories, options) {
          store.validateReplacement(entries, directories);
          store.fs.replace(entries, directories, options);
        }};
        const repository = createVirtualGit({fs});
        const result = await repository.execute(action, args, {signal: controller.signal, assertActive});
        // The successful publication itself advances the store's revision.
        assertProject(store, epoch);
        onChanged(store.snapshot());
        return result;
      } finally {
        if (active === controller) active = null;
      }
    },
  };
}

/** A small local Git panel; authored commits and /.git are saved with the project cassette. */
export function mountProjectGit({button, getStore, beforeCommand, onChanged, onError = () => {}, onStatus = () => {}}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'project-git-dialog';
  dialog.setAttribute('aria-label', 'Project Git');
  dialog.style.cssText = 'width:min(840px,92vw);max-height:86vh;overflow:auto;padding:22px;background:#f5fafb;color:#193a43;border:2px solid #54747d;border-radius:8px;';
  dialog.innerHTML = `<form method="dialog" style="display:flex;align-items:center;gap:12px"><h2 style="margin:0;flex:1">Project Git</h2><button value="close" aria-label="Close Git">Close</button></form>
    <p>Local history for FILES. Git data is included in project saves and cassettes. Remote connections are not configured here.</p>
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
    <pre data-git-output tabindex="0" style="white-space:pre-wrap;overflow-wrap:anywhere;background:#17252d;color:#d5eaf0;min-height:110px;max-height:36vh;overflow:auto;padding:12px"></pre>`;
  document.body.append(dialog);
  const find = selector => dialog.querySelector(selector);
  const status = find('[data-git-status]'), output = find('[data-git-output]'), files = find('[data-git-files]');
  const authorName = find('[data-git-name]'), authorEmail = find('[data-git-email]'), message = find('[data-git-message]'), branch = find('[data-git-branch]');
  let currentStatus = null, busy = false, disposed = false, viewGeneration = 0;
  const repository = createProjectGit({getStore, beforeCommand, onChanged});
  function controls() {
    const initialized = currentStatus?.initialized === true;
    dialog.querySelectorAll('[data-git-action]').forEach(control => {
      control.disabled = busy || (control.dataset.gitAction === 'init' ? initialized : control.dataset.gitAction !== 'status' && !initialized);
    });
    dialog.querySelectorAll('[data-git-path]').forEach(control => control.disabled = busy);
    for (const field of [authorName, authorEmail, message, branch]) field.disabled = busy;
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
      if (['init', 'status', 'stage'].includes(action)) showStatus(result);
      else await refresh(epoch);
      if (action === 'status' && result.initialized) {
        const name = await repository.execute('config', {path: 'user.name'}), email = await repository.execute('config', {path: 'user.email'});
        if (epoch === viewGeneration && !disposed) { authorName.value = name.value ?? ''; authorEmail.value = email.value ?? ''; }
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
    return void command(action);
  });
  async function open() {
    if (disposed) return;
    if (!dialog.open) dialog.showModal();
    await command('status');
  }
  const onOpen = () => void open();
  button?.addEventListener('click', onOpen);
  return {
    open,
    close() { dialog.close(); },
    invalidate() { viewGeneration++; repository.invalidate(); currentStatus = null; output.textContent = ''; files.replaceChildren(); status.textContent = 'Project changed. Refresh status to inspect this project.'; controls(); },
    dispose() { disposed = true; viewGeneration++; repository.dispose(); button?.removeEventListener('click', onOpen); dialog.remove(); },
    execute: repository.execute,
  };
}
