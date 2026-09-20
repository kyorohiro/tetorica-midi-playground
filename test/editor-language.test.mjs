import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {apiTypes} from '../ui/api-types.js';
// Use Monaco's actual bundled language service; replace only its browser worker transport.
const source=await readFile(new URL('../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js',import.meta.url),'utf8');
const previous=globalThis.self;globalThis.self={};
const dir=await mkdtemp(join(tmpdir(),'tetorica-monaco-'));
let TypeScriptWorker,ts;
try {
 const file=join(dir,'service.mjs');
 await writeFile(file,source.replace('import { initialize } from "../../editor/editor.worker.js";','const process=undefined; const initialize=()=>{};'));
 ({TypeScriptWorker,ts}=await import(pathToFileURL(file).href));
} finally {globalThis.self=previous;await rm(dir,{recursive:true,force:true});}
function language(code,others={}) {
 const files={'file:///index.js':code,...others};
 const models=Object.entries(files).map(([uri,text])=>({uri:{path:new URL(uri).pathname,toString:()=>uri},version:1,getValue:()=>text}));
 return new TypeScriptWorker({getMirrorModels:()=>models},{compilerOptions:{allowJs:true,allowNonTsExtensions:true,checkJs:true,lib:['es2022'],target:ts.ScriptTarget.ES2022,module:ts.typescript.ModuleKind.ESNext},extraLibs:{'file:///tetorica-api.d.ts':{content:apiTypes,version:1}}});
}
async function completions(code){
 const pos=code.indexOf('/*here*/');const worker=language(code.replace('/*here*/',''));
 const result=await worker.getCompletionsAtPosition('file:///index.js',pos);
 return result?.entries.map(e=>e.name)??[];
}
test('Monaco infers output handles, loop context, options and literal chip IDs',async()=>{
 assert.ok((await completions('const piano=midi.output("tetorica-ym2612"); piano./*here*/')).includes('play'));
 const ctx=await completions('liveLoop("a",async context=>{context./*here*/});');
 for(const name of ['play','playOutput','beat','cycle','midi'])assert.ok(ctx.includes(name),name);
 const options=await completions('const p=midi.output("x");p.play("C4",{/*here*/});');
 assert.ok(options.includes('duration'));assert.ok(options.includes('velocity'));assert.ok(!options.includes('channel'));
 const destinations=await completions('midi.output("/*here*/");');assert.ok(destinations.includes('tetorica-ym2612'));assert.ok(destinations.includes('tetorica-sega-psg'));
 const chips=await completions('enableSoundChip("/*here*/");');assert.ok(chips.includes('ym2612'));assert.ok(chips.includes('sega-psg'));
 const globals=await completions('/*here*/');assert.ok(globals.includes('MIDI_OUTPUT_01'));assert.ok(!globals.includes('screenLeft'));assert.ok(!globals.includes('document'));assert.ok(!globals.includes('context'));
});
test('JSDoc types and hover come from the shipped API declarations',async()=>{
 const code='/** @param {MidiOutput} instrument */\nfunction melody(instrument){instrument./*here*/}';
 assert.ok((await completions(code)).includes('play'));
 const text='const p=midi.output("x");p.play("C4");';const worker=language(text);
 const hover=await worker.getQuickInfoAtPosition('file:///index.js',text.indexOf('play')+1);
 assert.match(hover.documentation.map(p=>p.text).join(''),/duration/);
 assert.deepEqual(await worker.getSemanticDiagnostics('file:///tetorica-api.d.ts'),[]);
 assert.equal(apiTypes,await readFile(new URL('../ui/playground-api.d.ts',import.meta.url),'utf8'));
});
test('relative imports preserve JSDoc typedef, parameters and return types',async()=>{
 const code='import {makeVoice} from "./lib/voice.js"; const voice=makeVoice();voice.';
 const worker=language(code,{'file:///lib/voice.js':`
 /** @typedef {{output: MidiOutput, velocity: number}} Voice */
 /** @returns {Voice} */
 export function makeVoice(){return {output:midi.output('tetorica-ym2612'),velocity:90};}
 `});
 const result=await worker.getCompletionsAtPosition('file:///index.js',code.length);
 assert.ok(result.entries.some(e=>e.name==='output'));
 assert.ok(result.entries.some(e=>e.name==='velocity'));
});
test('bundled library exposes JSDoc options through dynamic relative imports',async()=>{
 const module=await readFile(new URL('../ui/lib/phrase.js',import.meta.url),'utf8');
 const code='const {playPhrase}=await import("./lib/phrase.js"); liveLoop("a",async context=>{await playPhrase(context,midi.output("tetorica-ym2612"),["C4"],{';
 const worker=language(code,{'file:///lib/phrase.js':module});
 const result=await worker.getCompletionsAtPosition('file:///index.js',code.length);
 for(const name of ['duration','velocity'])assert.ok(result.entries.some(e=>e.name===name),name);
});
