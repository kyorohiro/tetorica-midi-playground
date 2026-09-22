//! Native audition rack. PCM never passes through the WebView.
use crate::synth_core::{FmPatch, Instrument, Mixer};
use crossbeam_queue::ArrayQueue;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc, Mutex,
};
#[derive(Clone, Copy)]
struct Event {
    port: usize,
    bytes: [u8; 3],
    len: usize,
    patch: Option<(u8,FmPatch)>,
}
struct Shared {
    queue: ArrayQueue<Event>,
    bank: Arc<Mutex<[FmPatch;16]>>,
    panic: AtomicBool,
    error: AtomicBool,
    volume: [AtomicU32; 2],
    pan: [AtomicU32; 2],
    master: AtomicU32,
    active: [AtomicU32; 2],
}
impl Default for Shared {
    fn default() -> Self {
        Self {
            queue: ArrayQueue::new(2048),
            bank: Arc::new(Mutex::new([FmPatch::default();16])),
            panic: AtomicBool::new(false),
            error: AtomicBool::new(false),
            volume: std::array::from_fn(|_| AtomicU32::new(0.7f32.to_bits())),
            pan: std::array::from_fn(|_| AtomicU32::new(0f32.to_bits())),
            master: AtomicU32::new(0.35f32.to_bits()),
            active: std::array::from_fn(|_| AtomicU32::new(0)),
        }
    }
}
impl Shared {
    fn enqueue_patch(&self, channel:u8, patch:FmPatch)->Result<(),String> {
        let mut bank=self.bank.lock().unwrap();
        self.queue.push(Event {port:0,bytes:[0;3],len:0,patch:Some((channel,patch))}).map_err(|_|"FM update queue full; retry")?;
        if channel==0 {*bank=[patch;16];}else{bank[(channel-1) as usize]=patch;}
        Ok(())
    }
    fn receive(&self, port: usize, bytes: &[u8]) {
        if port==0 && bytes.first()==Some(&0xf0) {
            if let Some((ch,patch))=crate::voice_sysex::decode(bytes) {
                if self.enqueue_patch(ch,patch).is_err(){self.error.store(true,Ordering::Relaxed);self.panic.store(true,Ordering::Release);}
            }
            return;
        }
        let valid=match bytes.first().map(|b|b&0xf0) {
            Some(0xc0|0xd0)=>bytes.len()==2,
            Some(0x80|0x90|0xa0|0xb0|0xe0)=>bytes.len()==3,
            _=>false,
        };
        if port<2 && valid && bytes[1..].iter().all(|v|*v<128) {
            if self
                .queue
                .push(Event {
                    port,
                    bytes: [bytes[0], bytes[1], *bytes.get(2).unwrap_or(&0)],
                    len:bytes.len(),patch:None,
                })
                .is_err()
            {
                self.panic.store(true, Ordering::Release);
                self.error.store(true, Ordering::Relaxed);
            }
        }
    }
    fn apply(&self, mixer: &mut Mixer) {
        // MIDI and voice updates preserve their receive order; no lock/allocation here.
        if self.panic.swap(false, Ordering::AcqRel) {
            // Bounded drain even if MIDI producers keep sending.
            for _ in 0..2048 {
                let Some(e)=self.queue.pop() else {break;};
                Self::apply_patch(e,mixer);
            }
            for synth in &mut mixer.synths {
                synth.panic();
            }
        } else {
            for _ in 0..2048 {
                let Some(e) = self.queue.pop() else {
                    break;
                };
                if e.patch.is_some(){Self::apply_patch(e,mixer);}
                else if e.port == 2 {
                    for synth in &mut mixer.synths {
                        synth.panic();
                    }
                } else {
                    mixer.synths[e.port].midi(&e.bytes[..e.len]);
                }
            }
        }
    }
    fn apply_patch(event:Event,mixer:&mut Mixer){
        if let Some((channel,patch))=event.patch {if let Instrument::Ym2612(s)=&mut mixer.synths[0] {
            if channel==0 {for ch in 1..=16 {let _=s.set_patch(ch,patch);}}
            else {let _=s.set_patch(channel,patch);}
        }}
    }

}
struct Running {
    shared: Arc<Shared>,
    stop: std::sync::mpsc::Sender<()>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
#[derive(Default)]
pub struct Rack(Mutex<Option<Running>>, Arc<Mutex<[FmPatch; 16]>>);
#[derive(Serialize)]
pub struct Status {
    pub enabled: bool,
    active_channels: [u32; 2],
    error: bool,
}
impl Rack {
    pub fn patches(&self) -> [FmPatch; 16] {
        *self.1.lock().unwrap()
    }
    pub fn set_patch(&self, channel: u8, patch: FmPatch) -> Result<(), String> {
        patch.validate()?;
        if !(1..=16).contains(&channel) {
            return Err("MIDI channel must be 1–16".into());
        }
        let guard = self.0.lock().unwrap();
        if let Some(r)=guard.as_ref(){r.shared.enqueue_patch(channel,patch)?;}
        else {self.1.lock().unwrap()[(channel-1) as usize]=patch;}
        Ok(())
    }

    pub fn panic(&self) {
        if let Some(r) = self.0.lock().unwrap().as_ref() {
            if r.shared
                .queue
                .push(Event {
                    port: 2,
                    bytes: [0; 3],
                    len:0,patch:None,
                })
                .is_err()
            {
                r.shared.panic.store(true, Ordering::Release);
            }
        }
    }
    pub fn status(&self) -> Status {
        match self.0.lock().unwrap().as_ref() {
            Some(r) => Status {
                enabled: true,
                active_channels: std::array::from_fn(|i| {
                    r.shared.active[i].load(Ordering::Relaxed)
                }),
                error: r.shared.error.load(Ordering::Relaxed),
            },
            None => Status {
                enabled: false,
                active_channels: [0; 2],
                error: false,
            },
        }
    }
    pub fn mix(&self, volume: [f32; 2], pan: [f32; 2], master: f32) -> Result<(), String> {
        if volume
            .iter()
            .chain([&master])
            .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
            || pan
                .iter()
                .any(|v| !v.is_finite() || !(-1.0..=1.0).contains(v))
        {
            return Err("Invalid mixer settings".into());
        }
        let guard = self.0.lock().unwrap();
        let r = guard.as_ref().ok_or("Enable the native synth first")?;
        for i in 0..2 {
            r.shared.volume[i].store(volume[i].to_bits(), Ordering::Relaxed);
            r.shared.pan[i].store(pan[i].to_bits(), Ordering::Relaxed);
        }
        r.shared.master.store(master.to_bits(), Ordering::Relaxed);
        Ok(())
    }
    pub fn enable(&self, enabled: bool) -> Result<(), String> {
        let mut guard = self.0.lock().unwrap();
        if !enabled {
            guard.take();
            return Ok(());
        }
        if guard.is_some() {
            return Ok(());
        }
        #[cfg(not(target_os = "macos"))]
        return Err("The native test synth currently supports macOS only".into());
        #[cfg(target_os = "macos")]
        {
            let shared = Arc::new(Shared {bank:self.1.clone(),..Shared::default()});
            for (i, patch) in self.1.lock().unwrap().iter().enumerate() {
                let _ = shared.queue.push(Event {port:0,bytes:[0;3],len:0,patch:Some((i as u8 + 1,*patch))});
            }
            let audio_shared = shared.clone();
            let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
            let (stop_tx, stop_rx) = std::sync::mpsc::channel();
            let thread = std::thread::spawn(move || match start(audio_shared) {
                Ok((stream, inputs)) => {
                    let _ = ready_tx.send(Ok(()));
                    let _ = stop_rx.recv();
                    drop(inputs);
                    drop(stream);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            });
            match ready_rx.recv().map_err(|e| e.to_string())? {
                Ok(()) => {
                    *guard = Some(Running {
                        shared,
                        stop: stop_tx,
                        thread: Some(thread),
                    });
                    Ok(())
                }
                Err(e) => {
                    let _ = thread.join();
                    Err(e)
                }
            }
        }
    }
}
#[cfg(target_os = "macos")]
fn start(
    shared: Arc<Shared>,
) -> Result<(cpal::Stream, Vec<midir::MidiInputConnection<()>>), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use midir::os::unix::VirtualInput;
    let device = cpal::default_host()
        .default_output_device()
        .ok_or("No default audio output device")?;
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => build::<f32>(&device, &config.clone().into(), shared.clone()),
        cpal::SampleFormat::I16 => build::<i16>(&device, &config.clone().into(), shared.clone()),
        cpal::SampleFormat::U16 => build::<u16>(&device, &config.clone().into(), shared.clone()),
        format => return Err(format!("Unsupported output sample format: {format:?}")),
    }?;
    let mut inputs = Vec::new();
    for (port, name) in ["Tetorica YM2612", "Tetorica Sega PSG"].iter().enumerate() {
        let mut input = midir::MidiInput::new(name).map_err(|e| e.to_string())?;
        input.ignore(midir::Ignore::None);
        let queue = shared.clone();
        inputs.push(
            input
                .create_virtual(name, move |_, bytes, _| queue.receive(port, bytes), ())
                .map_err(|e| e.to_string())?,
        );
    }
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, inputs))
}
#[cfg(target_os = "macos")]
fn build<T: cpal::SizedSample + cpal::FromSample<f32>>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    shared: Arc<Shared>,
) -> Result<cpal::Stream, String> {
    use cpal::traits::DeviceTrait;
    let mut mixer = Mixer::new(config.sample_rate.0)?;
    let channels = config.channels as usize;
    let errors = shared.clone();
    device
        .build_output_stream(
            config,
            move |buffer: &mut [T], _| {
                shared.apply(&mut mixer);
                let volume = std::array::from_fn(|i| {
                    f32::from_bits(shared.volume[i].load(Ordering::Relaxed))
                });
                let pan =
                    std::array::from_fn(|i| f32::from_bits(shared.pan[i].load(Ordering::Relaxed)));
                let master = f32::from_bits(shared.master.load(Ordering::Relaxed));
                for frame in buffer.chunks_mut(channels) {
                    let pcm = mixer.sample(volume, pan, master);
                    for (i, sample) in frame.iter_mut().enumerate() {
                        *sample = T::from_sample(if channels == 1 {
                            (pcm[0] + pcm[1]) * 0.5
                        } else if i < 2 {
                            pcm[i]
                        } else {
                            0.0
                        });
                    }
                }
                for i in 0..2 {
                    shared.active[i].store(mixer.synths[i].active(), Ordering::Relaxed);
                }
            },
            move |_| {
                errors.error.store(true, Ordering::Relaxed);
                errors.panic.store(true, Ordering::Release);
            },
            None,
        )
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn synth_enable(enabled: bool, state: tauri::State<Rack>) -> Result<(), String> {
    state.enable(enabled)
}
#[tauri::command]
pub fn synth_mix(
    volume: [f32; 2],
    pan: [f32; 2],
    master: f32,
    state: tauri::State<Rack>,
) -> Result<(), String> {
    state.mix(volume, pan, master)
}
#[tauri::command]
pub fn synth_status(state: tauri::State<Rack>) -> Status {
    state.status()
}
#[tauri::command]
pub fn synth_panic(state: tauri::State<Rack>) {
    state.panic();
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sysex_and_notes_keep_order_in_one_audio_block_and_share_bank() {
        let shared=Shared::default();let mut actual=Mixer::new(48000).unwrap();let mut expected=Mixer::new(48000).unwrap();
        let a=FmPatch::default();let mut b=a;b.algorithm=7;b.operators[3].tl=8;b.operators[1].ssg=14;
        for (patch,note) in [(a,60),(b,67)] {
            shared.receive(0,&crate::voice_sysex::encode(1,patch));shared.receive(0,&[0x90,note,100]);
            if let Instrument::Ym2612(s)=&mut expected.synths[0]{s.set_patch(1,patch).unwrap();}
            expected.synths[0].midi(&[0x90,note,100]);
        }
        shared.apply(&mut actual);
        for _ in 0..4800 {assert_eq!(actual.sample([0.7;2],[0.0;2],0.35),expected.sample([0.7;2],[0.0;2],0.35));}
        assert_eq!(shared.bank.lock().unwrap()[0],b);assert_eq!(shared.bank.lock().unwrap()[1],a);
        shared.receive(0,&crate::voice_sysex::encode(0,b));assert_eq!(*shared.bank.lock().unwrap(),[b;16]);
        shared.receive(0,&crate::voice_sysex::encode(2,a));assert_eq!(shared.bank.lock().unwrap()[1],a);
        shared.receive(1,&crate::voice_sysex::encode(0,a));assert_eq!(shared.bank.lock().unwrap()[0],b);
        shared.receive(0,&crate::voice_sysex::encode(0,a));assert_eq!(*shared.bank.lock().unwrap(),[a;16]);
        shared.apply(&mut actual);
        // The two already sounding notes retain their snapshots after all-channel updates.
        for _ in 0..4800 {assert_eq!(actual.sample([0.7;2],[0.0;2],0.35),expected.sample([0.7;2],[0.0;2],0.35));}
    }
    #[test]
    fn javascript_fixture_reaches_native_channel_bank() {
        let shared=Shared::default();
        shared.receive(0,include_bytes!("../../test/fixtures/fm2612-bell.syx"));
        let bank=shared.bank.lock().unwrap();
        for patch in bank.iter(){assert_eq!(patch.algorithm,4);assert_eq!(patch.feedback,1);assert_eq!(patch.operators[0].multi,6);assert_eq!(patch.operators[1].tl,16);assert_eq!(patch.operators[2].tl,127);}
    }
    #[test]
    fn queue_accepts_two_and_three_byte_channel_controls_for_both_internal_ports() {
        let shared=Shared::default();
        for port in [0,1] {for message in [vec![0xc0,30],vec![0xd0,80],vec![0xa0,60,80],vec![0xe0,0,64],vec![0xb0,7,100]] {
            shared.receive(port,&message);let event=shared.queue.pop().unwrap();assert_eq!(&event.bytes[..event.len],message.as_slice());
        }}
        shared.receive(0,&[0xd0,128]);shared.receive(0,&[0xd0,10,20]);shared.receive(2,&[0x90,60,90]);assert!(shared.queue.is_empty());
    }
    #[test]
    fn patch_bank_and_queue_are_validated_without_audio_device() {
        let rack = Rack::default();
        let mut patch = FmPatch::default();
        patch.algorithm = 7;
        rack.set_patch(2, patch).unwrap();
        assert_eq!(rack.patches()[1].algorithm, 7);
        assert_eq!(rack.patches()[0].algorithm, 4);
        patch.feedback = 8;
        assert!(rack.set_patch(2, patch).is_err());
        assert_eq!(rack.patches()[1].feedback, 0);
        let shared = Shared::default();
        let mut mixer = Mixer::new(48000).unwrap();
        patch.feedback = 0;
        shared.enqueue_patch(2, patch).unwrap();
        shared.receive(0, &[0x91, 69, 100]);
        shared.apply(&mut mixer);
        assert_eq!(mixer.synths[0].active(), 2);
    }
    #[test]
    fn overflow_panics_and_drains_without_stuck_notes() {
        let s = Shared::default();
        let mut m = Mixer::new(48000).unwrap();
        s.receive(0, &[0x90, 60, 90]);
        s.apply(&mut m);
        assert_eq!(m.synths[0].active(), 1);
        for _ in 0..2050 {
            s.receive(1, &[0x91, 64, 90]);
        }
        s.apply(&mut m);
        assert!(s.error.load(Ordering::Relaxed));
        assert_eq!(m.synths[0].active(), 0);
        assert_eq!(m.synths[1].active(), 0);
        s.receive(1, &[0x91, 64, 90]);
        s.apply(&mut m);
        assert_eq!(m.synths[1].active(), 2);
    }
    #[test]
    fn stop_then_new_run_preserves_the_first_note() {
        let s = Shared::default();
        let mut m = Mixer::new(48000).unwrap();
        s.receive(0, &[0x90, 60, 90]);
        s.queue
            .push(Event {
                port: 2,
                bytes: [0; 3],
                    len:0,patch:None,
            })
            .ok()
            .unwrap();
        s.receive(1, &[0x91, 64, 90]);
        s.apply(&mut m);
        assert_eq!(m.synths[0].active(), 0);
        assert_eq!(m.synths[1].active(), 2);
    }
    #[test]
    fn invalid_settings_and_short_messages() {
        let r = Rack::default();
        assert!(r.mix([f32::NAN, 0.0], [0.0; 2], 0.3).is_err());
        let s = Shared::default();
        s.receive(0, &[0xfa]);
        s.receive(0, &[0x90, 255, 90]);
        assert!(s.queue.is_empty());
    }
}

#[tauri::command]
pub fn synth_patches(state: tauri::State<Rack>) -> [FmPatch; 16] {
    state.patches()
}
#[tauri::command]
pub fn synth_set_patch(
    channel: u8,
    patch: FmPatch,
    state: tauri::State<Rack>,
) -> Result<(), String> {
    state.set_patch(channel, patch)
}
