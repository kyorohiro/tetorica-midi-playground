import {zipSync, unzipSync, strToU8} from './vendor/fflate.js';
import {isGuide, canRun} from './guide.js';

export const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
const FORMAT = 'tetorica-midi-playground';
const MANIFEST = 'metadata.json';
const decoder = new TextDecoder('utf-8', {fatal: true});

function validatePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path) || path.split('/').slice(1).some(part => !part || part === '.' || part === '..')) {
    throw Error('Invalid project file path: ' + path);
  }
}
function validateProject(project) {
  if (!project || !project.files || typeof project.files !== 'object' || Array.isArray(project.files)) throw Error('Invalid project files');
  const files = {};
  for (const [path, text] of Object.entries(project.files)) {
    validatePath(path);
    if (typeof text !== 'string') throw Error('Project files must contain text: ' + path);
    if (path === '/' + MANIFEST) throw Error('metadata.json is reserved for the project manifest');
    if (!isGuide(path)) files[path] = text;
  }
  if (!canRun(project.runPath) || !Object.hasOwn(files, project.runPath)) throw Error('Project Run file is missing or not JavaScript');
  if (!Number.isFinite(project.bpm) || project.bpm < 1 || project.bpm > 999) throw Error('Project BPM must be between 1 and 999');
  if (!['internal', 'external'].includes(project.clockMode)) throw Error('Invalid project beat clock');
  const selected = Object.hasOwn(files, project.selected) || isGuide(project.selected) ? project.selected : project.runPath;
  return {files, runPath: project.runPath, selected, bpm: project.bpm, clockMode: project.clockMode};
}

export function exportProject(project) {
  const {files, ...settings} = validateProject(project);
  const entries = Object.create(null);
  let total = 0;
  for (const [path, text] of Object.entries(files)) {
    const data = strToU8(text);
    total += data.length;
    entries[path.slice(1)] = data;
  }
  entries[MANIFEST] = strToU8(JSON.stringify({format: FORMAT, version: 1, ...settings}, null, 2));
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
  if (metadata?.format !== FORMAT || metadata.version !== 1) throw Error('Unsupported project format or version');
  const files = {};
  for (const [path, data] of Object.entries(entries)) {
    if (path !== MANIFEST) files['/' + path] = decoder.decode(data);
  }
  return validateProject({...metadata, files});
}
