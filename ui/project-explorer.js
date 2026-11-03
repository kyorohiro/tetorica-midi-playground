import {renderFileTree} from './shared/playground_file_tree.js';
import {createProjectFiles, isInternalProjectPath, normalizeProjectPath} from './project-files.js';
import {binaryFile} from './project-assets.js';
import {isGuide, canRun} from './guide.js';

/** Ordinary FILES operations share the same store and revision checks as Git. */
export function mountProjectExplorer({root, newFileButton, newFolderButton, actionsButton, importButton, input,
  getStore, getFiles, getSelected, onOpen, beforeChange, onChanged, onError, onStatus}) {
  const expanded = new Map();
  const dialog = document.createElement('dialog');
  dialog.className = 'project-dialog file-actions-dialog';
  dialog.setAttribute('aria-label', 'FILES actions');
  const title = document.createElement('h2'), description = document.createElement('p');
  const actions = document.createElement('div'); actions.className = 'file-actions';
  const form = document.createElement('form');
  const label = document.createElement('label'); label.textContent = 'Project path';
  const pathInput = document.createElement('input'); pathInput.required = true; pathInput.autocomplete = 'off'; pathInput.spellcheck = false;
  label.append(pathInput);
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const footer = document.createElement('div'); footer.className = 'project-dialog-actions';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Cancel'; close.onclick = () => dialog.close();
  const submit = document.createElement('button'); submit.type = 'submit';
  footer.append(close, submit); form.append(label, error, footer); dialog.append(title, description, actions, form); document.body.append(dialog);
  let operation = null, actionStore = null, target = '/', importDirectory = '/', dialogGeneration = 0;
  dialog.addEventListener('close', () => {dialogGeneration++;});
  const report = error => onError?.(error);
  const perform = task => Promise.resolve().then(task).catch(report);
  const directoryOf = path => path.slice(0, path.lastIndexOf('/')) || '/';
  const join = (dir, name) => (dir === '/' ? '' : dir) + '/' + name;
  const exists = path => Object.hasOwn(getFiles(), path) || getStore().listDirectories().includes(path);
  const isDirectory = path => path === '/' || getStore().listDirectories().includes(path) || Object.keys(getFiles()).some(file => file.startsWith(path + '/'));
  const currentDirectory = () => isDirectory(target) ? target : directoryOf(target);
  function show(mode, path = getSelected()) {
    dialogGeneration++;
    target = path; operation = mode; actionStore = getStore(); error.textContent = '';
    actions.replaceChildren(); actions.hidden = mode !== 'actions'; form.hidden = mode === 'actions'; label.hidden = mode === 'delete';
    title.textContent = {actions: 'FILES actions', create: 'New file', folder: 'New folder', rename: 'Rename / move', copy: 'Copy', delete: 'Delete'}[mode];
    description.textContent = mode === 'delete' ? `Delete ${path}${isDirectory(path) ? ' and everything inside it' : ''}? Playback will stop.` : path;
    if (mode === 'actions') {
      const protectedPath = path === '/' || isGuide(path) || isInternalProjectPath(path);
      for (const [text, next, disabled] of [['New file…','create',false],['New folder…','folder',false],['Rename / move…','rename',protectedPath],['Copy…','copy',protectedPath],['Delete…','delete',protectedPath],['Copy relative path','path',false]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.disabled = disabled;
        button.onclick = () => next === 'path' ? perform(async () => {await copyPath(path); dialog.close();}) : show(next, path);
        actions.append(button);
      }
      const done = document.createElement('button'); done.textContent = 'Close'; done.onclick = () => dialog.close(); actions.append(done);
    } else {
      submit.textContent = {create:'Create file',folder:'Create folder',rename:'Move',copy:'Copy',delete:'Delete'}[mode];
      const dir = currentDirectory();
      let next = mode === 'create' ? join(dir, 'untitled.js') : mode === 'folder' ? join(dir, 'new-folder') : mode === 'copy' ? path.replace(/(\.[^/.]+)?$/, '-copy$1') : path;
      if (['create','folder','copy'].includes(mode)) {let number=2; const base=next; while(exists(next)) next=base.replace(/(\.[^/.]+)?$/, `-${number++}$1`);}
      pathInput.value = next;
    }
    if (!dialog.open) dialog.showModal();
    if (mode !== 'actions' && mode !== 'delete') {pathInput.focus(); pathInput.select();}
  }
  async function change(task, detail = {}, assertActive = () => {}) {
    const store = getStore();
    await beforeChange?.();
    assertActive();
    if (getStore() !== store) throw Error('Project changed. Try the FILES action again.');
    const revision = store.revision, draft = createProjectFiles(store.snapshot());
    task(draft);
    const next = draft.snapshot();
    assertActive();
    publishDraft(store, revision, next);
    onChanged?.(detail); render();
  }
  function publishDraft(store, revision, next) {
    if (!Object.entries(next.files).some(([path, value]) => canRun(path) && !isInternalProjectPath(path) && !isGuide(path) && typeof value === 'string')) {
      throw Error('Keep at least one JavaScript file (.js or .mjs) for Run and project export. Create another script before removing or renaming this one.');
    }
    if (getStore() !== store || store.revision !== revision) throw Error('Project changed during the FILES action. Try again.');
    store.sync(next.files, next.directories);
  }
  form.onsubmit = async event => {
    event.preventDefault(); submit.disabled = true;
    const mode = operation, source = target, store = actionStore, generation = dialogGeneration;
    const assertActive = () => {
      if (getStore() !== store) throw Error('Project changed. Reopen FILES actions.');
      if (!dialog.open || dialogGeneration !== generation) throw Error('FILES action cancelled.');
    };
    try {
      assertActive();
      const to = mode === 'delete' ? null : normalizeProjectPath(pathInput.value);
      if (mode === 'delete') await change(store => store.remove(source), {removed:source}, assertActive);
      else if (mode === 'create') await change(store => store.createFile(to, /\.m?js$/i.test(to) ? '// MIDI Playground\n' : ''), {open:to}, assertActive);
      else if (mode === 'folder') await change(store => store.mkdir(to), {}, assertActive);
      else await change(store => store.transfer(source, to, {copy:mode === 'copy'}), {from:source,to,copy:mode === 'copy'}, assertActive);
      dialog.close();
    } catch (reason) {if (generation === dialogGeneration) error.textContent = String(reason.message ?? reason);}
    finally {submit.disabled = false;}
  };
  async function copyPath(path) {
    const relative = path.replace(/^\//, '') || '.';
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(relative);
    else {
      const field = document.createElement('textarea'); field.value = relative; dialog.append(field); field.select();
      try {if (!document.execCommand('copy')) throw Error('Clipboard unavailable. Path: ' + relative);} finally {field.remove();}
    }
    onStatus?.('Copied path: ' + relative);
  }
  async function importFiles(incoming, directory = '/') {
    const store = getStore(), revision = store.revision;
    const snapshot = store.snapshot(), additions = {};
    for (const file of incoming) {
      if (file.size > 1000000) throw Error('File exceeds 1 MB: ' + file.name);
      const path = normalizeProjectPath(join(directory || '/', file.name));
      if (isGuide(path) || isInternalProjectPath(path) || exists(path) || Object.hasOwn(additions,path)) throw Error('Project path already exists or is protected: ' + path);
      additions[path] = /\.(tfi|vgi)$/i.test(path) ? binaryFile(new Uint8Array(await file.arrayBuffer())) : await file.text();
    }
    if (!Object.keys(additions).length) return;
    await beforeChange?.();
    if (getStore() !== store || store.revision !== revision) throw Error('Project changed during import. Try again.');
    // Validate each path with ordinary creation rules before publishing the batch.
    const draft = createProjectFiles(snapshot);
    for (const [path,value] of Object.entries(additions)) draft.createFile(path,value);
    publishDraft(store, revision, draft.snapshot());
    onChanged?.({open:Object.keys(additions)[0]}); render();
  }
  function render() {
    const entries = Object.keys(getFiles()).filter(path => !isInternalProjectPath(path)).map(path => ({path}));
    entries.push(...getStore().listDirectories().filter(path => !isInternalProjectPath(path)).map(path => ({path,directory:true})));
    renderFileTree(root, entries, {selectedPath:getSelected(), expanded, onOpen,
      onTransfer:(from,to,copy) => perform(() => change(store => store.transfer(from,to,{copy}), {from,to,copy})),
      onImport:(incoming,dir) => perform(() => importFiles(incoming,dir))});
  }
  root.addEventListener('contextmenu', event => {event.preventDefault(); show('actions',event.target.closest('[data-file-path]')?.dataset.filePath ?? '/');});
  newFileButton.onclick = () => show('create'); newFolderButton.onclick = () => show('folder'); actionsButton.onclick = () => show('actions');
  importButton.onclick = () => {target=getSelected(); importDirectory=currentDirectory(); input.click();};
  input.onchange = () => perform(async () => {try {await importFiles([...input.files],importDirectory);} finally {input.value='';}});
  return {render, reset(){expanded.clear();dialog.close();}, dispose(){dialog.remove();}};
}
