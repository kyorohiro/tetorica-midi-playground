import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {apiTypes} from '../ui/api-types.js';
import {configureJavaScript} from '../ui/editor.js';
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
// Exercise the app's configuration, not a stronger set of test-only options.
let compilerOptions={allowNonTsExtensions:true,allowJs:true,target:99},diagnosticOptions;
const extraLibs={};
configureJavaScript({languages:{typescript:{
 ScriptTarget:ts.ScriptTarget,
 ModuleKind:ts.typescript.ModuleKind,
 ModuleResolutionKind:ts.typescript.ModuleResolutionKind,
 javascriptDefaults:{
  getCompilerOptions:()=>compilerOptions,
  setCompilerOptions:value=>{compilerOptions=value;},
  setDiagnosticsOptions:value=>{diagnosticOptions=value;},
  setEagerModelSync:value=>assert.equal(value,true),
  addExtraLib:(content,path)=>{extraLibs[path]={content,version:1};},
 },
}}});
function language(code,others={}) {
 const files={'file:///index.js':code,...others};
 const models=Object.entries(files).map(([uri,text])=>({uri:{path:new URL(uri).pathname,toString:()=>uri},version:1,getValue:()=>text}));
 return new TypeScriptWorker({getMirrorModels:()=>models},{compilerOptions,extraLibs});
}
async function diagnostics(worker,path='file:///index.js') {
 const ignored=diagnosticOptions.diagnosticCodesToIgnore??[];
 const result=[];
 if(!diagnosticOptions.noSyntaxValidation)result.push(...await worker.getSyntacticDiagnostics(path));
 if(!diagnosticOptions.noSemanticValidation)result.push(...await worker.getSemanticDiagnostics(path));
 return result.filter(item=>!ignored.includes(item.code));
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
 const globals=await completions('/*here*/');assert.ok(globals.includes('MIDI_OUTPUT_01'));assert.ok(!globals.includes('screenLeft'));assert.ok(!globals.includes('document'));assert.ok(globals.includes('context'));assert.ok(globals.includes('pg'));
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
 const code='const {makeVoice}=await import("./lib/voice.js"); const voice=makeVoice(midi.output("tetorica-ym2612"));voice.';
 const worker=language(code,{'file:///lib/voice.js':`
 /** @typedef {{output: MidiOutput, velocity: number}} Voice */
 /** @param {MidiOutput} output\n * @returns {Voice} */
 export function makeVoice(output){return {output,velocity:90};}
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
 const complete='const {playPhrase}=await import("./lib/phrase.js"); liveLoop("a",async ctx=>{await playPhrase(ctx,midi.output("tetorica-ym2612"),["C4"],{duration:0.5});});';
 const checked=language(complete,{'file:///lib/phrase.js':module});
 assert.deepEqual(await diagnostics(checked),[]);
 const hover=await checked.getQuickInfoAtPosition('file:///index.js',complete.lastIndexOf('playPhrase')+1);
 assert.match(hover.displayParts.map(part=>part.text).join(''),/options\?: MidiPlayOptions/);
 assert.match(hover.documentation.map(part=>part.text).join(''),/loop timing and cancellation/);
 const signature=await checked.getSignatureHelpItems('file:///index.js',complete.indexOf('{duration:')+1,{});
 assert.equal(signature.argumentIndex,3);
 assert.match(signature.items[0].parameters[3].displayParts.map(part=>part.text).join(''),/options\?: MidiPlayOptions/);
});

test('app configuration reports real type and syntax errors while accepting Run await and return',async()=>{
 assert.equal(diagnosticOptions.noSyntaxValidation,false);
 assert.equal(diagnosticOptions.noSemanticValidation,false);
 assert.equal(compilerOptions.checkJs,true);
 assert.deepEqual(await diagnostics(language('await play("C4", {duration:0.5});\nreturn;')),[]);
 const typeErrors=await diagnostics(language('await play("C4", {velocity:"loud"});\npg.noSuchMethod();'));
 assert.ok(typeErrors.some(item=>item.code===2322),JSON.stringify(typeErrors));
 assert.ok(typeErrors.some(item=>item.code===2339),JSON.stringify(typeErrors));
 const syntaxErrors=await diagnostics(language('const broken = ;'));
 assert.ok(syntaxErrors.some(item=>item.code===1109),JSON.stringify(syntaxErrors));
});

test('unrelated Run files cannot leak variables or competing JSDoc state into completion',async()=>{
 const code='/** @typedef {{instrument: MidiOutput}} LocalState */\n/** @type {LocalState} */\nconst state={instrument:midi.output("tetorica-ym2612")};\nstate.';
 const worker=language(code,{'file:///examples/other.js':'/** @typedef {{unexpected: boolean}} LocalState */\nconst state={unexpected:true};\nconst leakedHelper=123;'});
 const stateMembers=await worker.getCompletionsAtPosition('file:///index.js',code.length);
 assert.ok(stateMembers.entries.some(item=>item.name==='instrument'));
 assert.ok(!stateMembers.entries.some(item=>item.name==='unexpected'));
 const globalCode='const instrument=midi.output("tetorica-ym2612");\n';
 const globals=await language(globalCode,{'file:///examples/other.js':'const instrument={rogue:true};const leakedHelper=123;'}).getCompletionsAtPosition('file:///index.js',globalCode.length);
 assert.ok(!globals.entries.some(item=>item.name==='leakedHelper'));
 assert.deepEqual(await diagnostics(language('const instrument=midi.output("tetorica-ym2612");instrument.play("C4");',{'file:///examples/other.js':'const instrument={rogue:true};'})),[]);
});

test('bundled examples and library pass the app language diagnostics together',async()=>{
 const files={};
 for(const directory of ['examples','lib'])for(const name of await readdir(new URL(`../ui/${directory}/`,import.meta.url))){
  if(/\.m?js$/i.test(name))files[`file:///${directory}/${name}`]=await readFile(new URL(`../ui/${directory}/${name}`,import.meta.url),'utf8');
 }
 const worker=language('',files);
 for(const path of Object.keys(files))assert.deepEqual(await diagnostics(worker,path),[],path);
});

test('pg namespace exposes MIDI APIs, shared state and typed loop helpers',async()=>{
 const members=await completions('pg./*here*/');
 for(const name of ['context','liveLoop','play','beat','midi','enableSoundChip','MIDI_OUTPUT_01'])assert.ok(members.includes(name),name);
 assert.ok((await completions('pg.midi./*here*/')).includes('output'));
 assert.ok((await completions('pg.midi.output("x")./*here*/')).includes('play'));
 assert.ok((await completions('pg.play("C4",{/*here*/});')).includes('duration'));
 const scoped=await completions('pg.liveLoop("a",async ctx=>{ctx.pg./*here*/});');
 for(const name of ['play','beat','cycle','context'])assert.ok(scoped.includes(name),name);
});

test('shared context initialization sample exposes its JSDoc state and output type',async()=>{
 const sample=await readFile(new URL('../ui/examples/10_context_init.js',import.meta.url),'utf8');
 const state=await completions(sample+'\nstate./*here*/');
 for(const name of ['instrument','hitCount'])assert.ok(state.includes(name),name);
 assert.ok((await completions(sample+'\nstate.instrument./*here*/')).includes('play'));
 const options=await completions(sample+'\nstate.instrument.play("C4",{/*here*/});');
 for(const name of ['duration','velocity'])assert.ok(options.includes(name),name);
});

test('low-level MIDI APIs complete as globals, pg members and loop helpers',async()=>{
 const names=['noteOn','noteOff','cc','programChange','pitchBend','channelPressure','polyPressure','send'];
 for(const code of ['/*here*/','pg./*here*/','liveLoop("x",async ctx=>{ctx./*here*/});']){
  const items=await completions(code);for(const name of names)assert.ok(items.includes(name),name);
 }
 const options=await completions('noteOff("C4",{/*here*/});');
 assert.ok(options.includes('velocity'));assert.ok(options.includes('channel'));
});

test('YM2612 voice methods and preset fields complete on MIDI handles',async()=>{
 const members=await completions('const lead=midi.output("tetorica-ym2612",{});lead./*here*/');
 for(const key of ['setVoice','loadVoice','play'])assert.ok(members.includes(key));
 const fields=await completions('const lead=midi.output("tetorica-ym2612");lead.setVoice({/*here*/});');
 for(const key of ['algorithm','feedback','operators','pan','ams','pms'])assert.ok(fields.includes(key),key);
});

test('sound chip allocation types follow the YM2612-only runtime contract',async()=>{
 const accepted=`
 await enableSoundChip('ym2612', {roundRobin:false});
 await midi.enableSoundChip('tetorica-ym2612', {roundRobin:true});
 await pg.enableSoundChip('sega-psg');
 await enableSoundChip('tetorica-sega-psg', {});
 /** @type {SoundChipId} */ const chip=choose(['ym2612','sega-psg']);
 await enableSoundChip(chip);
 `;
 assert.deepEqual(await diagnostics(language(accepted)),[]);
 for(const code of [
  `enableSoundChip('sega-psg', {roundRobin:false});`,
  `pg.enableSoundChip('tetorica-sega-psg', {roundRobin:true});`,
 ])assert.ok((await diagnostics(language(code))).length,code);
 const chips=await completions('enableSoundChip("/*here*/");');
 for(const id of ['ym2612','tetorica-ym2612','sega-psg','tetorica-sega-psg'])assert.ok(chips.includes(id),id);
});

test('operator property hover includes verified register ranges and defaults',async()=>{
 const code='midi.output("tetorica-ym2612").setVoice({operators:[{multi:1,tl:20}]});';
 const worker=language(code);
 for(const [name,range] of [['multi','0–15'],['tl','0–127']]){
  const hover=await worker.getQuickInfoAtPosition('file:///index.js',code.indexOf(name+':')+1);
  const docs=hover.documentation.map(part=>part.text).join('');
  assert.ok(docs.includes(range),docs);
  assert.match(docs,/default/);
 }
});
