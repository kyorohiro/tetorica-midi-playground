//! No OS, UI or audio-device dependency. Instances belong to the audio thread.
use std::ffi::c_void;
use std::ptr::NonNull;
const CLOCK: f64 = 7_670_454.0;
extern "C" {
    fn rack_chip_new() -> *mut c_void;
    fn rack_chip_delete(p: *mut c_void);
    fn rack_chip_reset(p: *mut c_void);
    fn rack_chip_write(p: *mut c_void, port: u32, reg: u32, value: u32);
    fn rack_chip_sample(p: *mut c_void, stereo: *mut f32);
    fn rack_chip_divider(p: *mut c_void) -> u32;
}
struct Chip(NonNull<c_void>);
// Exclusive ownership; ymfm never calls into Rust and has no shared mutable state.
unsafe impl Send for Chip {}
impl Drop for Chip {
    fn drop(&mut self) {
        unsafe { rack_chip_delete(self.0.as_ptr()) }
    }
}
impl Chip {
    fn new() -> Result<Self, String> {
        NonNull::new(unsafe { rack_chip_new() })
            .map(Self)
            .ok_or("ymfm allocation failed".into())
    }
    fn write(&mut self, port: usize, reg: u32, value: u32) {
        unsafe { rack_chip_write(self.0.as_ptr(), port as u32, reg, value) }
    }
    fn sample(&mut self) -> [f32; 2] {
        let mut v = [0.0; 2];
        unsafe { rack_chip_sample(self.0.as_ptr(), v.as_mut_ptr()) };
        v
    }
}
#[derive(Clone, Copy, Default)]
struct Voice {
    held: bool,
    channel: u8,
    note: u8,
    age: u64,
}
#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperatorPatch {
    pub multi: u8,
    pub dt: u8,
    pub tl: u8,
    pub rs: u8,
    pub ar: u8,
    pub d1r: u8,
    pub d2r: u8,
    pub sl: u8,
    pub rr: u8,
}
#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FmPatch {
    pub algorithm: u8,
    pub feedback: u8,
    pub operators: [OperatorPatch; 4],
}
impl Default for FmPatch {
    fn default() -> Self {
        Self {
            algorithm: 4,
            feedback: 0,
            operators: std::array::from_fn(|i| OperatorPatch {
                multi: if i == 0 { 2 } else { 1 },
                dt: 0,
                tl: match i {
                    0 => 38,
                    1 => 12,
                    _ => 127,
                },
                rs: 0,
                ar: 31,
                d1r: 0,
                d2r: 0,
                sl: 0,
                rr: 15,
            }),
        }
    }
}
impl FmPatch {
    pub fn validate(&self) -> Result<(), String> {
        if self.algorithm > 7
            || self.feedback > 7
            || self.operators.iter().any(|o| {
                o.multi > 15
                    || o.dt > 7
                    || o.tl > 127
                    || o.rs > 3
                    || o.ar > 31
                    || o.d1r > 31
                    || o.d2r > 31
                    || o.sl > 15
                    || o.rr > 15
            })
        {
            return Err("FM parameter out of range".into());
        }
        Ok(())
    }
    fn registers(&self, op: usize, velocity: u8) -> [u32; 6] {
        let o = self.operators[op];
        let carriers = [
            0b1000, 0b1000, 0b1000, 0b1000, 0b1010, 0b1110, 0b1110, 0b1111,
        ];
        let attenuation = if carriers[self.algorithm as usize] & (1 << op) != 0 {
            (127 - velocity) / 2
        } else {
            0
        };
        [
            (o.dt as u32) << 4 | o.multi as u32,
            (o.tl as u32 + attenuation as u32).min(127),
            (o.rs as u32) << 6 | o.ar as u32,
            o.d1r as u32,
            o.d2r as u32,
            (o.sl as u32) << 4 | o.rr as u32,
        ]
    }
}
pub struct Synth {
    patches: [FmPatch; 16],
    chip: Chip,
    voices: [Voice; 6],
    serial: u64,
    ratio: f64,
    phase: f64,
    previous: [f32; 2],
    next: [f32; 2],
    dc_input: [f32; 2],
    dc_output: [f32; 2],
    dc_decay: f32,
}
impl Synth {
    pub fn new(rate: u32) -> Result<Self, String> {
        if rate == 0 {
            return Err("Invalid sample rate".into());
        }
        let chip = Chip::new()?;
        let ratio = CLOCK / unsafe { rack_chip_divider(chip.0.as_ptr()) } as f64 / rate as f64;
        Ok(Self {
            patches: [FmPatch::default(); 16],
            chip,
            voices: [Voice::default(); 6],
            serial: 0,
            ratio,
            phase: 0.0,
            previous: [0.0; 2],
            next: [0.0; 2],
            dc_input: [0.0; 2],
            dc_output: [0.0; 2],
            dc_decay: (-2.0 * std::f64::consts::PI * 10.0 / rate as f64).exp() as f32,
        })
    }
    pub fn set_patch(&mut self, channel: u8, patch: FmPatch) -> Result<(), String> {
        patch.validate()?;
        if !(1..=16).contains(&channel) {
            return Err("MIDI channel must be 1–16".into());
        }
        self.patches[(channel - 1) as usize] = patch;
        Ok(())
    }
    fn key(&mut self, voice: usize, on: bool) {
        self.chip.write(
            0,
            0x28,
            (voice % 3 + if voice >= 3 { 4 } else { 0 }) as u32 | if on { 0xf0 } else { 0 },
        );
    }
    fn start(&mut self, voice: usize, ch: u8, note: u8, velocity: u8) {
        self.key(voice, false);
        let port = voice / 3;
        let offset = (voice % 3) as u32;
        let patch = self.patches[ch as usize];
        self.chip.write(
            port,
            0xb0 + offset,
            patch.algorithm as u32 | ((patch.feedback as u32) << 3),
        );
        self.chip.write(port, 0xb4 + offset, 0xc0);
        for (op, slot) in [0, 8, 4, 12].iter().enumerate() {
            for (reg, value) in [0x30, 0x40, 0x50, 0x60, 0x70, 0x80]
                .into_iter()
                .zip(patch.registers(op, velocity))
            {
                self.chip.write(port, reg + offset + slot, value);
            }
            self.chip.write(port, 0x90 + offset + slot, 0);
        }
        let hz = 440.0 * 2f64.powf((note as f64 - 69.0) / 12.0);
        let mut best = (f64::INFINITY, 0, 1);
        for block in 0..8 {
            let unit = CLOCK * 2f64.powi(block - 1) / (144.0 * 1048576.0);
            let f = (hz / unit).round().clamp(1.0, 2047.0) as u32;
            let error = (f as f64 * unit - hz).abs();
            if error < best.0 {
                best = (error, block as u32, f);
            }
        }
        self.chip
            .write(port, 0xa4 + offset, (best.1 << 3) | (best.2 >> 8));
        self.chip.write(port, 0xa0 + offset, best.2 & 255);
        self.serial += 1;
        self.voices[voice] = Voice {
            held: true,
            channel: ch,
            note,
            age: self.serial,
        };
        self.key(voice, true);
    }
    pub fn midi(&mut self, bytes: &[u8]) {
        if bytes.len() != 3 || bytes[1] > 127 || bytes[2] > 127 {
            return;
        }
        let ch = bytes[0] & 15;
        let note = bytes[1];
        match bytes[0] & 0xf0 {
            0x90 if bytes[2] > 0 => {
                let v = self
                    .voices
                    .iter()
                    .position(|v| v.held && v.channel == ch && v.note == note)
                    .or_else(|| self.voices.iter().position(|v| !v.held))
                    .unwrap_or_else(|| (0..6).min_by_key(|i| self.voices[*i].age).unwrap());
                self.start(v, ch, note, bytes[2]);
            }
            0x80 | 0x90 => {
                for i in 0..6 {
                    if self.voices[i].held
                        && self.voices[i].channel == ch
                        && self.voices[i].note == note
                    {
                        self.key(i, false);
                        self.voices[i].held = false;
                    }
                }
            }
            0xb0 if note == 123 || note == 120 => {
                for i in 0..6 {
                    if self.voices[i].channel == ch {
                        self.key(i, false);
                        self.voices[i].held = false;
                        if note == 120 {
                            for slot in [0, 4, 8, 12] {
                                self.chip.write(i / 3, 0x40 + (i % 3) as u32 + slot, 127);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    pub fn panic(&mut self) {
        unsafe { rack_chip_reset(self.chip.0.as_ptr()) };
        self.voices = [Voice::default(); 6];
        self.previous = [0.0; 2];
        self.next = [0.0; 2];
        self.phase = 0.0;
        self.dc_input = [0.0; 2];
        self.dc_output = [0.0; 2];
    }
    pub fn active(&self) -> u32 {
        self.voices
            .iter()
            .filter(|v| v.held)
            .fold(0, |mask, v| mask | (1 << v.channel))
    }
    pub fn sample(&mut self) -> [f32; 2] {
        // Linear resampling is sufficient for this audition instrument; not mastering quality.
        self.phase += self.ratio;
        while self.phase >= 1.0 {
            self.previous = self.next;
            self.next = self.chip.sample();
            self.phase -= 1.0;
        }
        std::array::from_fn(|i| {
            let input = self.previous[i] + (self.next[i] - self.previous[i]) * self.phase as f32;
            // Remove the YM2612 DAC ladder DC offset, including at key-off.
            let output = input - self.dc_input[i] + self.dc_decay * self.dc_output[i];
            self.dc_input[i] = input;
            self.dc_output[i] = output;
            output
        })
    }
}
extern "C" {
    fn rack_psg_new(rate: u32) -> *mut c_void;
    fn rack_psg_delete(p: *mut c_void);
    fn rack_psg_reset(p: *mut c_void);
    fn rack_psg_write(p: *mut c_void, value: u32);
    fn rack_psg_sample(p: *mut c_void, stereo: *mut f32);
}
pub struct Psg {
    chip: NonNull<c_void>,
    voices: [Voice; 4],
    serial: u64,
}
// Exclusively owned by the audio thread; no callbacks or shared mutable state.
unsafe impl Send for Psg {}
impl Drop for Psg {
    fn drop(&mut self) {
        unsafe { rack_psg_delete(self.chip.as_ptr()) }
    }
}
impl Psg {
    fn new(rate: u32) -> Result<Self, String> {
        if rate == 0 {
            return Err("Invalid sample rate".into());
        }
        Ok(Self {
            chip: NonNull::new(unsafe { rack_psg_new(rate) }).ok_or("PSG allocation failed")?,
            voices: [Voice::default(); 4],
            serial: 0,
        })
    }
    fn write(&mut self, v: u32) {
        unsafe { rack_psg_write(self.chip.as_ptr(), v) }
    }
    fn mute(&mut self, i: usize) {
        self.write(0x9f | ((i as u32) << 5));
        self.voices[i].held = false;
    }
    fn midi(&mut self, bytes: &[u8]) {
        if bytes.len() != 3 || bytes[1] > 127 || bytes[2] > 127 {
            return;
        }
        let ch = bytes[0] & 15;
        let note = bytes[1];
        match bytes[0] & 0xf0 {
            0x90 if bytes[2] > 0 => {
                // CH10 is a monophonic fixed white-noise percussion voice.
                let i = if ch == 9 {
                    3
                } else {
                    self.voices[..3]
                        .iter()
                        .position(|v| v.held && v.channel == ch && v.note == note)
                        .or_else(|| self.voices[..3].iter().position(|v| !v.held))
                        .unwrap_or_else(|| (0..3).min_by_key(|i| self.voices[*i].age).unwrap())
                };
                self.mute(i);
                if i == 3 {
                    self.write(0xe5);
                } else {
                    let hz = 440.0 * 2f64.powf((note as f64 - 69.0) / 12.0);
                    let period = (3_579_545.0 / (32.0 * hz)).round().clamp(1.0, 1023.0) as u32;
                    self.write(0x80 | ((i as u32) << 5) | (period & 15));
                    self.write(period >> 4);
                }
                let attenuation = (-20.0 * (bytes[2] as f64 / 127.0).log10() / 2.0)
                    .round()
                    .clamp(0.0, 14.0) as u32;
                self.write(0x90 | ((i as u32) << 5) | attenuation);
                self.serial += 1;
                self.voices[i] = Voice {
                    held: true,
                    channel: ch,
                    note,
                    age: self.serial,
                };
            }
            0x80 | 0x90 => {
                for i in 0..4 {
                    let v = self.voices[i];
                    if v.held && v.channel == ch && v.note == note {
                        self.mute(i);
                    }
                }
            }
            0xb0 if note == 120 || note == 123 => {
                for i in 0..4 {
                    if self.voices[i].channel == ch {
                        self.mute(i);
                    }
                }
            }
            _ => {}
        }
    }
    fn panic(&mut self) {
        unsafe { rack_psg_reset(self.chip.as_ptr()) };
        self.voices = [Voice::default(); 4];
    }
    fn active(&self) -> u32 {
        self.voices
            .iter()
            .filter(|v| v.held)
            .fold(0, |m, v| m | (1 << v.channel))
    }
    fn sample(&mut self) -> [f32; 2] {
        let mut s = [0.0; 2];
        unsafe { rack_psg_sample(self.chip.as_ptr(), s.as_mut_ptr()) };
        s
    }
}
pub enum Instrument {
    Ym2612(Synth),
    SegaPsg(Psg),
}
impl Instrument {
    pub fn midi(&mut self, bytes: &[u8]) {
        match self {
            Self::Ym2612(s) => s.midi(bytes),
            Self::SegaPsg(s) => s.midi(bytes),
        }
    }
    pub fn panic(&mut self) {
        match self {
            Self::Ym2612(s) => s.panic(),
            Self::SegaPsg(s) => s.panic(),
        }
    }
    pub fn active(&self) -> u32 {
        match self {
            Self::Ym2612(s) => s.active(),
            Self::SegaPsg(s) => s.active(),
        }
    }
    fn sample(&mut self) -> [f32; 2] {
        match self {
            Self::Ym2612(s) => s.sample(),
            Self::SegaPsg(s) => s.sample(),
        }
    }
}
// Balance the default FM patch against PSG without changing its operator timbre.
const MIXER_INPUT_GAIN: [f32; 2] = [8.0, 1.0];
pub struct Mixer {
    pub synths: [Instrument; 2],
    gain: [[f32; 2]; 2],
}
impl Mixer {
    pub fn new(rate: u32) -> Result<Self, String> {
        Ok(Self {
            synths: [
                Instrument::Ym2612(Synth::new(rate)?),
                Instrument::SegaPsg(Psg::new(rate)?),
            ],
            gain: [[0.0; 2]; 2],
        })
    }
    pub fn sample(&mut self, volume: [f32; 2], pan: [f32; 2], master: f32) -> [f32; 2] {
        let mut result = [0.0f32; 2];
        for i in 0..2 {
            let pcm = self.synths[i].sample();
            let target = [
                volume[i] * (1.0 - pan[i].max(0.0)),
                volume[i] * (1.0 + pan[i].min(0.0)),
            ];
            for c in 0..2 {
                self.gain[i][c] += (target[c] * master - self.gain[i][c]) * 0.002;
                result[c] += pcm[c] * MIXER_INPUT_GAIN[i] * self.gain[i][c];
            }
        }
        result.map(|s| s.clamp(-1.0, 1.0))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fm_patch_validation_and_register_mapping() {
        let mut p = FmPatch::default();
        p.algorithm = 7;
        p.feedback = 7;
        p.operators[0] = OperatorPatch {
            multi: 15,
            dt: 7,
            tl: 120,
            rs: 3,
            ar: 31,
            d1r: 30,
            d2r: 29,
            sl: 15,
            rr: 14,
        };
        p.validate().unwrap();
        assert_eq!(p.registers(0, 1), [0x7f, 127, 0xdf, 30, 29, 0xfe]);
        p.algorithm = 0;
        assert_eq!(p.registers(0, 1)[1], 120); // modulator unaffected by velocity
        p.algorithm = 8;
        assert!(p.validate().is_err());
        p.algorithm = 0;
        p.operators[3].rr = 16;
        assert!(p.validate().is_err());
        let mut s = Synth::new(48000).unwrap();
        assert!(s.set_patch(0, FmPatch::default()).is_err());
        assert!(s.set_patch(17, FmPatch::default()).is_err());
    }
    #[test]
    fn patch_changes_next_note_only_and_is_channel_local_after_panic() {
        let mut a = Synth::new(48000).unwrap();
        let mut b = Synth::new(48000).unwrap();
        a.midi(&[0x90, 69, 100]);
        b.midi(&[0x90, 69, 100]);
        let mut silent = FmPatch::default();
        for op in &mut silent.operators {
            op.tl = 127;
        }
        a.set_patch(1, silent).unwrap();
        for _ in 0..1000 {
            assert_eq!(a.sample(), b.sample());
        }
        a.panic();
        b.panic();
        a.midi(&[0x91, 69, 100]);
        b.midi(&[0x91, 69, 100]);
        for _ in 0..1000 {
            assert_eq!(a.sample(), b.sample());
        } // CH2 remains original
        a.panic();
        b.panic();
        a.midi(&[0x90, 69, 100]);
        b.midi(&[0x90, 69, 100]);
        for _ in 0..48000 {
            a.sample();
            b.sample();
        }
        let mut quiet = 0.0;
        let mut loud = 0.0;
        for _ in 0..4800 {
            quiet += a.sample()[0].abs();
            loud += b.sample()[0].abs();
        }
        assert!(loud > 1.0 && quiet < loud * 0.01, "{quiet} vs {loud}");
    }
    #[test]
    fn audible_pitch_and_note_off() {
        for rate in [44100, 48000, 96000] {
            let mut s = Synth::new(rate).unwrap();
            s.midi(&[0x90, 69, 100]);
            let samples: Vec<_> = (0..rate / 2).map(|_| s.sample()[0]).collect();
            assert!(samples.iter().any(|v| v.abs() > 0.005));
            // Fundamental of fixed FM patch remains A4; estimate via positive crossings.
            let crossings = samples
                .windows(2)
                .filter(|w| w[0] <= 0.0 && w[1] > 0.0)
                .count();
            assert!((200..=240).contains(&crossings), "{rate}: {crossings}");
            s.midi(&[0x90, 69, 0]);
            assert_eq!(s.active(), 0);
            for _ in 0..rate {
                s.sample();
            }
            let tail: f32 = (0..100).map(|_| s.sample()[0].abs()).sum();
            assert!(tail < 0.1, "{tail}");
        }
    }
    #[test]
    fn channels_stealing_and_panic() {
        let mut s = Synth::new(48000).unwrap();
        for ch in 0..7 {
            s.midi(&[0x90 | ch, 60, 90]);
        }
        assert_eq!(s.active(), 0b1111110);
        s.midi(&[0x80, 60, 0]);
        assert_eq!(s.active(), 0b1111110);
        s.midi(&[0xb1, 123, 0]);
        assert_eq!(s.active(), 0b1111100);
        s.midi(&[0xb2, 120, 0]);
        assert_eq!(s.active(), 0b1111000);
        s.midi(&[0x90, 255, 90]);
        assert_eq!(s.active(), 0b1111000);
        s.panic();
        assert_eq!(s.active(), 0);
    }
    #[test]
    fn psg_pitch_velocity_and_silence() {
        for rate in [44100, 48000, 96000] {
            let mut s = Psg::new(rate).unwrap();
            s.midi(&[0x90, 69, 127]);
            let samples: Vec<_> = (0..rate / 2).map(|_| s.sample()[0]).collect();
            let crossings = samples
                .windows(2)
                .filter(|w| w[0] <= 0.0 && w[1] > 0.0)
                .count();
            assert!((218..=222).contains(&crossings), "{rate}: {crossings}");
            let loud: f32 = samples.iter().map(|v| v.abs()).sum::<f32>() / samples.len() as f32;
            s.midi(&[0x90, 69, 32]);
            let soft: f32 =
                (0..rate / 2).map(|_| s.sample()[0].abs()).sum::<f32>() / (rate / 2) as f32;
            assert!(soft > 0.0 && soft < loud / 2.0);
            s.midi(&[0x90, 69, 0]);
            assert_eq!(s.active(), 0);
            for _ in 0..100 {
                assert_eq!(s.sample(), [0.0; 2]);
            }
        }
    }
    #[test]
    fn psg_three_tones_and_independent_noise_ownership() {
        let mut s = Psg::new(48000).unwrap();
        for ch in 0..4 {
            s.midi(&[0x90 | ch, 69, 100]);
        }
        assert_eq!(s.active(), 0b1110);
        s.midi(&[0x80, 69, 0]); // stolen note must not silence its replacement
        assert_eq!(s.active(), 0b1110);
        s.midi(&[0x99, 36, 100]);
        assert_eq!(s.active(), 0b1110 | (1 << 9));
        s.midi(&[0x99, 38, 100]);
        s.midi(&[0x89, 36, 0]);
        assert_eq!(s.active(), 0b1110 | (1 << 9));
        for ch in 1..4 {
            s.midi(&[0xb0 | ch, 123, 0]);
        }
        assert_eq!(s.active(), 1 << 9);
        assert!((0..4800).any(|_| s.sample()[0].abs() > 0.01));
        s.midi(&[0xb9, 120, 0]);
        assert_eq!(s.active(), 0);
        assert_eq!(s.sample(), [0.0; 2]);
        s.midi(&[0x99, 42, 100]);
        s.panic();
        assert_eq!(s.active(), 0);
        assert_eq!(s.sample(), [0.0; 2]);
        s.midi(&[0x90, 255, 100]);
        assert_eq!(s.active(), 0);
    }
    #[test]
    fn default_mixer_levels() {
        let mut levels = [0.0f32; 2];
        for port in 0..2 {
            let mut m = Mixer::new(48000).unwrap();
            m.synths[port].midi(&[0x90, 69, 90]);
            for _ in 0..4800 { m.sample([0.7; 2], [0.0; 2], 0.35); }
            for _ in 0..48000 {
                let v = m.sample([0.7; 2], [0.0; 2], 0.35)[0];
                levels[port] += v * v;
            }
            levels[port] = (levels[port] / 48000.0).sqrt();
        }
        assert!(levels[0] > 0.02 && levels[0] < 0.08, "FM RMS: {}", levels[0]);
        assert!(levels[0] / levels[1] > 0.5 && levels[0] / levels[1] < 1.5);
        let mut m = Mixer::new(48000).unwrap();
        for note in [48, 55, 60, 64, 67, 72] { m.synths[0].midi(&[0x90, note, 127]); }
        for note in [60, 64, 67] { m.synths[1].midi(&[0x90, note, 127]); }
        m.synths[1].midi(&[0x99, 36, 127]);
        let mut peak = 0.0f32;
        for _ in 0..48000 {
            for v in m.sample([0.7; 2], [0.0; 2], 0.35) { peak = peak.max(v.abs()); }
        }
        assert!(peak < 0.95, "Default polyphonic mix peak: {peak}");
    }
    #[test]
    fn mixer_ports_pan_and_mute() {
        let mut m = Mixer::new(48000).unwrap();
        m.synths[0].midi(&[0x90, 60, 90]);
        m.synths[1].midi(&[0x91, 64, 90]);
        assert_eq!(m.synths[0].active(), 1);
        assert_eq!(m.synths[1].active(), 2);
        let mut energy = [0.0; 2];
        for _ in 0..4800 {
            let x = m.sample([1.0, 0.0], [-1.0, 0.0], 0.3);
            for c in 0..2 {
                energy[c] += x[c].abs();
            }
        }
        assert!(energy[0] > 1.0);
        assert_eq!(energy[1], 0.0);
        for _ in 0..10000 {
            m.sample([0.0; 2], [0.0; 2], 0.3);
        }
        assert!(m
            .sample([0.0; 2], [0.0; 2], 0.3)
            .iter()
            .all(|v| v.abs() < 0.0001));
    }
}
