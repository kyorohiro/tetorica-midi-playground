// MIDI-facing helpers. Timing here is internal BPM, not external MIDI Clock.
export function noteNumber(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 127) return value;
  const match = typeof value === 'string' && /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(value);
  if (!match) throw new Error('Expected a MIDI note 0–127 or note name such as C4');
  const n = (Number(match[3])+1)*12 + {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1].toUpperCase()] + (match[2]==='#'?1:match[2]==='b'?-1:0);
  if (n<0 || n>127) throw new Error('Note outside MIDI range');
  return n;
}
function noteName(midi) {
  noteNumber(midi);
  return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][midi%12]+(Math.floor(midi/12)-1);
}

export function createMidiHelpers({send, sleep, log, bpm: initialBpm=120, now=()=>performance.now(), random=()=>Math.random()}) {
  let bpm=initialBpm;
  let anchorTime=now(), anchorBeat=0;
  const currentBeat=()=>anchorBeat+(now()-anchorTime)*bpm/60000;
  const positive=(n,label,max)=>{if(!Number.isFinite(n)||n<=0||n>max)throw new Error(`Invalid ${label}`);return n;};
  function setBpm(value){
    const next=positive(value,'BPM',999);
    anchorBeat=currentBeat();anchorTime=now();bpm=next;
  }
  positive(bpm,'BPM',999);
  async function waitForBeat(target,check=()=>{}){
    for(;;){
      check();
      const remaining=target-currentBeat();
      if(remaining<=0.000001)return;
      await sleep(Math.min(25,remaining*60000/bpm));
    }
  }
  async function nextBeat(){await waitForBeat(Math.floor(currentBeat()+0.000001)+1);}
  function createLoopTiming(check){
    let cursor=currentBeat();
    return {
      async beat(count=1){
        check();positive(count,'beat count',1024);
        cursor=Math.max(cursor,currentBeat())+count;
        await waitForBeat(cursor,check);
      },
      async nextBeat(){
        check();cursor=Math.floor(Math.max(cursor,currentBeat())+0.000001)+1;
        await waitForBeat(cursor,check);
      }
    };
  }
  async function beat(count=1){await sleep(positive(count,'beat count',1024)*60000/bpm);}
  async function play(note,{duration=0.5,channel=0,velocity=90}={},sender=send){
    const durationMs=Math.round(positive(duration,'duration',128)*60000/bpm);
    if(durationMs<1||durationMs>10000)throw new Error('Note duration must be 1–10000 ms');
    if(!Number.isInteger(channel)||channel<0||channel>15||!Number.isInteger(velocity)||velocity<1||velocity>127)throw new Error('Invalid channel or velocity');
    await sender({note:noteNumber(note),channel,velocity,durationMs});
    await sleep(durationMs);
  }
  const choose=values=>{if(!Array.isArray(values)||!values.length)throw new Error('choose needs a nonempty array');return values[Math.floor(random()*values.length)];};
  const cycles=new Map();
  function cycle(keyOrValues, maybeValues) {
    const values=maybeValues === undefined ? keyOrValues : maybeValues;
    if(!Array.isArray(values)||!values.length)throw new Error('cycle needs a nonempty array');
    const key=maybeValues === undefined ? JSON.stringify(values) : String(keyOrValues);
    const index=cycles.get(key)||0;
    cycles.set(key,index+1);
    return values[index%values.length];
  }
  function scale(root,name,octaves=1) {
    const intervals={majorPentatonic:[0,2,4,7,9],minorPentatonic:[0,3,5,7,10],major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10]}[name];
    if(!Array.isArray(intervals))throw new Error(`Unknown scale: ${name}`);
    if(!Number.isInteger(octaves)||octaves<1||octaves>11)throw new Error('Invalid octave count');
    const base=noteNumber(root), notes=[];
    for(let octave=0;octave<octaves;octave++)for(const interval of intervals){
      const midi=noteNumber(base+octave*12+interval);
      notes.push(noteName(midi));
    }
    return notes;
  }
  function chord(root,name) {
    const intervals={major:[0,4,7],minor:[0,3,7],major7:[0,4,7,11],minor7:[0,3,7,10],dominant7:[0,4,7,10]}[name];
    if(!Array.isArray(intervals))throw new Error(`Unsupported chord: ${name}`);
    const base=noteNumber(root);
    return intervals.map(interval=>noteName(base+interval));
  }
  const finite=value=>{const n=Number(value);if(!Number.isFinite(n))throw new Error('Expected a finite number');return n;};
  const rand=()=>random();
  const rrange=(min,max)=>{const low=finite(min),high=finite(max);return low+random()*(high-low);};
  function randInt(min,max){
    const low=Math.ceil(finite(min)),high=Math.floor(finite(max));
    if(!Number.isSafeInteger(low)||!Number.isSafeInteger(high)||high<low||!Number.isSafeInteger(high-low+1))throw new Error('Invalid integer range');
    return Math.floor(random()*(high-low+1))+low;
  }
  const lerp=(a,b,t)=>{const low=finite(a),high=finite(b);return low+(high-low)*finite(t);};
  function noteLerp(from,to,t){
    const midi=lerp(noteNumber(from),noteNumber(to),t);
    if(!Number.isFinite(midi)||midi<0||midi>127)throw new Error('Interpolated note outside MIDI range');
    return Math.round(midi);
  }
  const api={play,beat,nextBeat,setBpm,choose,cycle,scale,chord,rand,rrange,randInt,lerp,noteLerp,log};
  // Internal factory; do not inject it as a global in user scripts.
  Object.defineProperty(api,'createLoopTiming',{value:createLoopTiming});
  return api;
}
