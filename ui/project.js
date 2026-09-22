import {canRun} from './guide.js';
import {leadExample} from './examples.js';

export function ensureEntry(files, defaultCode) {
  return Object.hasOwn(files, '/index.js') ? {...files} : {...files, '/index.js': defaultCode};
}

export function runSource(files, path) {
  if (!canRun(path) || !Object.hasOwn(files, path)) throw new Error('Choose an existing JavaScript file in Run file.');
  return files[path];
}

export function createNewProject(examples = {}) {
  return {
    files: {...examples, '/index.js': leadExample},
    runPath: '/index.js', selected: '/index.js', bpm: 120, clockMode: 'internal',
  };
}

export function projectFileName(value = 'my-project') {
  const name = String(value).trim().replace(/(?:\.midi\.cassette)?\.zip$/i, '').trim();
  if (!name || name.length > 120 || /^[. ]+$/.test(name) || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name)) {
    throw Error('Enter a file name of 1–120 characters without / \\ : * ? " < > |');
  }
  return name + '.midi.cassette.zip';
}
