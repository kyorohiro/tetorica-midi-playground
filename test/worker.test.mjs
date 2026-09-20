import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
test('editor worker runs async MIDI code and reports completion',async()=>{
  const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
  try{await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Worker timeout')),3000);
    w.on('error',e=>{clearTimeout(timer);reject(e);});
    let notes=0;
    w.on('message',m=>{
      if(m.type==='ready')w.postMessage({type:'run',bpm:120,code:'await play("C4", {duration:0.002}); log("ok");'});
      if(m.type==='note'){notes++;assert.equal(m.payload.note,60);w.postMessage({type:'reply',id:m.id});}
      if(m.type==='error'){clearTimeout(timer);reject(new Error(m.text));}
      if(m.type==='done'){clearTimeout(timer);try{assert.equal(notes,1);resolve();}catch(e){reject(e);}}
    });
  });}finally{await w.terminate();}
});
test('default index lead runs repeatedly through MIDI worker',async()=>{
 const {leadExample}=await import('../ui/examples.js');
 const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Lead timeout')),3000);
  const fail=e=>{clearTimeout(timer);reject(e);};
  w.on('error',fail);
  let notes=0;
  w.on('message',m=>{
   try{
    if(m.type==='ready')w.postMessage({type:'run',bpm:120,code:leadExample});
    if(m.type==='error')throw new Error(m.text);
    if(m.type==='note'){
     assert.ok([64,67,69,71,74,76,79,81,83,86].includes(m.payload.note));
     assert.equal(m.payload.durationMs,40);
     w.postMessage({type:'reply',id:m.id});
     if(++notes===4){clearTimeout(timer);resolve();}
    }
   }catch(e){fail(e);}
  });
 });}finally{await w.terminate();}
});
async function runLoopScript(code){
 const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
 const logs=[],notes=[],releases=[];
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Loop timeout')),3000);
  const fail=e=>{clearTimeout(timer);reject(e);};
  w.on('error',fail);
  w.on('message',m=>{
   if(m.type==='ready')w.postMessage({type:'run',bpm:120,code});
   if(m.type==='note'){notes.push(m.payload);w.postMessage({type:'reply',id:m.id});}
   if(m.type==='log')logs.push(m.text);
   if(m.type==='release')releases.push(m.owner);
   if(m.type==='error')fail(new Error(m.text));
   if(m.type==='done'){clearTimeout(timer);resolve();}
  });
 });return {logs,notes,releases};}finally{await w.terminate();}
}
test('scoped loops keep cycle slots separate across awaits and cancel waiting notes',async()=>{
 const result=await runLoopScript(`
 let a=0,b=0;
 liveLoop('a',async({cycle,beat})=>{
   log('a',cycle([1,2])); await beat(0.004); log('a2',cycle([8,9]));
   if(++a===2)stopLoop('a');
 });
 liveLoop('b',async({cycle,beat})=>{
   log('b',cycle([1,2])); await beat(0.006);
   if(++b===2)stopLoop('b');
 });
 liveLoop('cancel',async({beat,play})=>{await beat(0.1);await play('C4');});
 await beat(0.04);stopLoop('cancel');await beat(0.16);
 stopAllLoops();
 `);
 assert.deepEqual(result.logs.filter(x=>x.startsWith('a ')),['a 1','a 2']);
 assert.deepEqual(result.logs.filter(x=>x.startsWith('a2 ')),['a2 8','a2 9']);
 assert.deepEqual(result.logs.filter(x=>x.startsWith('b ')),['b 1','b 2']);
 assert.equal(result.notes.length,0);
});
test('same-name replacement cancels old scoped callback and all loops stop',async()=>{
 const result=await runLoopScript(`
 liveLoop('x',async({beat,play})=>{await beat(0.1);await play('C4');});
 liveLoop('x',async({play})=>{await play('E4',{duration:0.002});stopLoop('x');});
 await beat(0.02);
 liveLoop('y',async({beat,play})=>{await beat(0.1);await play('G4');});
 stopAllLoops();await beat(0.2);
 `);
 assert.deepEqual(result.notes.map(x=>x.note),[64]);
});
test('music helpers are available in scripts and loop-local APIs',async()=>{
 const result=await runLoopScript(`
 log(lerp(0,10,0.5));
 if(rand()<0||rand()>=1)throw new Error('rand bounds');
 if(rrange(2,2)!==2)throw new Error('rrange');
 liveLoop('chords',async({play,chord,randInt})=>{
   for(const note of chord('E4','minor'))await play(note,{duration:0.002,velocity:randInt(90,90)});
   stopLoop('chords');
 });
 await beat(0.1);
 `);
 assert.deepEqual(result.notes.map(x=>x.note),[64,67,71]);
 assert.deepEqual(result.logs,['5']);
});

test('stopping scoped loop requests release of the same generation that sent notes',async()=>{
 const result=await runLoopScript(`
 liveLoop('held',async({play})=>{await play('C4',{duration:10});});
 await beat(0.02);stopLoop('held');await beat(0.02);
 `);
 assert.equal(result.notes.length,1);
 assert.ok(Number.isInteger(result.notes[0].owner));
 assert.deepEqual(result.releases,[result.notes[0].owner]);
});

test('noteLerp is playable through scoped worker helpers',async()=>{
 const result=await runLoopScript(`
 liveLoop('interpolation',async({play,noteLerp})=>{
   await play(noteLerp('E4','E5',0.5),{duration:0.002});
   stopLoop('interpolation');
 });
 await beat(0.1);
 `);
 assert.deepEqual(result.notes.map(x=>x.note),[70]);
});
test('keyboard callbacks execute in worker and send MIDI',async()=>{
 const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Keyboard timeout')),3000);
  const fail=e=>{clearTimeout(timer);reject(e);};
  w.on('error',fail);
  let played=false;
  w.on('message',m=>{
   try{
    if(m.type==='ready')w.postMessage({type:'run',bpm:120,code:`
      onKeyboardPressKey('notes',async e=>{if(e.code==='KeyA')await play('C4',{duration:0.002});});
      onKeyboardReleaseKey('notes',e=>log('released',e.code));
    `});
    if(m.type==='listening')w.postMessage({type:'keyboard',event:{type:'keydown',code:'KeyA',key:'a'}});
    if(m.type==='note'){
     assert.equal(m.payload.note,60);played=true;
     w.postMessage({type:'reply',id:m.id});
     w.postMessage({type:'keyboard',event:{type:'keyup',code:'KeyA',key:'a'}});
    }
    if(m.type==='error')throw new Error(m.text);
    if(m.type==='log'){assert.equal(m.text,'released KeyA');assert.ok(played);clearTimeout(timer);resolve();}
   }catch(e){fail(e);}
  });
 });}finally{await w.terminate();}
});
test('implicit loop callbacks isolate cycles and own notes across await',async()=>{
 const result=await runLoopScript(`
 let a=0,b=0;
 liveLoop('a',async()=>{log('a',cycle([1,2]));await beat(.002);await play(60,{duration:.002});if(++a===2)stopLoop('a');});
 liveLoop('b',async()=>{log('b',cycle([1,2]));await beat(.003);await play(64,{duration:.002});if(++b===2)stopLoop('b');});
 await beat(.1);
 `);
 assert.deepEqual(result.logs.filter(s=>s.startsWith('a')),['a 1','a 2']);
 assert.deepEqual(result.logs.filter(s=>s.startsWith('b')),['b 1','b 2']);
 assert.ok(result.notes.every(n=>n.owner));
 assert.equal(new Set(result.notes.map(n=>n.owner)).size,2);
});
test('Apply replaces a named loop while keeping the same worker alive',async()=>{
 const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Apply timeout')),3000);let owner,applied=false,released=false;
  const fail=e=>{clearTimeout(timer);reject(e);};w.on('error',fail);
  w.on('message',m=>{try{
   if(m.type==='ready')w.postMessage({type:'run',bpm:120,code:`liveLoop('a',async()=>{await play(60,{duration:.01});});`});
   if(m.type==='error')throw new Error(m.text);
   if(m.type==='note'){
    w.postMessage({type:'reply',id:m.id});
    if(m.payload.note===60){owner=m.payload.owner;}
    else {assert.equal(m.payload.note,64);assert.notEqual(m.payload.owner,owner);assert.ok(released);clearTimeout(timer);resolve();}
   }
   if(m.type==='release'&&m.owner===owner)released=true;
   if(m.type==='looping'&&!applied){applied=true;w.postMessage({type:'update',code:`liveLoop('a',async()=>{await play(64,{duration:.01});});`});}
  }catch(e){fail(e);}});
 });}finally{await w.terminate();}
});
test('external play sends beat duration and waits for Clock pulses',async()=>{
 const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('External play timeout')),3000);let sequence=0,noteSeen=false;
  const fail=e=>{clearTimeout(timer);reject(e);};w.on('error',fail);
  const clock=byte=>w.postMessage({type:'clock',event:{runId:1,sequence:++sequence,byte,timestampMs:sequence*20}});
  w.on('message',m=>{try{
   if(m.type==='ready')w.postMessage({type:'run',runId:1,externalClock:true,bpm:1,code:`await play(60,{duration:.5});`});
   if(m.type==='waiting-clock')clock(0xfa);
   if(m.type==='error')throw new Error(m.text);
   if(m.type==='note'){
    noteSeen=true;assert.equal(m.payload.durationBeats,.5);w.postMessage({type:'reply',id:m.id});
    // Let the acknowledgement establish the wait before advancing the input.
    setTimeout(()=>{for(let i=0;i<12;i++)clock(0xf8);},20);
   }
   if(m.type==='done'){assert.ok(noteSeen);clearTimeout(timer);resolve();}
  }catch(e){fail(e);}});
 });}finally{await w.terminate();}
});
test('Apply preserves other loops and cancels the replaced callback after its await',async()=>{
 const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Apply continuity timeout')),3000);
  let ready=false,applied=false,backgroundCount=0,backgroundOwner,oldOwner,released=false,newSeen=false;
  const fail=e=>{clearTimeout(timer);reject(e);};w.on('error',fail);
  const apply=()=>{if(ready&&backgroundCount>=2&&!applied){applied=true;w.postMessage({type:'update',code:`liveLoop('lead',async()=>{await play(67,{duration:.01});});`});}};
  w.on('message',m=>{try{
   if(m.type==='ready')w.postMessage({type:'run',bpm:120,code:`
    liveLoop('lead',async()=>{await play(60,{duration:1});await play(61,{duration:.01});});
    liveLoop('background',async()=>{await play(cycle([72,74,76]),{duration:.01});});
   `});
   if(m.type==='error')throw new Error(m.text);
   if(m.type==='looping'){ready=true;apply();}
   if(m.type==='release'&&m.owner===oldOwner)released=true;
   if(m.type==='note'){
    w.postMessage({type:'reply',id:m.id});
    const {note,owner}=m.payload;
    if(note===60){assert.ok(!released);oldOwner=owner;}
    else if(note===61)assert.fail('replaced callback resumed after await');
    else if(note===67){assert.ok(released);assert.notEqual(owner,oldOwner);newSeen=true;}
    else {
     assert.equal(note,[72,74,76][backgroundCount%3]);
     if(backgroundOwner===undefined)backgroundOwner=owner;else assert.equal(owner,backgroundOwner);
     backgroundCount++;apply();
     if(newSeen&&backgroundCount>=105){clearTimeout(timer);resolve();}
    }
   }
  }catch(e){fail(e);}});
 });}finally{await w.terminate();}
});

test('outer output handles preserve parallel loop ownership across await',async()=>{
 const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
 const notes=[],released=[];
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('routing timeout')),3000);
  const code=`
   await enableSoundChip('ym2612');
   await enableSoundChip('sega-psg');
   const fm=midi.output('tetorica-ym2612',{channel:2});
   const psg=midi.output('tetorica-sega-psg',{channel:3});
   liveLoop('fm',async()=>{await beat(0.004);await fm.play('C4',{duration:0.002});await beat(10);});
   liveLoop('psg',async()=>{await beat(0.002);await psg.play('E4',{duration:0.002});await beat(10);});
   await beat(0.05);stopAllLoops();
  `;
  w.on('error',reject);w.on('message',m=>{
   if(m.type==='ready')w.postMessage({type:'run',bpm:120,code});
   if(m.type==='enable-chip')w.postMessage({type:'reply',id:m.id});
   if(m.type==='output')w.postMessage({type:'reply',id:m.id,value:m.payload.name==='tetorica-ym2612'?1:2});
   if(m.type==='note'){notes.push(m.payload);w.postMessage({type:'reply',id:m.id});}
   if(m.type==='release')released.push(m.owner);
   if(m.type==='error'){clearTimeout(timer);reject(Error(m.text));}
   if(m.type==='done'){clearTimeout(timer);resolve();}
  });
 });
 assert.deepEqual(notes.map(n=>[n.route,n.channel,n.owner]).sort(),[[1,2,1],[2,3,2]]);
 assert.deepEqual(released,[1,2]);
 }finally{await w.terminate();}
});

for(const exampleName of ['01_multi_output.js','02_assigned_outputs.js']) test(`bundled ${exampleName} runs without assignments and sends three independent parts`,async()=>{
 const {bundledExamples}=await import('../ui/example-files.js');
 const {readFile}=await import('node:fs/promises');
 const example=bundledExamples['/examples/'+exampleName];
 assert.equal(example,await readFile(new URL('../ui/examples/'+exampleName,import.meta.url),'utf8'));
 const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));const notes=[],chips=[];
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('example timeout')),3000);
  w.on('error',reject);w.on('message',m=>{
   if(m.type==='ready')w.postMessage({type:'run',bpm:120,code:example+'\nawait beat(0.1);stopAllLoops();'});
   if(m.type==='enable-chip'){chips.push(m.payload.chip);w.postMessage({type:'reply',id:m.id});}
   if(m.type==='output')w.postMessage({type:'reply',id:m.id,value:m.payload.name==='tetorica-ym2612'?1:2});
   if(m.type==='note'){notes.push(m.payload);w.postMessage({type:'reply',id:m.id});}
   if(m.type==='error'){clearTimeout(timer);reject(Error(m.text));}
   if(m.type==='done'){clearTimeout(timer);resolve();}
  });
 });
 assert.deepEqual(chips,['ym2612','sega-psg']);
 assert.deepEqual(notes.map(n=>[n.route,n.channel,n.owner]).sort(),[[1,1,1],[1,2,2],[2,1,3]]);
 }finally{await w.terminate();}
});

test('worker exposes logical output identifiers and sends selected port identity',async()=>{
 const w=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));const outputs=[],notes=[];
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('slot timeout')),3000);
  w.on('error',reject);w.on('message',m=>{
   if(m.type==='ready')w.postMessage({type:'run',bpm:120,outputMappings:{MIDI_OUTPUT_01:{kind:'port',id:'saved-id',name:'Piano'}},code:`const p=midi.output(MIDI_OUTPUT_01,{channel:4}); await p.play('C4',{duration:0.002});`});
   if(m.type==='output'){outputs.push(m.payload);w.postMessage({type:'reply',id:m.id,value:3});}
   if(m.type==='note'){notes.push(m.payload);w.postMessage({type:'reply',id:m.id});}
   if(m.type==='error'){clearTimeout(timer);reject(Error(m.text));}
   if(m.type==='done'){clearTimeout(timer);resolve();}
  });
 });assert.deepEqual(outputs,[{name:'Piano',portId:'saved-id'}]);assert.equal(notes[0].route,3);assert.equal(notes[0].channel,4);
 }finally{await w.terminate();}
});
