import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExternalClock} from '../ui/external-clock.js';
test('external transport counts 24 pulses per beat and distinguishes Start and Continue',()=>{
 const clock=createExternalClock();
 assert.equal(clock.receive(0xf8,0).pulses,0);
 clock.receive(0xfa,1);
 for(let i=1;i<=24;i++)clock.receive(0xf8,1+i*20);
 assert.equal(clock.snapshot(481).beat,1);
 clock.receive(0xfc,482);assert.equal(clock.receive(0xf8,483).beat,1);
 clock.receive(0xfb,484);assert.equal(clock.receive(0xf8,500).pulses,25);
 assert.equal(clock.receive(0xfa,501).pulses,0);
});
test('timeout freezes transport; stray clocks cannot silently resume it',()=>{
 const clock=createExternalClock({timeoutMs:100});
 clock.receive(0xfa,0);clock.receive(0xf8,20);
 assert.equal(clock.snapshot(119).running,true);
 assert.equal(clock.snapshot(120).reason,'timeout');
 assert.equal(clock.receive(0xf8,121).pulses,1);
 clock.receive(0xfb,122);assert.equal(clock.receive(0xf8,140).pulses,2);
 assert.equal(clock.disconnect(141).reason,'disconnected');
 assert.equal(clock.receive(0xf8,142).pulses,2);
});
test('tempo changes affect pulse spacing without changing musical position',()=>{
 const clock=createExternalClock();clock.receive(0xfa,0);
 for(let i=1;i<=12;i++)clock.receive(0xf8,i*20);
 for(let i=1;i<=12;i++)clock.receive(0xf8,240+i*40);
 assert.equal(clock.snapshot(720).beat,1);
 assert.throws(()=>clock.receive(0xf8,719),/monotonic/);
 assert.throws(()=>clock.snapshot(NaN),/monotonic/);
 assert.throws(()=>clock.receive(0x90,721),/Unsupported/);
 assert.throws(()=>createExternalClock({timeoutMs:0}));
});
