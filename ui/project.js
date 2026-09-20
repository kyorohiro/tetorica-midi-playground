import {canRun} from './guide.js';

export function ensureEntry(files, defaultCode) {
  return Object.hasOwn(files, '/index.js') ? {...files} : {...files, '/index.js': defaultCode};
}

export function runSource(files, path) {
  if (!canRun(path) || !Object.hasOwn(files, path)) throw new Error('Choose an existing JavaScript file in Run file.');
  return files[path];
}
