import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';

async function session(onMessage){
 const worker=new Worker(new URL('./fixtures/worker-host.mjs',import.meta.url));
 try{return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Live API Worker timeout')),3000);
  const finish=(error,result)=>{clearTimeout(timer);error?reject(error):resolve(result);};
  worker.on('error',finish);
  worker.on('message',message=>{
   try{if(message.type==='error')throw Error(message.text);onMessage(message,data=>worker.postMessage(data),result=>finish(null,result));}
   catch(error){finish(error);}
  });
 });}finally{await worker.terminate();}
}

test('livePrepare infers reusable values at runtime and Apply reuses the successful result',async()=>{
 const logs=[];let stage=0;
 await session((message,post,finish)=>{
  if(message.type==='ready')post({type:'run',bpm:120,code:`
   const result=await livePrepare('setup',({context})=>{context.count=(context.count??0)+1;return {count:context.count};});
   log(result.count);log(await pg.livePrepare('empty',()=>undefined));
  `});
  if(message.type==='log')logs.push(message.text);
  if(message.type==='done'){
   if(stage++===0)post({type:'update',code:`
    log((await pg.livePrepare('setup',()=>{throw Error('must stay cached');})).count);
    log(await livePrepare('empty',()=>{throw Error('undefined must stay cached');}));
   `});
   else finish();
  }
 });
 assert.deepEqual(logs,['1','','1','']);
});

test('fresh Worker Runs reset preparation and caught failures can be retried',async()=>{
 const all=[];
 for(let run=0;run<2;run++){
  await session((message,post,finish)=>{
   if(message.type==='ready')post({type:'run',bpm:120,code:`
    try{await livePrepare('retry',()=>{throw Error('retry me');});}catch{}
    const values=await Promise.all([livePrepare('retry',({context})=>{
     context.calls=(context.calls??0)+1;return context.calls;
    }),livePrepare('retry',()=>99)]);
    log(values);
   `});
   if(message.type==='log')all.push(message.text);
   if(message.type==='done')finish();
  });
 }
 assert.deepEqual(all,['[1,1]','[1,1]']);
});

test('Apply shares pending preparation, while the replaced loop cannot resume with its result',async()=>{
 let requestId,applied=false,requests=0;const logs=[];
 await session((message,post,finish)=>{
  if(message.type==='ready')post({type:'run',bpm:120,code:`
   liveLoop('lead',async()=>{
    const result=await livePrepare('shared',async({enableSoundChip})=>{
     await enableSoundChip('ym2612');return {tag:'original'};
    });
    log('stale',result.tag);stopLoop('lead');
   });
  `});
  if(message.type==='enable-chip'){requests++;requestId=message.id;}
  if(message.type==='looping'){
   if(!applied){applied=true;post({type:'update',code:`
    liveLoop('lead',async ctx=>{
     const result=await ctx.pg.livePrepare('shared',()=>{throw Error('duplicate pending');});
     log('new',result.tag);ctx.stopLoop('lead');
    });
   `});}
   else {assert.ok(requestId);post({type:'reply',id:requestId});}
  }
  if(message.type==='log'){logs.push(message.text);if(message.text==='new original')finish();}
 });
 assert.equal(requests,1);assert.deepEqual(logs,['new original']);
});

test('inline and explicit loop tweens cancel on Apply and stopLoop without a final callback',async()=>{
 const logs=[];let applied=false;
 await session((message,post,finish)=>{
  if(message.type==='ready')post({type:'run',bpm:120,code:`
   liveLoop('sweep',async()=>{
    await tween({seconds:1},n=>log('old',n));log('stale');
   });
  `});
  if(message.type==='looping'&&!applied){applied=true;post({type:'update',code:`
   liveLoop('sweep',async ctx=>{
    await ctx.pg.tween({beats:0},n=>log('new',n));ctx.stopLoop('sweep');
   });
   liveLoop('cancel',async()=>{
    await tween({seconds:1},n=>{log('cancel',n);stopLoop('cancel');});log('stale');
   });
   await beat(.08);log('finished');
  `});}
  if(message.type==='log'){logs.push(message.text);if(message.text==='finished')finish();}
 });
 assert.ok(logs.includes('old 0'));assert.ok(!logs.includes('old 1'));
 assert.ok(logs.includes('new 1'));assert.deepEqual(logs.filter(n=>n.startsWith('cancel')),['cancel 0']);
 assert.ok(!logs.includes('stale'));
});

test('Worker beat tween follows external Clock instead of the configured BPM',async()=>{
 let sequence=0;const values=[];
 await session((message,post,finish)=>{
  const clock=byte=>post({type:'clock',event:{runId:1,sequence:++sequence,byte,timestampMs:sequence*20}});
  if(message.type==='ready')post({type:'run',runId:1,externalClock:true,bpm:999,code:`
   await pg.tween({beats:.25},n=>log(n));
  `});
  if(message.type==='waiting-clock')clock(0xfa);
  if(message.type==='log'){
   values.push(Number(message.text));
   if(message.text==='0')setTimeout(()=>{assert.deepEqual(values,[0]);for(let n=0;n<6;n++)clock(0xf8);},40);
  }
  if(message.type==='done')finish();
 });
 assert.equal(values[0],0);assert.equal(values.at(-1),1);assert.equal(sequence,7);
});
