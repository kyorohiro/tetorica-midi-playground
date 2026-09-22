import {noteNumber} from './runtime.js';

const dataByte=(value,label)=>{
  if(!Number.isInteger(value)||value<0||value>127)throw Error(`${label} must be an integer 0–127`);
  return value;
};
const channelStatus=(status,channel=1)=>{
  if(!Number.isInteger(channel)||channel<1||channel>16)throw Error('channel must be an integer 1–16');
  return status|(channel-1);
};
export function validateMidiMessage(value){
  if(!Array.isArray(value)&&!(value instanceof Uint8Array))throw Error('send expects an Array or Uint8Array');
  const bytes=Array.from(value);
  if(!bytes.length||bytes.length>65536||bytes.some(b=>!Number.isInteger(b)||b<0||b>255))throw Error('MIDI message must contain 1–65536 integer bytes (0–255)');
  const status=bytes[0];
  if(status===0xf0){
    if(bytes.length<2||bytes.at(-1)!==0xf7||bytes.slice(1,-1).some(b=>b>127))throw Error('SysEx must be F0, data bytes, F7');
  }else{
    const length=status>=0x80&&status<=0xef?([0xc0,0xd0].includes(status&0xf0)?2:3):({241:2,242:3,243:2,246:1,248:1,250:1,251:1,252:1,254:1,255:1})[status];
    if(!length||bytes.length!==length||bytes.slice(1).some(b=>b>127))throw Error('Expected one complete MIDI message with a status byte (no running status)');
  }
  return bytes;
}

// The transport owns native/browser differences. These helpers only encode MIDI.
export function createMidiPrimitives({transmit,check=()=>{},onError=()=>{}}){
  function sendMessage(bytes,tracked=true){
    check();
    const task=(async()=>{await transmit({bytes,tracked});check();})();
    task.catch(error=>{if(typeof error!=='symbol')onError(error);});
    return task;
  }
  return {
    noteOn(note,{channel=1,velocity=90}={}){
      dataByte(velocity,'velocity');if(velocity===0)throw Error('noteOn velocity must be 1–127');
      return sendMessage([channelStatus(0x90,channel),noteNumber(note),velocity]);
    },
    noteOff(note,{channel=1,velocity=0}={}){return sendMessage([channelStatus(0x80,channel),noteNumber(note),dataByte(velocity,'velocity')]);},
    cc(controller,value,{channel=1}={}){return sendMessage([channelStatus(0xb0,channel),dataByte(controller,'controller'),dataByte(value,'CC value')]);},
    programChange(program,{channel=1}={}){return sendMessage([channelStatus(0xc0,channel),dataByte(program,'program')]);},
    pitchBend(value,{channel=1}={}){
      if(!Number.isFinite(value)||value< -1||value>1)throw Error('pitchBend must be between -1 and 1');
      const bend=Math.round(8192+value*(value<0?8192:8191));
      return sendMessage([channelStatus(0xe0,channel),bend&127,bend>>7]);
    },
    channelPressure(value,{channel=1}={}){return sendMessage([channelStatus(0xd0,channel),dataByte(value,'pressure')]);},
    polyPressure(note,value,{channel=1}={}){return sendMessage([channelStatus(0xa0,channel),noteNumber(note),dataByte(value,'pressure')]);},
    send(bytes){return sendMessage(validateMidiMessage(bytes),false);},
  };
}
