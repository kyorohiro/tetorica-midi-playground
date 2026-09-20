import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionStatus} from '../ui/connection.js';
test('connection indicator uses native connection state and actual connected name',()=>{
 assert.equal(connectionStatus(null).state,'unknown');
 assert.equal(connectionStatus({output_connected:false,output_name:'Old port'}).state,'disconnected');
 assert.deepEqual(connectionStatus({output_connected:true,output_name:'IAC Bus 1'}),{state:'connected',text:'MIDI: Connected — IAC Bus 1'});
});
