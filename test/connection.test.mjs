import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionStatus} from '../ui/connection.js';
test('connection indicator uses native connection state and actual connected name',()=>{
 assert.equal(connectionStatus(null).state,'unknown');
 assert.equal(connectionStatus({output_connected:false,output_name:'Old port'}).state,'disconnected');
 assert.deepEqual(connectionStatus({output_connected:true,output_name:'IAC Bus 1'}),{state:'connected',text:'MIDI: Connected — IAC Bus 1'});
});

test('internal output choices exist while disabled and do not duplicate enabled native ports',async()=>{
 const {midiOutputChoices}=await import('../ui/connection.js');
 const disabled=midiOutputChoices([]);
 assert.deepEqual(disabled.map(p=>p.id),['internal:ym2612','internal:sega-psg']);
 assert.ok(disabled.every(p=>p.name.includes('auto-enable')));
 const external={id:'external-id',name:'Piano'};
 const enabled=midiOutputChoices([{id:'native-fm',name:'Tetorica YM2612'},{id:'native-psg',name:'Tetorica Sega PSG'},external]);
 assert.deepEqual(enabled,[...disabled,external]);
});
