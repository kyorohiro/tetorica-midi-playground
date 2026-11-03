import {createVirtualFileSystem, transferVirtualFiles} from './shared/virtual-files/filesystem.js';
import {resolvePath} from './shared/virtual-files/path.js';
import {binaryFile, isBinaryFile} from './project-assets.js';
import {isGuide, guides, canRun} from './guide.js';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 1023; // A cassette also contains metadata.json.
const MAX_DIRECTORIES = 1024;
const encoder = new TextEncoder();
const guidePaths = Object.keys(guides);
const guideDirectories = guidePaths.map(path => path.slice(0, path.lastIndexOf('/')) || '/');
const inside = (path, root) => path === root || path.startsWith(root + '/');

/** Normalize a FILES path. No host filesystem paths are accessed. */
export function normalizeProjectPath(path) {
  if (typeof path !== 'string' || !path || /[\\\x00-\x1f\x7f<>:"|?*]/.test(path)) throw Error('Invalid project path');
  const normalized = resolvePath(path);
  for (const part of normalized.split('/').filter(Boolean)) {
    if (/[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) throw Error('Project path is not portable: ' + path);
  }
  return normalized;
}

/** Git metadata is persisted but hidden from ordinary FILES editing. */
export function isInternalProjectPath(path) {
  return String(path).split('/').some(part => part.toLowerCase() === '.git');
}

function ordinaryPath(path) {
  path = normalizeProjectPath(path);
  if (path === '/' || isInternalProjectPath(path)) throw Error('This project path is protected: ' + path);
  if (isGuide(path) || inside(path.toLowerCase(), '/metadata.json')) throw Error('Bundled guides and the project manifest are protected: ' + path);
  return path;
}

function portableUnique(paths) {
  const seen = new Map();
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (seen.has(lower) && seen.get(lower) !== path) throw Error('Project paths differ only by letter case: ' + path);
    seen.set(lower, path);
  }
}

function validated(files, directories = []) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw Error('Invalid project files');
  if (!Array.isArray(directories)) throw Error('Invalid project directories');
  const entries = [];
  let total = 0;
  for (const [path, value] of Object.entries(files)) {
    if (normalizeProjectPath(path) !== path || path === '/') throw Error('Invalid project file path: ' + path);
    if (isGuide(path)) {
      if (Object.hasOwn(guides, path)) continue;
      throw Error('Bundled guide namespace is protected: ' + path);
    }
    if (inside(path.toLowerCase(), '/metadata.json')) throw Error('metadata.json is reserved for the project manifest');
    if (typeof value !== 'string' && !isBinaryFile(value)) throw Error('Invalid project file: ' + path);
    if (canRun(path) && !isInternalProjectPath(path) && typeof value !== 'string') throw Error('JavaScript files must contain text: ' + path);
    const data = typeof value === 'string' ? value : Uint8Array.from(value.bytes);
    total += typeof data === 'string' ? encoder.encode(data).length : data.length;
    entries.push({path, data});
  }
  const dirs = [];
  for (const path of directories) {
    if (normalizeProjectPath(path) !== path) throw Error('Invalid project directory path: ' + path);
    if (path === '/') continue;
    if (isGuide(path) || inside(path.toLowerCase(), '/metadata.json')) throw Error('Protected project directory path: ' + path);
    if (dirs.includes(path)) throw Error('Duplicate project directory: ' + path);
    dirs.push(path);
  }
  if (total > MAX_BYTES || entries.length > MAX_FILES || dirs.length > MAX_DIRECTORIES) throw Error('Project exceeds the 16 MiB / 1024 file or directory limit');
  const draft = createVirtualFileSystem(entries, {autoCheckpoint: false});
  draft.replace(entries, dirs);
  portableUnique([...draft.list().map(file => file.path), ...draft.listDirectories(), ...guidePaths, ...guideDirectories]);
  for (const directory of draft.listDirectories()) if (isGuide(directory)) throw Error('Bundled guide occupies directory path: ' + directory);
  if (draft.listDirectories().length - 1 > MAX_DIRECTORIES) throw Error('Project exceeds the 1024 directory limit');
  return draft;
}

function toSnapshot(fs) {
  return {
    files: Object.fromEntries(fs.list().map(file => [file.path, typeof file.data === 'string' ? file.data : binaryFile(file.data)])),
    directories: fs.listDirectories().filter(path => path !== '/'),
  };
}

function sameSnapshot(a, b) {
  const paths = Object.keys(a.files), other = Object.keys(b.files);
  if (paths.length !== other.length || a.directories.length !== b.directories.length || a.directories.some((path, i) => path !== b.directories[i])) return false;
  return paths.every(path => {
    const left = a.files[path], right = b.files[path];
    return typeof left === 'string' ? left === right : isBinaryFile(right) && left.bytes.length === right.bytes.length && left.bytes.every((byte, i) => byte === right.bytes[i]);
  });
}

/** JSON-safe project values around the shared memory filesystem. Mutations
 * validate a private draft before publishing; Git receives the stable fs. */
export function createProjectFiles({files = {}, directories = []} = {}) {
  const initial = validated(files, directories);
  const fs = createVirtualFileSystem([], {autoCheckpoint: false});
  fs.restore(initial.snapshot());
  let revision = 1;
  fs.onDidChange(() => { revision++; });
  function publish(draft, {force = false} = {}) {
    if (!force && sameSnapshot(toSnapshot(fs), toSnapshot(draft))) return false;
    fs.replace(draft.list(), draft.listDirectories());
    return true;
  }
  function mutate(callback) {
    const draft = createVirtualFileSystem([], {autoCheckpoint: false});
    draft.restore(fs.snapshot());
    const result = callback(draft);
    const snapshot = toSnapshot(draft);
    publish(validated(snapshot.files, snapshot.directories));
    return result;
  }
  const api = {
    fs,
    get revision() { return revision; },
    snapshot() { return toSnapshot(fs); },
    listDirectories() { return fs.listDirectories().filter(path => path !== '/'); },
    validate(files, directories = []) { validated(files, directories); },
    /** Git validates its isolated draft before publishing through fs.replace. */
    validateReplacement(entries, directories = []) {
      if (!Array.isArray(entries)) throw Error('Invalid project file entries');
      const files = {};
      for (const entry of entries) {
        if (!entry || typeof entry.path !== 'string' || Object.hasOwn(files, entry.path)) throw Error('Invalid or duplicate project file entry');
        if (isGuide(entry.path)) throw Error('Bundled guide is protected: ' + entry.path);
        if (typeof entry.data !== 'string' && !(entry.data instanceof Uint8Array) && !(entry.data instanceof ArrayBuffer)) throw Error('Invalid project file data: ' + entry.path);
        files[entry.path] = typeof entry.data === 'string' ? entry.data : binaryFile(entry.data instanceof ArrayBuffer ? new Uint8Array(entry.data) : entry.data);
      }
      validated(files, directories);
    },
    /** Flush editor state without changing unchanged revisions. */
    sync(files, directories = api.listDirectories()) { return publish(validated(files, directories)); },
    /** New/Import must invalidate in-flight operations even for identical data. */
    replace(files, directories = []) { publish(validated(files, directories), {force: true}); },
    write(path, value) {
      path = ordinaryPath(path);
      return mutate(draft => {
        if (!draft.has(path)) throw Error('Project file does not exist: ' + path);
        if (typeof value !== 'string' && !isBinaryFile(value)) throw Error('Invalid project file: ' + path);
        draft.writeFile(path, typeof value === 'string' ? value : Uint8Array.from(value.bytes));
      });
    },
    createFile(path, text = '') {
      path = ordinaryPath(path);
      return mutate(draft => {
        if (draft.has(path) || draft.listDirectories().includes(path)) throw Error('Project path already exists: ' + path);
        if (typeof text !== 'string' && !isBinaryFile(text)) throw Error('Invalid project file: ' + path);
        draft.writeFile(path, typeof text === 'string' ? text : Uint8Array.from(text.bytes));
        return path;
      });
    },
    mkdir(path) {
      path = ordinaryPath(path);
      return mutate(draft => {
        if (draft.has(path) || draft.listDirectories().includes(path)) throw Error('Project path already exists: ' + path);
        draft.mkdir(path, {recursive: true});
        return path;
      });
    },
    transfer(from, to, options = {}) {
      from = ordinaryPath(from); to = ordinaryPath(to);
      return mutate(draft => {
        if ([...draft.list().map(file => file.path), ...draft.listDirectories()].some(path => inside(path, from) && isInternalProjectPath(path))) throw Error('Folder contains protected Git metadata: ' + from);
        return transferVirtualFiles(draft, from, to, options);
      });
    },
    remove(path) {
      path = ordinaryPath(path);
      return mutate(draft => {
        if ([...draft.list().map(file => file.path), ...draft.listDirectories()].some(candidate => inside(candidate, path) && isInternalProjectPath(candidate))) throw Error('Folder contains protected Git metadata: ' + path);
        draft.remove(path, {recursive: true});
      });
    },
  };
  return api;
}
