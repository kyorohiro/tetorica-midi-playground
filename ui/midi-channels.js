// Script API uses wire-style indices; UI labels and native note IPC use 1..16.
export const channels = Object.freeze(Object.fromEntries(Array.from({length:16},(_,i)=>[`CH${i+1}`,i])));
export function toNativeNote(payload) {
  if (!Number.isInteger(payload.channel) || payload.channel < 0 || payload.channel > 15) throw new Error('MIDI channel must be 0–15');
  return {...payload,channel:payload.channel+1};
}
