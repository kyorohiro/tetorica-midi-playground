import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKeyboardHandlers,keyData} from '../ui/keyboard.js';
test('keyboard handlers replace by name and separate press/release',async()=>{
 const seen=[],errors=[];
 const api=createKeyboardHandlers(e=>errors.push(e));
 api.onKeyboardPressKey('notes',()=>seen.push('old'));
 api.onKeyboardPressKey('notes',e=>seen.push(e.code));
 api.onKeyboardReleaseKey('notes',()=>seen.push('released'));
 await api.dispatch({type:'keydown',code:'KeyA'});
 await api.dispatch({type:'keydown',code:'KeyA',repeat:true});
 await api.dispatch({type:'keyup',code:'KeyA'});
 assert.deepEqual(seen,['KeyA','released']);assert.equal(api.size,2);
 assert.throws(()=>api.onKeyboardPressKey('',()=>{}));
 api.onKeyboardPressKey('error',()=>{throw new Error('callback');});
 await api.dispatch({type:'keydown'});assert.equal(errors.length,1);
});
test('busy callbacks do not accumulate events and new registries start empty',async()=>{
 let finish,count=0;const api=createKeyboardHandlers(()=>{});
 api.onKeyboardPressKey('slow',async()=>{count++;await new Promise(resolve=>finish=resolve);});
 const first=api.dispatch({type:'keydown'});
 await api.dispatch({type:'keydown'});assert.equal(count,1);finish();await first;
 assert.equal(createKeyboardHandlers(()=>{}).size,0);
 assert.deepEqual(keyData({type:'keydown',key:'a',code:'KeyA'}),{type:'keydown',key:'a',code:'KeyA',repeat:false,shiftKey:false,ctrlKey:false,altKey:false,metaKey:false});
});
