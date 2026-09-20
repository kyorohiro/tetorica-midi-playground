// Pulse-based waits; no interpolation or catch-up playback.
export function createClockWait(receiver,{now=()=>performance.now(),sleep,onStop}) {
  let started=false,lastArrival=now(),failed=null;
  function fail(message){if(!failed){failed=new Error(message);onStop(message);}return failed;}
  function receive(event){
    const state=receiver.receive(event);if(!state)return;
    lastArrival=now();
    if(started&&event.byte===0xfa){fail('External Start reset the transport. Press Run again.');return;}
    if(state.running)started=true;
    if(started&&!state.running)fail('External Clock stopped. Press Run again.');
  }
  function check(){
    if(failed)throw failed;
    if(started&&now()-lastArrival>=1000)throw fail('External Clock timed out. Press Run again.');
  }
  async function ready(){while(!started){check();await sleep(5);}check();}
  async function until(target,checkLoop=()=>{}){
    for(;;){check();checkLoop();if(receiver.state.beat+1e-8>=target)return;await sleep(5);}
  }
  return {receive,check,ready,
    async beat(count=1,checkLoop=()=>{}){if(!Number.isFinite(count)||count<=0||count>1024)throw new Error('Invalid beat count');await ready();await until(receiver.state.beat+count,checkLoop);},
    async nextBeat(checkLoop=()=>{}){await ready();await until(Math.floor(receiver.state.beat+1e-8)+1,checkLoop);},
  };
}
