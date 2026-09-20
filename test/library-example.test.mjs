import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareModules} from '../ui/modules.js';
import {bundledExamples} from '../ui/example-files.js';
import {mergeExamples} from '../ui/example-migrations.js';
import {withGuide,canRun,isGuide} from '../ui/guide.js';

// Execute the same module resolver; Node uses data URLs instead of WebView blob URLs.
const dataUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
test('library example resolves from FILES, passes its destination and awaits the phrase',async()=>{
 for(const path of ['/lib/phrase.js','/examples/09_library.js']) {
  assert.equal(bundledExamples[path],await readFile(new URL('../ui'+path,import.meta.url),'utf8'));
 }
 const path='/examples/09_library.js';
 const prepared=await prepareModules(bundledExamples,bundledExamples[path],path,dataUrl);
 let callback;const output={},enabled=[],destinations=[];
 try {
  const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
  await new AsyncFunction('enableSoundChip','midi','liveLoop',prepared.code)(
   async chip=>enabled.push(chip),
   {output:(name,options)=>{destinations.push([name,options]);return output;}},
   (name,fn)=>{assert.equal(name,'library-phrase');callback=fn;},
  );
  const events=[];
  await callback({playOutput:async(o,n,opts)=>{assert.equal(o,output);events.push([n,opts.duration,opts.velocity]);},beat:async n=>events.push(['gap',n])});
  assert.deepEqual(enabled,['ym2612']);
  assert.deepEqual(destinations,[['tetorica-ym2612',{channel:1}]]);
  assert.deepEqual(events,[['C4',0.5,90],['E4',0.5,90],['G4',0.5,90],['gap',1]]);
  // A stopped loop's scoped helper rejects: the imported function must not swallow it.
  let calls=0;
  const cancelled=Symbol('cancelled');
  await assert.rejects(callback({playOutput:async()=>{if(++calls===2)throw cancelled;},beat:()=>assert.fail('continued after cancellation')}),e=>e===cancelled);
  assert.equal(calls,2);
 }finally{prepared.dispose();}
});
test('library guide is non-executable and updating bundles preserves edited modules',()=>{
 const saved={'/lib/phrase.js':'// my custom helper','/examples/09_library.js':'// my example'};
 const files=withGuide(mergeExamples(saved,bundledExamples));
 for(const path of Object.keys(saved))assert.equal(files[path],saved[path]);
 assert.equal(isGuide('/lib/README.md'),true);
 assert.equal(canRun('/lib/README.md'),false);
 assert.equal(isGuide('/lib/phrase.js'),false);
});
