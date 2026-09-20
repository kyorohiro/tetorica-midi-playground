// MIDI-facing helpers. Timing here is internal BPM, not external MIDI Clock.
export function noteNumber(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 127) return value;
  const match = typeof value === 'string' && /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(value);
  if (!match) throw new Error('Expected a MIDI note 0–127 or note name such as C4');
  const n = (Number(match[3])+1)*12 + {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1].toUpperCase()] + (match[2]==='#'?1:match[2]==='b'?-1:0);
  if (n<0 || n>127) throw new Error('Note outside MIDI range');
  return n;
}
export function createMidiHelpers({send, sleep, log, bpm: initialBpm=120}) {
  let bpm=initialBpm;
  const positive=(n,label,max)=>{if(!Number.isFinite(n)||n<=0||n>max)throw new Error(`Invalid ${label}`);return n;};
  function setBpm(value){bpm=positive(value,'BPM',999);}
  async function beat(count=1){await sleep(positive(count,'beat count',1024)*60000/bpm);}
  async function play(note,{duration=0.5,channel=1,velocity=90}={}){
    const durationMs=Math.round(positive(duration,'duration',128)*60000/bpm);
    if(durationMs<1||durationMs>10000)throw new Error('Note duration must be 1–10000 ms');
    if(!Number.isInteger(channel)||channel<1||channel>16||!Number.isInteger(velocity)||velocity<1||velocity>127)throw new Error('Invalid channel or velocity');
    await send({note:noteNumber(note),channel,velocity,durationMs});
    await sleep(durationMs);
  }
  const choose=values=>{if(!Array.isArray(values)||!values.length)throw new Error('choose needs a nonempty array');return values[Math.floor(Math.random()*values.length)];};
  return {play,beat,setBpm,choose,log};
}
