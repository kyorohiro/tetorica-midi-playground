mod synth_core;
mod test_synth;
mod clock;
use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde::Serialize;
use std::collections::HashMap;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;

trait NoteOutput: Send {
    fn send(&mut self, bytes: &[u8]) -> Result<(), String>;
}
impl NoteOutput for MidiOutputConnection {
    fn send(&mut self, bytes: &[u8]) -> Result<(), String> {
        MidiOutputConnection::send(self, bytes).map_err(|e| e.to_string())
    }
}
#[derive(Default)]
struct Session {
    clock: clock::Clock,
    output: Option<Box<dyn NoteOutput>>,
    output_name: Option<String>,
    off: Option<Instant>,
    follow: bool,
    last_clock: Option<Instant>,
    error: Option<String>,
    run_id: u64,
    external_clock: bool,
    external_started: bool,
    transport_stop: bool,
    notes: HashMap<(u8, u8), Instant>,
    note_owners: HashMap<(u8, u8), u64>,
    note_ticks: HashMap<(u8, u8), u64>,
    audition: HashMap<(u8,u8),u64>,
}
impl Session {
    fn stop(&mut self) -> Result<(), String> {
        let keys:Vec<_>=self.audition.keys().copied().collect();
        for (channel,note) in keys {if let Some(out)=&mut self.output {out.send(&[0x80|channel,note,0])?;} self.audition.remove(&(channel,note));}
        if self.off.is_some() {
            if let Some(out) = &mut self.output {
                out.send(&[0x80, 60, 0]).map_err(|e| e.to_string())?;
            }
            self.off = None;
        }
        let keys: Vec<_> = self.notes.keys().copied().collect();
        for (channel, note) in keys {
            if let Some(out) = &mut self.output {
                out.send(&[0x80 | channel, note, 0])?;
            }
            self.notes.remove(&(channel, note));
            self.note_owners.remove(&(channel, note));
            self.note_ticks.remove(&(channel, note));
        }
        Ok(())
    }
    fn script_note(
        &mut self,
        run_id: u64,
        note: u8,
        channel: u8,
        velocity: u8,
        duration_ms: u64,
    ) -> Result<(), String> {
        if run_id != self.run_id || (self.external_clock && (!self.external_started || !self.clock.running || self.transport_stop)) {
            return Err("Run was stopped".into());
        }
        if note > 127
            || !(1..=16).contains(&channel)
            || !(1..=127).contains(&velocity)
            || !(1..=10000).contains(&duration_ms)
        {
            return Err("Invalid note, channel, velocity or duration (1–10000 ms)".into());
        }
        let channel = channel - 1;
        let was_audition=self.audition.contains_key(&(channel,note));
        let out = self.output.as_mut().ok_or("Connect an output first")?;
        if was_audition || self.notes.contains_key(&(channel, note)) {
            out.send(&[0x80 | channel, note, 0])?;
        }
        out.send(&[0x90 | channel, note, velocity])?;
        self.audition.remove(&(channel,note));
        self.note_owners.remove(&(channel, note));
            self.note_ticks.remove(&(channel, note));
        self.notes.insert(
            (channel, note),
            Instant::now() + Duration::from_millis(duration_ms),
        );
        Ok(())
    }
    fn owned_note(
        &mut self,
        run_id: u64,
        owner: Option<u64>,
        note: u8,
        channel: u8,
        velocity: u8,
        duration_ms: u64,
    ) -> Result<(), String> {
        self.script_note(run_id, note, channel, velocity, duration_ms)?;
        if let Some(owner) = owner {
            self.note_owners.insert((channel - 1, note), owner);
        }
        Ok(())
    }
    fn audition_on(&mut self, id:u64, note:u8, channel:u8, velocity:u8)->Result<(),String> {
        if note>127 || !(1..=16).contains(&channel) || !(1..=127).contains(&velocity) {return Err("Invalid keyboard note".into());}
        let key=(channel-1,note);
        let out=self.output.as_mut().ok_or("Connect a MIDI output first")?;
        if self.notes.contains_key(&key)||self.audition.contains_key(&key){out.send(&[0x80|key.0,note,0])?;}
        out.send(&[0x90|key.0,note,velocity])?;
        self.notes.remove(&key);self.note_ticks.remove(&key);self.note_owners.remove(&key);
        self.audition.insert(key,id);Ok(())
    }
    fn audition_off(&mut self,id:u64)->Result<(),String>{
        let keys:Vec<_>=self.audition.iter().filter(|(_,v)|**v==id).map(|(k,_)|*k).collect();
        for key in keys {if let Some(out)=&mut self.output {out.send(&[0x80|key.0,key.1,0])?;}self.audition.remove(&key);}
        Ok(())
    }
    fn external_note(&mut self, run_id:u64, owner:Option<u64>, note:u8, channel:u8, velocity:u8, beats:f64) -> Result<(),String> {
        if !self.external_clock || !beats.is_finite() || beats<=0.0 || beats>128.0 {return Err("Invalid external note duration".into());}
        self.owned_note(run_id,owner,note,channel,velocity,10000)?;
        self.note_ticks.insert((channel-1,note),self.clock.ticks+(beats*24.0).ceil() as u64);
        Ok(())
    }
    fn release_owner(&mut self, run_id: u64, owner: u64) -> Result<(), String> {
        if run_id != self.run_id {
            return Ok(());
        }
        let keys: Vec<_> = self
            .note_owners
            .iter()
            .filter(|(_, id)| **id == owner)
            .map(|(key, _)| *key)
            .collect();
        for (channel, note) in keys {
            if let Some(out) = &mut self.output {
                out.send(&[0x80 | channel, note, 0])?;
            }
            self.notes.remove(&(channel, note));
            self.note_owners.remove(&(channel, note));
            self.note_ticks.remove(&(channel, note));
        }
        Ok(())
    }
    fn expire(&mut self, now: Instant) -> Result<(), String> {
        if self.external_clock && self.external_started && (self.transport_stop || !self.clock.running || self.last_clock.is_none_or(|t| now.saturating_duration_since(t) >= Duration::from_secs(1))) {
            self.run_id += 1;
            self.external_clock = false;
            self.external_started = false;
            self.stop()?;
        }
        let keys: Vec<_> = self
            .notes
            .iter()
            .filter(|(key, deadline)| self.note_ticks.get(key).map_or(**deadline <= now, |tick| self.clock.ticks >= *tick))
            .map(|(key, _)| *key)
            .collect();
        for (channel, note) in keys {
            if let Some(out) = &mut self.output {
                out.send(&[0x80 | channel, note, 0])?;
            }
            self.notes.remove(&(channel, note));
            self.note_owners.remove(&(channel, note));
            self.note_ticks.remove(&(channel, note));
        }
        Ok(())
    }
    fn note(&mut self) -> Result<(), String> {
        self.stop()?;
        self.output
            .as_mut()
            .ok_or("Connect an output first")?
            .send(&[0x90, 60, 90])
            .map_err(|e| e.to_string())?;
        self.off = Some(Instant::now() + Duration::from_millis(250));
        Ok(())
    }
}
#[derive(Default)]
struct AppState {
    session: Arc<Mutex<Session>>,
    input: Mutex<Option<MidiInputConnection<()>>>,
}
#[derive(Serialize)]
struct Port {
    id: String,
    name: String,
}
#[derive(Serialize)]
struct Ports {
    input: Vec<Port>,
    output: Vec<Port>,
}
#[tauri::command]
fn ports() -> Result<Ports, String> {
    let i = MidiInput::new("Tetorica list").map_err(|e| e.to_string())?;
    let o = MidiOutput::new("Tetorica list").map_err(|e| e.to_string())?;
    Ok(Ports {
        input: i
            .ports()
            .iter()
            .map(|p| Port {
                id: p.id(),
                name: i.port_name(p).unwrap_or_else(|_| "Unknown input".into()),
            })
            .collect(),
        output: o
            .ports()
            .iter()
            .map(|p| Port {
                id: p.id(),
                name: o.port_name(p).unwrap_or_else(|_| "Unknown output".into()),
            })
            .collect(),
    })
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClockEvent {
    run_id: u64,
    sequence: u64,
    byte: u8,
    timestamp_ms: f64,
}
#[tauri::command]
fn connect_input(id: String, clock_events: tauri::ipc::Channel<ClockEvent>, state: tauri::State<AppState>) -> Result<(), String> {
    // Close callbacks before taking the session lock.
    let mut connection = state.input.lock().unwrap();
    connection.take();
    {
        let mut s = state.session.lock().unwrap();
        s.clock = Default::default();
        s.last_clock = None;
        s.stop()?;
    }
    let mut input = MidiInput::new("Tetorica Clock").map_err(|e| e.to_string())?;
    input.ignore(Ignore::None);
    let port = input
        .find_port_by_id(&id)
        .ok_or("Input disappeared; refresh ports")?;
    let shared = state.session.clone();
    let origin = Instant::now();
    let mut sequence = 0;
    *connection = Some(
        input
            .connect(
                &port,
                "Tetorica Clock",
                move |timestamp, bytes, _| {
                    // MIDI realtime messages are standalone; do not interpret SysEx payloads.
                    if bytes.len() != 1 {
                        return;
                    }
                    let mut s = shared.lock().unwrap();
                    if s.external_clock && matches!(bytes[0],0xfa|0xfb) {
                        if s.external_started && bytes[0]==0xfa {
                            // Reset invalidates queued notes before asynchronous UI delivery.
                            s.transport_stop = true;
                        }
                        s.external_started=true;
                        s.last_clock=Some(Instant::now());
                    }
                    s.clock.receive(timestamp, bytes[0]);
                    if bytes[0] == 0xf8 {
                        s.last_clock = Some(Instant::now());
                    }
                    // Send transport events directly, independently of the UI snapshot poll.
                    if matches!(bytes[0], 0xf8 | 0xfa | 0xfb | 0xfc) {
                        sequence += 1;
                        let event = ClockEvent {run_id: s.run_id, sequence, byte: bytes[0], timestamp_ms: origin.elapsed().as_secs_f64()*1000.0};
                        drop(s);
                        let _ = clock_events.send(event);
                    }
                    // Note output stays on the native scheduler.
                },
                (),
            )
            .map_err(|e| e.to_string())?,
    );
    Ok(())
}
#[tauri::command]
fn connect_output(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let output = MidiOutput::new("Tetorica Notes").map_err(|e| e.to_string())?;
    let port = output
        .find_port_by_id(&id)
        .ok_or("Output disappeared; refresh ports")?;
    let name = output.port_name(&port).map_err(|e| e.to_string())?;
    let next = output
        .connect(&port, "Tetorica Notes")
        .map_err(|e| e.to_string())?;
    let mut s = state.session.lock().unwrap();
    s.run_id += 1;
    s.follow = false;
    s.stop()?;
    s.output = Some(Box::new(next));
    s.output_name = Some(name);
    Ok(())
}
#[tauri::command]
fn keyboard_on(id:u64,note:u8,channel:u8,velocity:u8,state:tauri::State<AppState>)->Result<(),String>{state.session.lock().unwrap().audition_on(id,note,channel,velocity)}
#[tauri::command]
fn keyboard_off(id:u64,state:tauri::State<AppState>)->Result<(),String>{state.session.lock().unwrap().audition_off(id)}
#[tauri::command]
fn play_note(state: tauri::State<AppState>) -> Result<(), String> {
    state.session.lock().unwrap().note()
}
#[tauri::command]
fn set_follow(enabled: bool, state: tauri::State<AppState>) -> Result<(), String> {
    let mut s = state.session.lock().unwrap();
    if enabled && s.output.is_none() {
        return Err("Connect an output first".into());
    }
    s.follow = enabled;
    if !enabled {
        s.stop()?;
    }
    Ok(())
}
#[tauri::command]
fn stop_notes(state: tauri::State<AppState>) -> Result<(), String> {
    let mut s = state.session.lock().unwrap();
    s.external_clock=false;
    s.external_started=false;
    s.run_id += 1;
    s.follow = false;
    s.stop()
}
#[tauri::command]
fn disconnect(state: tauri::State<AppState>) -> Result<(), String> {
    state.input.lock().unwrap().take();
    let mut s = state.session.lock().unwrap();
    s.follow = false;
    s.run_id += 1;
    let result = s.stop();
    s.output = None;
    s.output_name = None;
    s.clock = Default::default();
    s.last_clock = None;
    result
}
#[tauri::command]
fn begin_run(external_clock: Option<bool>, state: tauri::State<AppState>) -> Result<u64, String> {
    if external_clock.unwrap_or(false) && state.input.lock().unwrap().is_none() {return Err("Connect a Clock input first".into());}
    let mut s = state.session.lock().unwrap();
    s.run_id += 1;
    s.external_clock=external_clock.unwrap_or(false);
    s.external_started=false;
    s.transport_stop=false;
    s.follow = false;
    s.stop()?;
    if s.output.is_none() {
        return Err("Connect a MIDI output in MIDI settings first".into());
    }
    Ok(s.run_id)
}
#[tauri::command]
fn play_midi_note(
    run_id: u64,
    owner: Option<u64>,
    note: u8,
    channel: u8,
    velocity: u8,
    duration_ms: u64,
    duration_beats: Option<f64>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let mut s=state.session.lock().unwrap();
    if let Some(beats)=duration_beats {s.external_note(run_id,owner,note,channel,velocity,beats)}
    else {s.owned_note(run_id, owner, note, channel, velocity, duration_ms)}
}
#[tauri::command]
fn release_loop_notes(
    run_id: u64,
    owner: u64,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    state.session.lock().unwrap().release_owner(run_id, owner)
}
#[derive(Serialize)]
struct Snapshot {
    clock: clock::Clock,
    output_connected: bool,
    output_name: Option<String>,
    follow: bool,
    clock_present: bool,
    error: Option<String>,
}
#[tauri::command]
fn snapshot(state: tauri::State<AppState>) -> Snapshot {
    let s = state.session.lock().unwrap();
    Snapshot {
        clock: s.clock.clone(),
        output_connected: s.output.is_some(),
        output_name: s.output_name.clone(),
        follow: s.follow,
        clock_present: s
            .last_clock
            .is_some_and(|t| t.elapsed() < Duration::from_secs(1)),
        error: s.error.clone(),
    }
}
fn main() {
    let state = AppState::default();
    let shared = Arc::downgrade(&state.session);
    std::thread::spawn(move || {
        let mut previous = 0;
        loop {
            std::thread::sleep(Duration::from_millis(2));
            let Some(shared) = shared.upgrade() else {
                break;
            };
            let mut s = shared.lock().unwrap();
            if let Err(e) = s.expire(Instant::now()) {
                s.error = Some(e);
                s.follow = false;
            }
            let present = s
                .last_clock
                .is_some_and(|t| t.elapsed() < Duration::from_secs(1));
            let ticks = s.clock.ticks;
            let boundary = ticks / 24 != previous / 24;
            previous = ticks;
            let result = if s.off.is_some()
                && (s.off.unwrap() <= Instant::now()
                    || (s.follow && (!s.clock.running || !present)))
            {
                s.stop()
            } else {
                Ok(())
            };
            if let Err(e) = result {
                s.error = Some(e);
                s.follow = false;
            }
            if s.follow && s.clock.running && present && boundary && ticks > 0 {
                if let Err(e) = s.note() {
                    s.error = Some(e);
                    s.follow = false;
                }
            }
        }
    });
    tauri::Builder::default()
        .manage(state)
        .manage(test_synth::Rack::default())
        .invoke_handler(tauri::generate_handler![
            test_synth::synth_enable,
            test_synth::synth_mix,
            test_synth::synth_status,
            test_synth::synth_panic,
            keyboard_on,
            keyboard_off,
            begin_run,
            play_midi_note,
            release_loop_notes,
            ports,
            connect_input,
            connect_output,
            play_note,
            set_follow,
            stop_notes,
            disconnect,
            snapshot
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<AppState>();
                let _ = disconnect(state);
                let _ = window.state::<test_synth::Rack>().enable(false);
            }
        })
        .run(tauri::generate_context!())
        .expect("Tauri failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fake(Arc<Mutex<Vec<Vec<u8>>>>);
    impl NoteOutput for Fake {
        fn send(&mut self, bytes: &[u8]) -> Result<(), String> {
            self.0.lock().unwrap().push(bytes.to_vec());
            Ok(())
        }
    }
    #[test]
    fn keyboard_holds_polyphony_and_protects_retriggered_notes() {
        let messages=Arc::new(Mutex::new(Vec::new()));
        let mut s=Session{output:Some(Box::new(Fake(messages.clone()))),..Default::default()};
        s.audition_on(1,60,1,90).unwrap();s.audition_on(2,64,1,90).unwrap();
        s.expire(Instant::now()+Duration::from_secs(30)).unwrap();assert_eq!(s.audition.len(),2);
        s.audition_on(3,60,1,90).unwrap();s.audition_off(1).unwrap();assert_eq!(s.audition.len(),2);
        s.script_note(0,60,1,90,100).unwrap();s.audition_off(3).unwrap();assert_eq!(s.notes.len(),1);
        s.stop().unwrap();assert!(s.audition.is_empty());assert!(s.notes.is_empty());
        assert!(s.audition_on(4,128,1,90).is_err());
    }
    #[test]
    fn held_note_follows_tempo_changes_without_wall_clock_sleep() {
        // Four beats: 2 beats at 120 BPM, then 2 at 60 BPM = 3 seconds.
        let messages=Arc::new(Mutex::new(Vec::new()));
        let origin=Instant::now();
        let mut s=Session {output:Some(Box::new(Fake(messages.clone()))),external_clock:true,external_started:true,..Default::default()};
        s.clock.receive(0,0xfa);s.last_clock=Some(origin);
        s.external_note(0,None,60,1,90,4.0).unwrap();
        let mut micros=0u64;
        for pulse in 1..=96 {
            micros+=if pulse<=48 {20_833} else {41_667};
            let now=origin+Duration::from_micros(micros);
            s.clock.receive(micros,0xf8);s.last_clock=Some(now);s.expire(now).unwrap();
            assert_eq!(s.notes.is_empty(),pulse==96,"pulse {pulse}");
        }
        assert_eq!(micros,3_000_000);
        assert_eq!(*messages.lock().unwrap(),vec![vec![0x90,60,90],vec![0x80,60,0]]);
    }
    #[test]
    fn held_external_notes_stop_on_dropout_and_do_not_kill_retriggered_owners() {
        let messages=Arc::new(Mutex::new(Vec::new()));
        let origin=Instant::now();
        let mut s=Session {output:Some(Box::new(Fake(messages.clone()))),external_clock:true,external_started:true,..Default::default()};
        s.clock.running=true;s.last_clock=Some(origin);
        s.external_note(0,Some(1),60,1,90,4.0).unwrap();
        s.external_note(0,Some(2),60,1,90,8.0).unwrap();
        s.release_owner(0,1).unwrap();assert_eq!(s.note_ticks.get(&(0,60)),Some(&192));
        s.expire(origin+Duration::from_millis(999)).unwrap();assert_eq!(s.notes.len(),1);
        s.expire(origin+Duration::from_millis(1000)).unwrap();assert!(s.notes.is_empty());assert!(s.note_ticks.is_empty());
        let count=messages.lock().unwrap().len();
        s.expire(origin+Duration::from_secs(10)).unwrap();assert_eq!(messages.lock().unwrap().len(),count);
        assert!(s.external_note(0,None,64,1,90,1.0).is_err());
    }
    #[test]
    fn external_note_ends_on_pulses_not_elapsed_wall_time() {
        let messages=Arc::new(Mutex::new(Vec::new()));
        let mut s=Session {output:Some(Box::new(Fake(messages.clone()))),external_clock:true,external_started:true,..Default::default()};
        s.clock.running=true;s.last_clock=Some(Instant::now());
        s.external_note(0,Some(2),60,1,90,0.5).unwrap();
        s.clock.ticks=11;s.expire(Instant::now()).unwrap();assert_eq!(s.notes.len(),1);
        s.clock.ticks=12;s.expire(Instant::now()).unwrap();assert!(s.notes.is_empty());assert!(s.note_ticks.is_empty());
        assert_eq!(*messages.lock().unwrap(),vec![vec![0x90,60,90],vec![0x80,60,0]]);
        assert!(s.external_note(0,None,60,1,90,f64::NAN).is_err());
    }
    #[test]
    fn external_transport_releases_notes_and_rejects_queued_requests() {
        for reset in [false, true] {
            let messages = Arc::new(Mutex::new(Vec::new()));
            let mut s = Session { output: Some(Box::new(Fake(messages.clone()))), run_id: 7,
                external_clock: true, external_started: true, ..Default::default() };
            s.clock.running = true;
            s.last_clock = Some(Instant::now());
            s.script_note(7,60,1,90,10000).unwrap();
            if reset {s.transport_stop=true;} else {s.clock.running=false;}
            assert!(s.script_note(7,64,1,90,100).is_err());
            s.expire(Instant::now()).unwrap();
            assert!(s.notes.is_empty());
            assert!(s.script_note(7,64,1,90,100).is_err());
            assert!(messages.lock().unwrap().contains(&vec![0x80,60,0]));
        }
        let mut s=Session {external_clock:true,external_started:true,run_id:9,..Default::default()};
        s.clock.running=true;
        s.last_clock=Some(Instant::now()-Duration::from_secs(2));
        s.expire(Instant::now()).unwrap();assert_eq!(s.run_id,10);
    }
    #[test]
    fn owner_release_preserves_retriggered_notes_and_other_channels() {
        let messages = Arc::new(Mutex::new(Vec::new()));
        let mut s = Session {
            output: Some(Box::new(Fake(messages.clone()))),
            run_id: 3,
            ..Default::default()
        };
        s.owned_note(3, Some(1), 60, 1, 90, 10000).unwrap();
        s.owned_note(3, Some(2), 60, 1, 90, 10000).unwrap();
        s.owned_note(3, Some(1), 64, 2, 90, 10000).unwrap();
        messages.lock().unwrap().clear();
        s.release_owner(2, 1).unwrap();
        assert_eq!(s.notes.len(), 2);
        s.release_owner(3, 1).unwrap();
        assert_eq!(*messages.lock().unwrap(), vec![vec![0x81, 64, 0]]);
        assert!(s.notes.contains_key(&(0, 60)));
        s.release_owner(3, 2).unwrap();
        assert!(s.notes.is_empty());
        assert!(s.note_owners.is_empty());
        let count = messages.lock().unwrap().len();
        s.expire(Instant::now() + Duration::from_secs(20)).unwrap();
        assert_eq!(messages.lock().unwrap().len(), count);
    }
    #[test]
    fn unowned_retrigger_and_expiry_clear_previous_owner() {
        let messages = Arc::new(Mutex::new(Vec::new()));
        let mut s = Session {
            output: Some(Box::new(Fake(messages))),
            ..Default::default()
        };
        s.owned_note(0, Some(1), 60, 1, 90, 100).unwrap();
        s.script_note(0, 60, 1, 90, 100).unwrap();
        s.release_owner(0, 1).unwrap();
        assert_eq!(s.notes.len(), 1);
        s.owned_note(0, Some(2), 64, 1, 90, 100).unwrap();
        s.expire(Instant::now() + Duration::from_secs(1)).unwrap();
        assert!(s.note_owners.is_empty());
        assert!(s.notes.is_empty());
    }
    #[test]
    fn retrigger_and_stop_release_note() {
        let messages = Arc::new(Mutex::new(Vec::new()));
        let mut s = Session {
            output: Some(Box::new(Fake(messages.clone()))),
            ..Default::default()
        };
        s.note().unwrap();
        assert!(s.off.is_some());
        s.note().unwrap();
        s.stop().unwrap();
        assert!(s.off.is_none());
        assert_eq!(
            *messages.lock().unwrap(),
            vec![
                vec![0x90, 60, 90],
                vec![0x80, 60, 0],
                vec![0x90, 60, 90],
                vec![0x80, 60, 0]
            ]
        );
    }
    #[test]
    fn script_notes_expire_and_reject_stale_runs() {
        let messages = Arc::new(Mutex::new(Vec::new()));
        let mut s = Session {
            output: Some(Box::new(Fake(messages.clone()))),
            run_id: 5,
            ..Default::default()
        };
        s.script_note(5, 64, 2, 90, 250).unwrap();
        s.script_note(5, 67, 2, 90, 500).unwrap();
        assert_eq!(s.notes.len(), 2);
        s.expire(Instant::now() + Duration::from_secs(1)).unwrap();
        assert!(s.notes.is_empty());
        assert_eq!(messages.lock().unwrap().len(), 4);
        assert!(messages.lock().unwrap().contains(&vec![0x81, 64, 0]));
        s.run_id += 1;
        assert!(s.script_note(5, 60, 1, 90, 250).is_err());
        for (note, channel, velocity, duration) in [
            (128, 1, 90, 250),
            (60, 0, 90, 250),
            (60, 1, 0, 250),
            (60, 1, 90, 10001),
        ] {
            assert!(s.script_note(6, note, channel, velocity, duration).is_err());
        }
        assert_eq!(messages.lock().unwrap().len(), 4);
    }
    #[test]
    fn stop_releases_all_script_channels() {
        let messages = Arc::new(Mutex::new(Vec::new()));
        let mut s = Session {
            output: Some(Box::new(Fake(messages.clone()))),
            ..Default::default()
        };
        s.script_note(0, 60, 1, 90, 250).unwrap();
        s.script_note(0, 60, 16, 90, 250).unwrap();
        s.stop().unwrap();
        assert!(s.notes.is_empty());
        assert!(messages.lock().unwrap().contains(&vec![0x8f, 60, 0]));
    }
    #[test]
    fn no_output_is_reported_without_scheduling_note_off() {
        let mut s = Session::default();
        assert!(s.note().is_err());
        assert!(s.off.is_none());
    }
}

#[cfg(all(test, target_os = "macos"))]
mod coremidi_tests {
    use super::*;
    use midir::os::unix::VirtualInput;
    #[test]
    #[ignore = "requires a running CoreMIDI service; sends only to a private test port"]
    fn private_virtual_port_loopback() {
        let name = format!("Tetorica isolated test {}", std::process::id());
        let (tx, rx) = std::sync::mpsc::channel();
        let mut input = MidiInput::new(&name).unwrap();
        input.ignore(Ignore::None);
        let connection = input
            .create_virtual(
                &name,
                move |_, bytes, _| {
                    let _ = tx.send(bytes.to_vec());
                },
                (),
            )
            .unwrap();
        let output = MidiOutput::new("Tetorica isolated sender").unwrap();
        let port = output
            .ports()
            .into_iter()
            .find(|p| output.port_name(p).unwrap_or_default() == name)
            .expect("private port visible");
        let mut out = output.connect(&port, "Tetorica isolated sender").unwrap();
        for message in [
            &[0xfa][..],
            &[0xf8][..],
            &[0x90, 60, 90][..],
            &[0x80, 60, 0][..],
            &[0xfc][..],
        ] {
            out.send(message).unwrap();
            assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), message);
        }
        drop(out);
        drop(connection);
    }
}
