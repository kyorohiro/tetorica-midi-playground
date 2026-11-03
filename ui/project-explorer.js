import {renderFileTree} from './shared/playground_file_tree.js';
import {createProjectFiles, isInternalProjectPath, normalizeProjectPath} from './project-files.js';
import {binaryFile} from './project-assets.js';
import {isGuide, canRun} from './guide.js';

const inside = (path, root) => path === root || path.startsWith(root + '/');
const directoryOf = path => path.slice(0, path.lastIndexOf('/')) || '/';
const join = (directory, name) => (directory === '/' ? '' : directory) + '/' + name;
const basename = path => path.slice(path.lastIndexOf('/') + 1);
const writable = path => !isGuide(path) && !isInternalProjectPath(path);
const exists = (store, path) => Object.hasOwn(store.snapshot().files, path) || store.listDirectories().includes(path);
const isDirectory = (store, path) => path === '/' || store.listDirectories().includes(path);

/** Copy captures bytes now; cut retains a source path until a move succeeds. */
export function createExplorerClipboard() {
  let entry = null;
  return {
    get available() { return Boolean(entry); },
    clear() { entry = null; },
    capture(store, path, cut = false) {
      path = normalizeProjectPath(path);
      if (path === '/' || !writable(path)) throw Error('This path cannot be copied or cut.');
      const snapshot = store.snapshot();
      if (!exists(store, path)) throw Error('Project path does not exist: ' + path);
      const paths = [...Object.keys(snapshot.files), ...snapshot.directories].filter(candidate => inside(candidate, path));
      if (paths.some(candidate => !writable(candidate))) throw Error('Folder contains protected Git metadata or guides: ' + path);
      entry = {store, path, cut, directory:isDirectory(store, path),
        files:Object.fromEntries(Object.entries(snapshot.files).filter(([candidate]) => inside(candidate, path))),
        directories:snapshot.directories.filter(candidate => inside(candidate, path))};
    },
    /** Prepare on the private draft, then clear cut only after publication. */
    plan(draft, directory, sourceStore) {
      const captured = entry;
      if (!captured) throw Error('Copy or cut a file or folder first.');
      if (sourceStore !== captured.store) throw Error('Project changed. Copy or cut the item again.');
      directory = normalizeProjectPath(directory);
      if (!writable(directory)) throw Error('This folder is reserved for built-in files or Git metadata.');
      if (!isDirectory(draft, directory)) throw Error('Paste destination must be a folder.');
      const {path, cut, files, directories} = captured;
      if (captured.directory && inside(directory, path)) throw Error('Cannot paste a folder inside itself.');
      const name = basename(path), extension = captured.directory ? '' : name.match(/\.[^./]+$/)?.[0] ?? '';
      const stem = extension ? name.slice(0, -extension.length) : name;
      let destination = join(directory, name);
      if (cut) {
        if (destination === path) throw Error('The item is already in this folder.');
        if (exists(draft, destination)) throw Error('Destination already exists: ' + destination);
      } else {
        for (let number = 1; exists(draft, destination); number++) {
          destination = join(directory, `${stem}-copy${number === 1 ? '' : '-' + number}${extension}`);
        }
      }
      return {
        destination,
        detail:{from:path,to:destination,copy:!cut},
        apply() {
          if (cut) draft.transfer(path, destination);
          else {
            const target = source => destination + source.slice(path.length);
            for (const folder of [...directories].sort((a,b) => a.length - b.length)) {
              if (!isDirectory(draft, target(folder))) draft.mkdir(target(folder));
            }
            for (const [source, value] of Object.entries(files)) draft.createFile(target(source), value);
          }
        },
        commit() { if (cut && entry === captured) entry = null; },
      };
    },
  };
}

/** Ordinary FILES operations share the same store and revision checks as Git. */
export function mountProjectExplorer({root, newFileButton, newFolderButton, actionsButton, importButton, input,
  getStore, getFiles, getSelected, onOpen, beforeChange, onChanged, onError, onStatus}) {
  const expanded = new Map(), clipboard = createExplorerClipboard();
  const menu = document.createElement('div');
  menu.className = 'file-context-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'File actions'); menu.hidden = true;
  const dialog = document.createElement('dialog');
  dialog.className = 'project-dialog file-actions-dialog'; dialog.setAttribute('aria-label', 'FILES action');
  const title = document.createElement('h2'), description = document.createElement('p');
  const form = document.createElement('form'), label = document.createElement('label');
  const pathInput = document.createElement('input'); pathInput.required = true; pathInput.autocomplete = 'off'; pathInput.spellcheck = false;
  label.append(pathInput);
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const footer = document.createElement('div'); footer.className = 'project-dialog-actions';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Cancel'; close.onclick = () => dialog.close();
  const submit = document.createElement('button'); submit.type = 'submit';
  footer.append(close, submit); form.append(label, error, footer); dialog.append(title, description, form); document.body.append(menu, dialog);
  let operation = null, actionStore = null, target = '/', importDirectory = '/', generation = 0, anchor = null;
  const report = error => onError?.(error);
  const perform = task => Promise.resolve().then(task).catch(report);
  const currentDirectory = path => isDirectory(getStore(), path) ? path : directoryOf(path);
  const focusAnchor = () => {if (anchor?.isConnected !== false) anchor?.focus?.({preventScroll:true});};
  function closeMenu(restore = false) {const wasOpen = !menu.hidden; menu.hidden = true; if (restore && wasOpen) focusAnchor();}
  dialog.addEventListener('close', () => {generation++; focusAnchor();});
  function show(mode, path = getSelected()) {
    generation++; closeMenu();
    target = path; operation = mode; actionStore = getStore(); error.textContent = ''; submit.disabled = false;
    label.hidden = mode === 'delete';
    title.textContent = {create:'New file',folder:'New folder',rename:'Rename',delete:'Delete'}[mode];
    description.textContent = mode === 'delete' ? `Delete ${path}${isDirectory(actionStore, path) ? ' and everything inside it' : ''}? Playback will stop.` : path;
    label.textContent = mode === 'rename' ? 'Name' : 'Project path'; label.append(pathInput);
    submit.textContent = {create:'Create file',folder:'Create folder',rename:'Rename',delete:'Delete'}[mode];
    let dir = currentDirectory(path); if (!writable(dir)) dir = '/';
    let next = mode === 'create' ? join(dir,'untitled.js') : mode === 'folder' ? join(dir,'new-folder') : basename(path);
    if (mode === 'create' || mode === 'folder') {
      let number = 2; const base = next;
      while (exists(actionStore,next)) next = base.replace(/(\.[^/.]+)?$/, `-${number++}$1`);
    }
    pathInput.value = next;
    if (!dialog.open) dialog.showModal();
    if (mode !== 'delete') {pathInput.focus();pathInput.select();}
  }
  const assertCurrent = (store, stamp) => {
    if (getStore() !== store) throw Error('Project changed. Reopen FILES actions.');
    if (generation !== stamp) throw Error('FILES action cancelled.');
  };
  async function change(task, detail = {}, assertActive = () => {}) {
    const store = getStore();
    await beforeChange?.(); assertActive();
    if (getStore() !== store) throw Error('Project changed. Try the FILES action again.');
    const revision = store.revision, draft = createProjectFiles(store.snapshot());
    const result = task(draft); assertActive();
    publishDraft(store, revision, draft.snapshot());
    onChanged?.(result ?? detail); render();
  }
  function publishDraft(store, revision, next) {
    if (!Object.entries(next.files).some(([path,value]) => canRun(path) && !isInternalProjectPath(path) && !isGuide(path) && typeof value === 'string')) {
      throw Error('Keep at least one JavaScript file (.js or .mjs) for Run and project export. Create another script before removing or renaming this one.');
    }
    if (getStore() !== store || store.revision !== revision) throw Error('Project changed during the FILES action. Try again.');
    store.sync(next.files, next.directories);
  }
  form.onsubmit = async event => {
    event.preventDefault(); submit.disabled = true;
    const mode = operation, source = target, store = actionStore, stamp = generation;
    const assertActive = () => {assertCurrent(store,stamp);if (!dialog.open) throw Error('FILES action cancelled.');};
    try {
      assertActive();
      let to = null;
      if (mode === 'rename') {
        const name = pathInput.value;
        if (!name || name === '.' || name === '..' || /[/\\]/.test(name)) throw Error('Enter a name without a folder path.');
        to = normalizeProjectPath(join(directoryOf(source),name));
      } else if (mode !== 'delete') to = normalizeProjectPath(pathInput.value);
      if (mode === 'delete') await change(draft => {draft.remove(source);}, {removed:source}, assertActive);
      else if (mode === 'create') await change(draft => {draft.createFile(to,/\.m?js$/i.test(to) ? '// MIDI Playground\n' : '');}, {open:to}, assertActive);
      else if (mode === 'folder') await change(draft => {draft.mkdir(to);}, {}, assertActive);
      else await change(draft => {draft.transfer(source,to);}, {from:source,to,copy:false}, assertActive);
      dialog.close();
    } catch (reason) {if (stamp === generation) error.textContent = String(reason.message ?? reason);}
    finally {if (stamp === generation) submit.disabled = false;}
  };
  async function copyPath(path) {
    const relative = path.replace(/^\//,'') || '.';
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(relative);
    else {
      const field = document.createElement('textarea'); field.value = relative; field.style.position = 'fixed'; field.style.opacity = '0'; document.body.append(field); field.select();
      try {if (!document.execCommand('copy')) throw Error('Clipboard unavailable. Path: ' + relative);} finally {field.remove();}
    }
    onStatus?.('Copied relative path: ' + relative);
  }
  function openMenu(event, path, element) {
    event.preventDefault?.(); event.stopPropagation?.();
    if (dialog.open) dialog.close();
    generation++; anchor = element; menu.replaceChildren();
    const store = getStore(), stamp = generation, directory = currentDirectory(path);
    const mutable = path !== '/' && writable(path), capture = cut => {
      assertCurrent(store,stamp); clipboard.capture(store,path,cut); onStatus?.(`${cut ? 'Cut' : 'Copied'} ${path}.${cut ? ' Choose a folder and paste to move.' : ''}`);
    };
    const actions = [
      ['Copy Relative Path',() => copyPath(path),true],
      ['Copy',() => capture(false),mutable],
      ['Paste',async () => {
        let plan;
        await change(draft => {plan = clipboard.plan(draft,directory,store);plan.apply();return plan.detail;}, {}, () => assertCurrent(store,stamp));
        plan.commit(); onStatus?.('Pasted ' + plan.destination + '.');
      },clipboard.available && writable(directory)],
      ['Delete',() => show('delete',path),mutable],
      ['Cut',() => capture(true),mutable],
      ['Rename…',() => show('rename',path),mutable],
      ['New File…',() => show('create',path),writable(directory)],
      ['New Folder…',() => show('folder',path),writable(directory)],
    ];
    for (const [text, action, enabled] of actions) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.disabled = !enabled; button.setAttribute('role','menuitem');
      button.onclick = () => {closeMenu(true);return perform(() => {assertCurrent(store,stamp);return action();});}; menu.append(button);
    }
    menu.hidden = false;
    menu.style.left = Math.max(0,Math.min(event.clientX ?? 0,window.innerWidth - menu.offsetWidth)) + 'px';
    menu.style.top = Math.max(0,Math.min(event.clientY ?? 0,window.innerHeight - menu.offsetHeight)) + 'px';
    menu.querySelector('button:not(:disabled)')?.focus();
  }
  const contextmenu = event => {
    const item = event.target.closest('[data-file-path]'); openMenu(event,item?.dataset.filePath ?? '/',item ?? root);
  };
  const contextKey = event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    const item = event.target.closest('[data-file-path]'), element = item ?? root, bounds = element.getBoundingClientRect();
    openMenu({preventDefault:() => event.preventDefault(),stopPropagation:() => event.stopPropagation(),clientX:bounds.left,clientY:bounds.bottom},item?.dataset.filePath ?? '/',element);
  };
  const menuKey = event => {
    if (event.key === 'Escape') {event.preventDefault();closeMenu(true);return;}
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? (index+1)%buttons.length : event.key === 'ArrowUp' ? (index-1+buttons.length)%buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : null;
    if (next !== null) {event.preventDefault();buttons[next]?.focus();}
    if (event.key === 'Tab') closeMenu();
  };
  const outsidePointer = event => {if (!menu.contains(event.target)) closeMenu();};
  const outsideScroll = event => {if (!menu.contains(event.target)) closeMenu();};
  const dismiss = () => closeMenu();
  root.addEventListener('contextmenu',contextmenu); root.addEventListener('keydown',contextKey); menu.addEventListener('keydown',menuKey);
  document.addEventListener('pointerdown',outsidePointer); document.addEventListener('scroll',outsideScroll,true);
  window.addEventListener('resize',dismiss); window.addEventListener('blur',dismiss);
  async function importFiles(incoming, directory = '/') {
    const store = getStore(), revision = store.revision;
    const snapshot = store.snapshot(), additions = {};
    for (const file of incoming) {
      if (file.size > 1000000) throw Error('File exceeds 1 MB: ' + file.name);
      const path = normalizeProjectPath(join(directory || '/',file.name));
      if (isGuide(path) || isInternalProjectPath(path) || exists(store,path) || Object.hasOwn(additions,path)) throw Error('Project path already exists or is protected: ' + path);
      additions[path] = /\.(tfi|vgi)$/i.test(path) ? binaryFile(new Uint8Array(await file.arrayBuffer())) : await file.text();
    }
    if (!Object.keys(additions).length) return;
    await beforeChange?.();
    if (getStore() !== store || store.revision !== revision) throw Error('Project changed during import. Try again.');
    const draft = createProjectFiles(snapshot);
    for (const [path,value] of Object.entries(additions)) draft.createFile(path,value);
    publishDraft(store,revision,draft.snapshot()); onChanged?.({open:Object.keys(additions)[0]}); render();
  }
  function render() {
    const entries = Object.keys(getFiles()).filter(path => !isInternalProjectPath(path)).map(path => ({path}));
    entries.push(...getStore().listDirectories().filter(path => !isInternalProjectPath(path)).map(path => ({path,directory:true})));
    renderFileTree(root,entries,{selectedPath:getSelected(),expanded,onOpen,
      onTransfer:(from,to,copy) => perform(() => change(draft => {draft.transfer(from,to,{copy});}, {from,to,copy})),
      onImport:(incoming,dir) => perform(() => importFiles(incoming,dir))});
  }
  newFileButton.onclick = () => {anchor = newFileButton;show('create');};
  newFolderButton.onclick = () => {anchor = newFolderButton;show('folder');};
  actionsButton.onclick = event => {const bounds = actionsButton.getBoundingClientRect();openMenu({preventDefault:() => event?.preventDefault?.(),clientX:bounds.left,clientY:bounds.bottom},getSelected(),actionsButton);};
  importButton.onclick = () => {
    importDirectory = currentDirectory(getSelected());
    if (!writable(importDirectory)) importDirectory = '/';
    input.click();
  };
  input.onchange = () => perform(async () => {try {await importFiles([...input.files],importDirectory);} finally {input.value='';}});
  return {render,reset(){generation++;expanded.clear();clipboard.clear();closeMenu();if (dialog.open) dialog.close();},dispose(){
    generation++;root.removeEventListener('contextmenu',contextmenu);root.removeEventListener('keydown',contextKey);menu.removeEventListener('keydown',menuKey);
    document.removeEventListener('pointerdown',outsidePointer);document.removeEventListener('scroll',outsideScroll,true);window.removeEventListener('resize',dismiss);window.removeEventListener('blur',dismiss);
    menu.remove();dialog.remove();
  }};
}
