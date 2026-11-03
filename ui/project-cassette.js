import {isBinaryFile,binaryFile,fileBytes} from './project-assets.js';
import {zipSync, unzipSync, strToU8} from './vendor/fflate.js';
import {isGuide, guides, canRun, resolveGuideSelection, validateRemovedGuides, withGuide} from './guide.js';
import {createProjectFiles, isInternalProjectPath, normalizeProjectPath} from './project-files.js';

export const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
const FORMAT = 'tetorica-midi-playground';
const MANIFEST = 'metadata.json';
const decoder = new TextDecoder('utf-8', {fatal: true});

function validatePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path === '/' || normalizeProjectPath(path) !== path || path.split('/').slice(1).some(part => !part || part === '.' || part === '..')) {
    throw Error('Invalid project file path: ' + path);
  }
}
function validateProject(project) {
  if (!project || !project.files || typeof project.files !== 'object' || Array.isArray(project.files)) throw Error('Invalid project files');
  const removedGuides = validateRemovedGuides(project.removedGuides);
  const files = {};
  for (const [path, text] of Object.entries(project.files)) {
    validatePath(path);
    if (typeof text !== 'string' && !isBinaryFile(text)) throw Error('Invalid project file: ' + path);
    if (canRun(path) && !isInternalProjectPath(path) && typeof text !== 'string') throw Error('JavaScript files must contain text: ' + path);
    if (path === '/' + MANIFEST) throw Error('metadata.json is reserved for the project manifest');
    if (isGuide(path)) {
      if (!Object.hasOwn(guides, path)) throw Error('Bundled guide namespace is protected: ' + path);
    } else files[path] = text;
  }
  const runnablePaths = Object.keys(files).filter(path => canRun(path) && !isInternalProjectPath(path));
  const validRunPath = runnablePaths.length ? runnablePaths.includes(project.runPath) : project.runPath === '';
  if (!validRunPath) throw Error('Project Run file is missing or not JavaScript');
  if (!Number.isFinite(project.bpm) || project.bpm < 1 || project.bpm > 999) throw Error('Project BPM must be between 1 and 999');
  if (!['internal', 'external'].includes(project.clockMode)) throw Error('Invalid project beat clock');
  const availableGuides = withGuide({}, removedGuides);
  const resolvedSelection = resolveGuideSelection(project.selected, files);
  const selected = (!isInternalProjectPath(resolvedSelection) && Object.hasOwn(files, resolvedSelection)) || Object.hasOwn(availableGuides, resolvedSelection)
    ? resolvedSelection
    : project.runPath || Object.keys(availableGuides)[0] || Object.keys(files).find(path => !isInternalProjectPath(path)) || '';
  const hasDirectories = Object.hasOwn(project, 'directories');
  const store = createProjectFiles({files, directories: hasDirectories ? project.directories : [], removedGuides});
  const result = {files: store.snapshot().files, runPath: project.runPath, selected, bpm: project.bpm, clockMode: project.clockMode};
  if (hasDirectories) result.directories = store.listDirectories();
  if (removedGuides.length) result.removedGuides = removedGuides;
  return result;
}

export function exportProject(project) {
  const {files, ...settings} = validateProject(project);
  // Empty workspaces and deleted guides use v3 settings without reviving folders.
  if ((!Object.keys(files).length || settings.removedGuides?.length) && !Object.hasOwn(settings, 'directories')) settings.directories = [];
  const entries = Object.create(null);
  let total = 0;
  for (const [path, text] of Object.entries(files)) {
    const data = fileBytes(text);
    total += data.length;
    entries[path.slice(1)] = data;
  }
  const binaryPaths=Object.keys(files).filter(path=>isBinaryFile(files[path]));
  entries[MANIFEST] = strToU8(JSON.stringify({format: FORMAT, version: Object.hasOwn(settings, 'directories') ? 3 : binaryPaths.length ? 2 : 1, binaryPaths, ...settings}, null, 2));
  total += entries[MANIFEST].length;
  if (total > MAX_PROJECT_BYTES || Object.keys(entries).length > 1024) throw Error('Project exceeds the 16 MiB / 1024 file limit');
  const bytes = zipSync(entries, {level: 6});
  if (bytes.length > MAX_PROJECT_BYTES) throw Error('Project ZIP exceeds 16 MiB');
  return bytes;
}

export function importProject(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_PROJECT_BYTES) throw Error('Project ZIP exceeds 16 MiB or is invalid');
  let total = 0;
  const names = new Set();
  const entries = unzipSync(bytes, {filter(entry) {
    validatePath('/' + entry.name);
    if (names.has(entry.name)) throw Error('Duplicate project path: ' + entry.name);
    names.add(entry.name);
    total += entry.originalSize;
    if (total > MAX_PROJECT_BYTES || names.size > 1024) throw Error('Expanded project exceeds the 16 MiB / 1024 file limit');
    return true;
  }});
  if (!Object.hasOwn(entries, MANIFEST)) throw Error('Not a MIDI Playground project: metadata.json is missing');
  const metadata = JSON.parse(decoder.decode(entries[MANIFEST]));
  if (metadata?.format !== FORMAT || ![1,2,3].includes(metadata.version)) throw Error('Unsupported project format or version');
  if (metadata.version === 3 && !Array.isArray(metadata.directories)) throw Error('Invalid project directories');
  const binaryPaths=metadata.version>=2?metadata.binaryPaths:[];
  if(!Array.isArray(binaryPaths)||new Set(binaryPaths).size!==binaryPaths.length)throw Error('Invalid binary file list');
  for(const path of binaryPaths){validatePath(path);if(path==='/'+MANIFEST||!Object.hasOwn(entries,path.slice(1)))throw Error('Missing binary file: '+path);}
  const files = {};
  for (const [path, data] of Object.entries(entries)) {
    if (path !== MANIFEST) files['/' + path] = binaryPaths.includes('/'+path)?binaryFile(data):decoder.decode(data);
  }
  const {directories, ...settings} = metadata;
  return validateProject({...settings, files, ...(metadata.version === 3 ? {directories} : {})});
}
