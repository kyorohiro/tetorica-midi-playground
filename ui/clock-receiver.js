import {createExternalClock} from './external-clock.js';
// A receiver belongs to one Run and one connected input stream.
export function createClockReceiver(runId) {
  const clock=createExternalClock();
  let sequence=0,lastTime=-1,state=null;
  return {
    receive(event) {
      if(!event||runId===undefined||event.runId!==runId||!Number.isSafeInteger(event.sequence)||event.sequence<=sequence)return null;
      if(![0xf8,0xfa,0xfb,0xfc].includes(event.byte)||!Number.isFinite(event.timestampMs)||event.timestampMs<0||event.timestampMs<lastTime)return null;
      sequence=event.sequence;lastTime=event.timestampMs;
      state=clock.receive(event.byte,event.timestampMs);
      return {...state};
    },
    get state(){return state?{...state}:null;},
  };
}
