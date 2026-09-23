import {parseTfi} from './shared/tfi.js';
import {parseVgi} from './shared/vgi.js';

// Private transport representation, not a new project/voice file format.
// 44 bytes: algorithm, feedback, B4, AM mask, then four logical operators.
export const voiceFields = ['multi','dt','tl','rs','ar','d1r','d2r','rr','sl','ssg'];
const maxima = [15,7,127,3,31,31,31,15,15,15];
const defaults = [1,0,127,0,0,0,0,15,0,0];
function integer(name,n,max){if(!Number.isInteger(n)||n<0||n>max)throw Error(`${name} must be an integer 0–${max}`);return n;}
function boolean(name,value){if(typeof value!=='boolean')throw Error(`${name} must be boolean`);return value;}
function keys(value,allowed,name){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`Invalid ${name}`);for(const key of Object.keys(value))if(!allowed.includes(key))throw Error(`Unsupported ${name} field: ${key}`);}
export function voiceBytes(input,{format}={}) {
  let preset=input;
  if(format!==undefined){
    if(!['tfi','vgi'].includes(format))throw Error('Voice format must be tfi or vgi');
    if(!(input instanceof Uint8Array)&&!(input instanceof ArrayBuffer))throw Error('Voice binary must be Uint8Array or ArrayBuffer');
    preset=format==='tfi'?parseTfi(input):parseVgi(input);
  }
  keys(preset,['label','algorithm','feedback','pan','ams','pms','b4','operators'],'preset');
  const bytes=new Uint8Array(44);
  bytes[0]=integer('algorithm',preset.algorithm??7,7);bytes[1]=integer('feedback',preset.feedback??0,7);
  let b4=integer('b4',preset.b4??0xc0,255);
  if(b4&8)throw Error('Unsupported B4 reserved bit');
  const pan=preset.pan??{};keys(pan,['left','right'],'pan');
  if(pan.left!==undefined)b4=(b4&~128)|(boolean('pan.left',pan.left)?128:0);
  if(pan.right!==undefined)b4=(b4&~64)|(boolean('pan.right',pan.right)?64:0);
  if(preset.ams!==undefined)b4=(b4&~48)|(integer('ams',preset.ams,3)<<4);
  if(preset.pms!==undefined)b4=(b4&~7)|integer('pms',preset.pms,7);
  bytes[2]=b4;
  const operators=preset.operators??[];
  if(!operators||typeof operators!=='object')throw Error('Invalid operators');
  const offset=operators[0]!==undefined?0:1;
  for(const key of Object.keys(operators))if(!(offset===1&&key==='0'&&operators[0]===undefined)&&!Array.from({length:4},(_,i)=>String(i+offset)).includes(key))throw Error('Expected four logical operators');
  for(let i=0;i<4;i++){
    const op=operators[i+offset]??{};keys(op,[...voiceFields,'sr','am'],'operator');
    if(op.am!==undefined&&boolean('am',op.am))bytes[3]|=1<<i;
    voiceFields.forEach((key,j)=>{const value=key==='d2r'?(op.sr??op.d2r):op[key];bytes[4+i*10+j]=integer(key,value??defaults[j],maxima[j]);});
  }
  return bytes;
}
export function pack7(bytes){
  const result=[];
  for(let base=0;base<bytes.length;base+=7){let mask=0;const group=[];for(let i=0;i<7&&base+i<bytes.length;i++){mask|=(bytes[base+i]>>7)<<i;group.push(bytes[base+i]&127);}result.push(mask,...group);}
  return result;
}
export function unpack7(bytes){
  const result=[];
  for(let base=0;base<bytes.length;base+=8){const count=Math.min(7,bytes.length-base-1);if(count===0||bytes[base]>>count)throw Error('Invalid 7-bit packing');for(let i=0;i<count;i++){if(bytes[base+i+1]>127)throw Error('Invalid 7-bit data');result.push(bytes[base+i+1]|(((bytes[base]>>i)&1)<<7));}}
  return Uint8Array.from(result);
}
export function voiceSysEx(input,channel,options){
  if(channel!==null)integer('channel',channel,15);
  // 7D 'TET' protocol 1, command 1, target 0..15 / 127=all, voice version 1.
  return [0xf0,0x7d,0x54,0x45,0x54,1,1,channel===null?127:channel,1,...pack7(voiceBytes(input,options)),0xf7];
}
