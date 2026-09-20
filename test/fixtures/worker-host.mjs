import {parentPort} from 'node:worker_threads';
globalThis.onmessage=null;
globalThis.postMessage=data=>parentPort.postMessage(data);
await import('../../ui/runner.js');
parentPort.on('message',data=>globalThis.onmessage({data}));
parentPort.postMessage({type:'ready'});
