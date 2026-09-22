// One complete MIDI 1.0 message. Framing is explicit; no running status/batches.
pub fn validate(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > 65536 {
        return Err("MIDI message must contain 1–65536 bytes".into());
    }
    let status = bytes[0];
    if status == 0xf0 {
        if bytes.len() < 2 || bytes.last() != Some(&0xf7) || bytes[1..bytes.len()-1].iter().any(|v| *v > 127) {
            return Err("SysEx must be F0, data bytes, F7".into());
        }
        return Ok(());
    }
    let length = match status {
        0xc0..=0xdf | 0xf1 | 0xf3 => 2,
        0x80..=0xbf | 0xe0..=0xef | 0xf2 => 3,
        0xf6 | 0xf8 | 0xfa..=0xfc | 0xfe | 0xff => 1,
        _ => return Err("Unsupported MIDI status / running status".into()),
    };
    if bytes.len() != length || bytes[1..].iter().any(|v| *v > 127) {
        return Err("Expected one complete MIDI message with 7-bit data".into());
    }
    Ok(())
}
