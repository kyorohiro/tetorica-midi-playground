// Transport state for MIDI Clock (24 pulses per quarter note).
// Caller supplies monotonic milliseconds in one clock domain, never wall time.
export function createExternalClock({timeoutMs=1000}={}) {
  if (!Number.isFinite(timeoutMs)||timeoutMs<=0) throw new Error('Invalid Clock timeout');
  let running=false,pulses=0,lastPulse=null,lastEvent=null,reason='stopped';
  function checkTime(time) {
    if (!Number.isFinite(time)||time<0||(lastEvent!==null&&time<lastEvent)) throw new Error('Clock timestamps must be monotonic');
  }
  function expire(time) {
    if(running&&lastPulse!==null&&time-lastPulse>=timeoutMs){running=false;reason='timeout';}
  }
  function snapshot(time) {
    checkTime(time);expire(time);lastEvent=time;
    return {running,beat:pulses/24,pulses,reason};
  }
  function receive(byte,time) {
    checkTime(time);
    if(![0xf8,0xfa,0xfb,0xfc].includes(byte))throw new Error('Unsupported Clock transport message');
    expire(time);lastEvent=time;
    if(byte===0xfa){pulses=0;running=true;reason='running';lastPulse=time;}
    else if(byte===0xfb){running=true;reason='running';lastPulse=time;}
    else if(byte===0xfc){running=false;reason='stopped';}
    else if(running){pulses++;lastPulse=time;}
    return {running,beat:pulses/24,pulses,reason};
  }
  function disconnect(time) {
    checkTime(time);lastEvent=time;running=false;reason='disconnected';lastPulse=null;
    return {running,beat:pulses/24,pulses,reason};
  }
  return {receive,snapshot,disconnect};
}
