import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareModules} from '../ui/modules.js';
const dataUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
test('relative modules, reexports and dynamic imports execute and are cached',async()=>{
 const files={'/parts/notes.js':'export const notes=[60,64,67];','/parts/index.js':'export {notes} from "./notes.js";'};
 let count=0;
 const result=await prepareModules(files,'const a=await import("./parts/index.js"); const b=await import("./parts/index.js"); return [a.notes,a===b];','/index.js',code=>{count++;return dataUrl(code);});
 const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 assert.deepEqual(await new AsyncFunction(result.code)(),[[60,64,67],true]);assert.equal(count,2);
});
test('import-like strings and comments are not rewritten',async()=>{
 const source='// import("./absent.js")\nreturn `import("./also-absent.js")`;';
 const result=await prepareModules({},source,'/index.js',dataUrl);assert.equal(result.code,source);
});
test('unsupported and missing imports fail explicitly',async()=>{
 for(const code of ['await import("https://example.com/a.js")','await import(name)','import x from "./a.js"','await import("../../a.js")','await import("./missing.js")','return import.meta.url'])await assert.rejects(prepareModules({},code,'/index.js',dataUrl));
 await assert.rejects(prepareModules({'/a.js':'export const x=import("./a.js");'},'await import("./a.js")','/index.js',dataUrl),/Circular/);
});
