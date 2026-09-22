//! Experimental 7D TET / protocol 1 / set voice 1 / voice layout 1.
//! Fixed-size parsing; malformed/foreign messages never reach the audio queue.
use crate::synth_core::{FmPatch, OperatorPatch};
pub const VOICE_SIZE: usize = 44;
pub fn decode(bytes: &[u8]) -> Option<(u8, FmPatch)> {
    if bytes.len()!=61 || bytes[..7]!=[0xf0,0x7d,0x54,0x45,0x54,1,1]
        || bytes[8]!=1 || bytes[60]!=0xf7 || bytes[1..60].iter().any(|b|*b>127) {return None;}
    let target=bytes[7];
    if target>15 && target!=127 {return None;}
    let mut raw=[0u8;VOICE_SIZE];
    let mut cursor=9;
    for base in (0..VOICE_SIZE).step_by(7) {
        let count=(VOICE_SIZE-base).min(7);let mask=bytes[cursor];cursor+=1;
        if mask>>count!=0 {return None;}
        for i in 0..count {raw[base+i]=bytes[cursor]|(((mask>>i)&1)<<7);cursor+=1;}
    }
    if raw[2]&8!=0 || raw[3]>15 {return None;}
    let patch=FmPatch {algorithm:raw[0],feedback:raw[1],b4:raw[2],operators:std::array::from_fn(|i|{
        let b=4+i*10;
        OperatorPatch {multi:raw[b],dt:raw[b+1],tl:raw[b+2],rs:raw[b+3],ar:raw[b+4],d1r:raw[b+5],d2r:raw[b+6],rr:raw[b+7],sl:raw[b+8],ssg:raw[b+9],am:raw[3]&(1<<i)!=0}
    })};
    patch.validate().ok()?;
    Some((if target==127 {0}else{target+1},patch)) // internal 0 = all channels
}
#[cfg(test)]
pub fn encode(channel:u8,patch:FmPatch)->Vec<u8>{
    let mut raw=vec![patch.algorithm,patch.feedback,patch.b4,0];
    for (i,o) in patch.operators.iter().enumerate(){if o.am {raw[3]|=1<<i;}raw.extend([o.multi,o.dt,o.tl,o.rs,o.ar,o.d1r,o.d2r,o.rr,o.sl,o.ssg]);}
    let mut result=vec![0xf0,0x7d,0x54,0x45,0x54,1,1,if channel==0{127}else{channel-1},1];
    for group in raw.chunks(7){let mask=group.iter().enumerate().fold(0,|v,(i,b)|v|((b>>7)<<i));result.push(mask);result.extend(group.iter().map(|b|b&127));}
    result.push(0xf7);result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_and_reject_malformed() {
        let mut patch=FmPatch::default();patch.b4=0xf7;patch.operators[2].ssg=15;patch.operators[1].am=true;
        for channel in [0,1,16] {let data=encode(channel,patch);let (ch,p)=decode(&data).unwrap();assert_eq!(ch,channel);assert_eq!(p,patch);}
        let data=encode(0,patch);
        for len in 0..data.len(){assert!(decode(&data[..len]).is_none());}
        for (i,value) in [(1,1),(2,0),(5,2),(6,2),(7,16),(8,2),(9,128),(10,8),(57,4),(60,0)] {let mut bad=data.clone();bad[i]=value;assert!(decode(&bad).is_none(),"{i}");}
    }
}
