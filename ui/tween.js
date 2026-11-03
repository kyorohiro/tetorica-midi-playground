// Timer-driven control changes, not sample-accurate audio automation.
export function createTween({seconds,beats,sleep,check=()=>{}}) {
  return async function tween(duration,onUpdate) {
    if(typeof onUpdate!=='function')throw new TypeError('tween needs a callback');
    let unit='seconds',length;
    if(typeof duration==='number')length=duration;
    else {
      if(!duration||typeof duration!=='object'||Array.isArray(duration)||
        Object.keys(duration).some(key=>key!=='seconds'&&key!=='beats')||
        (duration.seconds!==undefined)===(duration.beats!==undefined))throw new TypeError('Specify exactly one of seconds or beats');
      unit=duration.beats===undefined?'seconds':'beats';length=duration[unit];
    }
    if(!Number.isFinite(length)||length<0)throw new RangeError('Tween duration must be finite and nonnegative');
    check();
    const now=unit==='seconds'?seconds:beats,start=now();
    if(!Number.isFinite(start+length))throw new RangeError('Tween duration is too large');
    if(length===0){await onUpdate(1);check();return;}
    await onUpdate(0);check();
    let previous=0;
    while(previous<1){
      check();
      const remaining=Math.max(0,length-(now()-start));
      // Beat time may be driven by external pulses. Never extrapolate those pulses.
      await sleep(unit==='seconds'?Math.min(1000/60,remaining*1000):1000/60);
      check();
      const progress=Math.max(previous,Math.min(1,(now()-start)/length));
      if(progress>previous){await onUpdate(progress);check();previous=progress;}
    }
  };
}
