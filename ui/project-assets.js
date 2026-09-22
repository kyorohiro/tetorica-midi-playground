// JSON-safe binary values survive localStorage, Worker cloning and project snapshots.
export function isBinaryFile(value){return !!value&&typeof value==='object'&&value.type==='binary'&&Array.isArray(value.bytes)&&value.bytes.every(n=>Number.isInteger(n)&&n>=0&&n<=255);}
export function binaryFile(bytes){return {type:'binary',bytes:Array.from(bytes)};}
export function fileBytes(value){if(isBinaryFile(value))return Uint8Array.from(value.bytes);if(typeof value==='string')return new TextEncoder().encode(value);throw Error('Invalid project file');}
export function filePreview(value){return isBinaryFile(value)?`Binary voice file · ${value.bytes.length} bytes\n\n${value.bytes.map(n=>n.toString(16).padStart(2,'0')).join(' ')}`:value;}
export function readVoiceFile(files,path,from='/index.js'){
  if(typeof path!=='string'||!path)throw Error('Expected a project voice path');
  if(!path.startsWith('/')&&!path.startsWith('./')&&!path.startsWith('../'))throw Error('Use a relative or absolute project voice path');
  const parts=path.startsWith('/')?[]:from.split('/').filter(Boolean).slice(0,-1);
  for(const part of path.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)throw Error('Voice path escapes FILES root');parts.pop();}else parts.push(part);}
  const resolved='/'+parts.join('/');
  if(!Object.hasOwn(files,resolved)||!isBinaryFile(files[resolved]))throw Error('Binary voice file not found: '+resolved);
  const format=resolved.split('.').pop().toLowerCase();
  if(!['tfi','vgi'].includes(format))throw Error('Voice file must be .tfi or .vgi');
  return {data:fileBytes(files[resolved]),format};
}
