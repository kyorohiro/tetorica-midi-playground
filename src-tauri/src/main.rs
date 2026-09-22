mod voice_sysex;
mod midi_message;
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
    output_id: Option<String>,
    routes: HashMap<u64, Box<dyn NoteOutput>>,
    route_ids: HashMap<String,u64>,
    next_route: u64,
    off: Option<Instant>,
    follow: bool,
    last_clock: Option<Instant>,
    error: Option<String>,
    run_id: u64,
    external_clock: bool,
    external_started: bool,
    transport_stop: bool,
    notes: HashMap<(u64, u8, u8), Option<Instant>>,
    pedals: HashMap<(u64, u8, u8), Option<u64>>,
    note_owners: HashMap<(u64, u8, u8), u64>,
    note_ticks: HashMap<(u64, u8, u8), u64>,
    audition: HashMap<(u8,u8),u64>,
}
impl Session {
    fn send_to(&mut self, route:u64, bytes:&[u8])->Result<(),String> {
        let out=if route==0 { self.output.as_mut() } else { self.routes.get_mut(&route) };
        out.ok_or("MIDI output is not connected")?.send(bytes)
    }

    fn release_notes(&mut self, keys:Vec<(u64,u8,u8)>)->Result<(),String> {
        let mut error=None;
        for (route,channel,note) in keys {
            if let Err(e)=self.send_to(route,&[0x80|channel,note,0]) {error.get_or_insert(e);continue;}
            let key=(route,channel,note);
            self.notes.remove(&key);self.note_owners.remove(&key);self.note_ticks.remove(&key);
        }
        error.map_or(Ok(()),Err)
    }
    fn release_pedals(&mut self, keys: Vec<(u64,u8,u8)>) -> Result<(),String> {
        let mut error=None;
        for (route,channel,controller) in keys {
            if let Err(e)=self.send_to(route,&[0xb0|channel,controller,0]) {error.get_or_insert(e);}
            else {self.pedals.remove(&(route,channel,controller));}
        }
        error.map_or(Ok(()),Err)
    }
    fn routed_midi(&mut self,route:u64,run_id:u64,owner:Option<u64>,bytes:&[u8],tracked:bool)->Result<(),String>{
        if route==0 {return self.script_midi(run_id,owner,bytes,tracked);}
        if tracked {return Err("Routed raw MIDI must be untracked".into());}
        if run_id!=self.run_id || (self.external_clock && (!self.external_started || !self.clock.running || self.transport_stop)) {return Err("Run was stopped".into());}
        midi_message::validate(bytes)?;
        self.send_to(route,bytes)
    }
    fn script_midi(&mut self, run_id:u64, owner:Option<u64>, bytes:&[u8], tracked:bool) -> Result<(),String> {
        if run_id!=self.run_id || (self.external_clock && (!self.external_started || !self.clock.running || self.transport_stop)) {
            return Err("Run was stopped".into());
        }
        midi_message::validate(bytes)?;
        if !tracked {return self.send_to(0,bytes);}
        if bytes[0]>=0xf0 {return Err("Tracked MIDI requires a channel message".into());}
        let kind=bytes[0]&0xf0;
        let channel=bytes[0]&15;
        let key=(0,channel,bytes[1]);
        if kind==0x90 && bytes[2]>0 {
            if self.notes.contains_key(&key) || self.audition.contains_key(&(channel,bytes[1])) {
                self.send_to(0,&[0x80|channel,bytes[1],0])?;
            }
            self.send_to(0,bytes)?;
            self.notes.insert(key,None);self.note_ticks.remove(&key);
            self.audition.remove(&(channel,bytes[1]));self.note_owners.remove(&key);
            if let Some(id)=owner {self.note_owners.insert(key,id);}
        } else if kind==0x80 || kind==0x90 {
            // An old loop's noteOff must not release a newer owner's same pitch.
            if owner.is_some() && ((self.notes.contains_key(&key) && self.note_owners.get(&key).copied()!=owner) || self.audition.contains_key(&(channel,bytes[1]))) {return Ok(());}
            self.send_to(0,bytes)?;
            self.notes.remove(&key);self.note_ticks.remove(&key);self.note_owners.remove(&key);
            self.audition.remove(&(channel,bytes[1]));
        } else {
            self.send_to(0,bytes)?;
            if kind==0xb0 {
                match bytes[1] {
                    64 | 66 => {if bytes[2]>=64 {self.pedals.insert(key,owner);} else {self.pedals.remove(&key);}},
                    121 => self.pedals.retain(|(route,ch,_),_| *route!=0 || *ch!=channel),
                    120 | 123 => {
                        self.notes.retain(|(route,ch,_),_| *route!=0 || *ch!=channel);
                        self.note_ticks.retain(|(route,ch,_),_| *route!=0 || *ch!=channel);
                        self.note_owners.retain(|(route,ch,_),_| *route!=0 || *ch!=channel);
                        self.audition.retain(|(ch,_),_| *ch!=channel);
                    },
                    _ => {},
                }
            }
        }
        Ok(())
    }
    fn stop(&mut self) -> Result<(), String> {
        let mut error=self.release_pedals(self.pedals.keys().copied().collect()).err();
        let keys:Vec<_>=self.audition.keys().copied().collect();
        for (channel,note) in keys {
            if let Err(e)=self.send_to(0,&[0x80|channel,note,0]) {error.get_or_insert(e);}
            else {self.audition.remove(&(channel,note));}
        }
        if self.off.is_some() {
            if let Err(e)=self.send_to(0,&[0x80,60,0]) {error.get_or_insert(e);}
            else {self.off=None;}
        }
        if let Err(e)=self.release_notes(self.notes.keys().copied().collect()) {error.get_or_insert(e);}
        error.map_or(Ok(()),Err)
    }
    fn script_note(
        &mut self,
        run_id: u64,
        note: u8,
        channel: u8,
        velocity: u8,
        duration_ms: u64,
    ) -> Result<(), String> { self.script_note_to(0,run_id,note,channel,velocity,duration_ms) }
    fn script_note_to(&mut self, route:u64, run_id:u64, note:u8, channel:u8, velocity:u8, duration_ms:u64)->Result<(),String> {
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
        let key=(route,channel,note);
        let was_audition=route==0 && self.audition.contains_key(&(channel,note));
        if was_audition || self.notes.contains_key(&key) { self.send_to(route,&[0x80|channel,note,0])?; }
        self.send_to(route,&[0x90|channel,note,velocity])?;
        if route==0 {self.audition.remove(&(channel,note));}
        self.note_owners.remove(&key);
        self.note_ticks.remove(&key);
        self.notes.insert(key,Some(Instant::now()+Duration::from_millis(duration_ms)));
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
            self.note_owners.insert((0, channel - 1, note), owner);
        }
        Ok(())
    }
    fn routed_note(&mut self,route:u64,run_id:u64,owner:Option<u64>,note:u8,channel:u8,velocity:u8,duration_ms:u64,duration_beats:Option<f64>)->Result<(),String> {
    if let Some(beats)=duration_beats {
        if !self.external_clock || !beats.is_finite() || beats<=0.0 || beats>128.0 {return Err("Invalid external note duration".into());}
    }
    self.script_note_to(route,run_id,note,channel,velocity,duration_ms)?;
    let key=(route,channel-1,note);
    if let Some(owner)=owner {self.note_owners.insert(key,owner);}
    if let Some(beats)=duration_beats {let ticks=self.clock.ticks; self.note_ticks.insert(key,ticks+(beats*24.0).ceil() as u64);}
    Ok(())
    }
    fn audition_on(&mut self, id:u64, note:u8, channel:u8, velocity:u8)->Result<(),String> {
        if note>127 || !(1..=16).contains(&channel) || !(1..=127).contains(&velocity) {return Err("Invalid keyboard note".into());}
        let key=(channel-1,note);
        let out=self.output.as_mut().ok_or("Connect a MIDI output first")?;
        if self.notes.contains_key(&(0,key.0,key.1))||self.audition.contains_key(&key){out.send(&[0x80|key.0,note,0])?;}
        out.send(&[0x90|key.0,note,velocity])?;
        self.notes.remove(&(0,key.0,key.1));self.note_ticks.remove(&(0,key.0,key.1));self.note_owners.remove(&(0,key.0,key.1));
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
        self.note_ticks.insert((0,channel-1,note),self.clock.ticks+(beats*24.0).ceil() as u64);
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
        let pedals=self.pedals.iter().filter(|(_,id)|**id==Some(owner)).map(|(key,_)|*key).collect();
        let pedal_result=self.release_pedals(pedals);
        let note_result=self.release_notes(keys);
        pedal_result.and(note_result)
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
            .filter(|(key, deadline)| self.note_ticks.get(key).map_or(deadline.is_some_and(|time| time <= now), |tick| self.clock.ticks >= *tick))
            .map(|(key, _)| *key)
            .collect();
        self.release_notes(keys)
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
fn connect_output(id: String, state: tauri::State<AppState>, rack:tauri::State<test_synth::Rack>) -> Result<(), String> {
    let internal=match id.as_str() {
        "internal:ym2612"=>Some("Tetorica YM2612"),
        "internal:sega-psg"=>Some("Tetorica Sega PSG"),
        _=>None,
    };
    if internal.is_some(){rack.enable(true)?;}
    let output = MidiOutput::new("Tetorica Notes").map_err(|e| e.to_string())?;
    let id=if let Some(name)=internal {
        let descriptions=output.ports().iter().map(|p|Ok(Port{id:p.id(),name:output.port_name(p).map_err(|e|e.to_string())?})).collect::<Result<Vec<_>,String>>()?;
        descriptions[resolve_output_port(&descriptions,name,None)?].id.clone()
    }else{id};
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
    s.routes.clear(); s.route_ids.clear();
    s.output_id=Some(id);
    s.output = Some(Box::new(next));
    s.output_name = Some(name);
    Ok(())
}
fn resolve_output_port(ports:&[Port],wanted:&str,id:Option<&str>)->Result<usize,String> {
    let matches:Vec<_>=ports.iter().enumerate().filter(|(_,p)|p.name==wanted&&id.is_none_or(|id|p.id==id)).map(|(i,_)|i).collect();
    if matches.len()!=1 {return Err(format!("MIDI output '{}' has {} matches; refresh and reassign the destination",wanted,matches.len()));}
    Ok(matches[0])
}
#[tauri::command]
fn script_output(run_id:u64, name:String, port_id:Option<String>, state:tauri::State<AppState>, rack:tauri::State<test_synth::Rack>)->Result<u64,String> {
    let mut s=state.session.lock().unwrap();
    if s.run_id!=run_id {return Err("Run was stopped".into());}
    let output=MidiOutput::new("Tetorica Script").map_err(|e|e.to_string())?;
    let internal=match (port_id.is_none(),name.as_str()) { (true,"tetorica-ym2612")=>Some("Tetorica YM2612"),(true,"tetorica-sega-psg")=>Some("Tetorica Sega PSG"),_=>None };
    if internal.is_some() && !rack.status().enabled {return Err("Call await enableSoundChip(...) first".into());}
    let wanted=internal.unwrap_or(&name);
    let ports=output.ports();
    let descriptions:Vec<_>=ports.iter().map(|p|Ok(Port{id:p.id(),name:output.port_name(p).map_err(|e|e.to_string())?})).collect::<Result<_,String>>()?;
    let index=resolve_output_port(&descriptions,wanted,port_id.as_deref())?;
    let id=ports[index].id();
    if s.output_id.as_ref()==Some(&id) {return Ok(0);}
    if let Some(route)=s.route_ids.get(&id) {return Ok(*route);}
    if s.routes.len()>=16 {return Err("At most 16 script outputs".into());}
    let connection=output.connect(&ports[index],"Tetorica Script").map_err(|e|e.to_string())?;
    s.next_route+=1; let route=s.next_route;
    s.routes.insert(route,Box::new(connection));s.route_ids.insert(id,route);
    Ok(route)
}
#[tauri::command]
fn enable_sound_chip(run_id:u64, chip:String,state:tauri::State<AppState>,rack:tauri::State<test_synth::Rack>)->Result<(),String> {
    if !matches!(chip.as_str(),"ym2612"|"sega-psg") {return Err("Unknown sound chip".into());}
    if state.session.lock().unwrap().run_id!=run_id {return Err("Run was stopped".into());}
    rack.enable(true)?;
    if state.session.lock().unwrap().run_id!=run_id {return Err("Run was stopped".into());}
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
    let result=s.stop();
    if result.is_ok() {s.routes.clear(); s.route_ids.clear();}
    result
}
#[tauri::command]
fn disconnect(state: tauri::State<AppState>) -> Result<(), String> {
    state.input.lock().unwrap().take();
    let mut s = state.session.lock().unwrap();
    s.follow = false;
    s.run_id += 1;
    let result = s.stop();
    s.routes.clear(); s.route_ids.clear(); s.output_id=None;
    s.notes.clear(); s.pedals.clear(); s.note_owners.clear(); s.note_ticks.clear(); s.audition.clear(); s.off=None;
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
    s.routes.clear(); s.route_ids.clear();
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
    route: Option<u64>,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let mut s=state.session.lock().unwrap();
    s.routed_note(route.unwrap_or(0),run_id,owner,note,channel,velocity,duration_ms,duration_beats)
}
#[tauri::command]
fn send_midi(run_id:u64, owner:Option<u64>, bytes:Vec<u8>, tracked:bool, route:Option<u64>, state:tauri::State<AppState>) -> Result<(),String> {
    state.session.lock().unwrap().routed_midi(route.unwrap_or(0),run_id,owner,&bytes,tracked)
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
    script_output_count: usize,
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
        script_output_count: s.routes.len(),
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
            test_synth::synth_patches,
            test_synth::synth_set_patch,
            test_synth::synth_panic,
            keyboard_on,
            keyboard_off,
            begin_run,
            play_midi_note,
            send_midi,
            script_output,
            enable_sound_chip,
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
    fn voice_sysex_uses_its_route_and_rejects_stopped_runs() {
        let selected=Arc::new(Mutex::new(Vec::new()));let routed=Arc::new(Mutex::new(Vec::new()));
        let mut s=Session {output:Some(Box::new(Fake(selected.clone()))),..Default::default()};
        s.routes.insert(8,Box::new(Fake(routed.clone())));
        let bytes=crate::voice_sysex::encode(0,synth_core::FmPatch::default());
        s.routed_midi(8,0,None,&bytes,false).unwrap();
        assert!(selected.lock().unwrap().is_empty());assert_eq!(routed.lock().unwrap()[0],bytes);
        assert!(s.routed_midi(8,1,None,&bytes,false).is_err());
        assert!(s.routed_midi(9,0,None,&bytes,false).is_err());
        assert!(s.routed_midi(8,0,None,&bytes,true).is_err());
        assert_eq!(routed.lock().unwrap().len(),1);
    }
    #[test]
    fn primitive_notes_hold_until_off_and_stop_and_preserve_play_deadlines() {
        let messages=Arc::new(Mutex::new(Vec::new()));
        let mut s=Session::default();s.output=Some(Box::new(Fake(messages.clone())));
        s.script_midi(0,Some(3),&[0x90,60,100],true).unwrap();
        s.expire(Instant::now()+Duration::from_secs(100)).unwrap();
        assert!(s.notes.contains_key(&(0,0,60)));
        s.routed_note(0,0,Some(4),60,1,90,50,None).unwrap();
        s.release_owner(0,3).unwrap();assert!(s.notes.contains_key(&(0,0,60)));
        s.script_midi(0,Some(3),&[0x80,60,0],true).unwrap();assert!(s.notes.contains_key(&(0,0,60)));
        s.expire(Instant::now()+Duration::from_secs(1)).unwrap();assert!(s.notes.is_empty());
        s.script_midi(0,None,&[0x90,64,90],true).unwrap();
        s.script_midi(0,None,&[0x80,64,27],true).unwrap();
        assert_eq!(messages.lock().unwrap().last().unwrap(),&vec![0x80,64,27]);
        s.script_midi(0,None,&[0x91,67,90],true).unwrap();s.stop().unwrap();assert!(s.notes.is_empty());
        assert_eq!(messages.lock().unwrap().last().unwrap(),&vec![0x81,67,0]);
    }
    #[test]
    fn primitives_release_loop_notes_and_pedals_and_reject_stale_runs() {
        let messages=Arc::new(Mutex::new(Vec::new()));
        let mut s=Session::default();s.output=Some(Box::new(Fake(messages.clone())));
        s.script_midi(0,Some(1),&[0xb0,64,127],true).unwrap();
        s.script_midi(0,Some(1),&[0x90,60,100],true).unwrap();
        s.script_midi(0,Some(2),&[0x91,64,100],true).unwrap();
        s.release_owner(0,1).unwrap();
        assert!(!s.notes.contains_key(&(0,0,60)));assert!(s.notes.contains_key(&(0,1,64)));assert!(s.pedals.is_empty());
        assert!(messages.lock().unwrap().contains(&vec![0xb0,64,0]));
        s.script_midi(0,None,&[0xb1,66,127],true).unwrap();
        s.run_id+=1;s.stop().unwrap();
        assert!(s.notes.is_empty());assert!(s.pedals.is_empty());
        let count=messages.lock().unwrap().len();
        assert!(s.script_midi(0,None,&[0x90,60,90],true).is_err());
        assert!(s.script_midi(0,None,&[0xfa],false).is_err());
        assert_eq!(messages.lock().unwrap().len(),count);
    }
    #[test]
    fn midi_system_messages_validation_and_raw_cleanup_contract() {
        let messages=Arc::new(Mutex::new(Vec::new()));
        let mut s=Session::default();s.output=Some(Box::new(Fake(messages.clone())));
        for bytes in [vec![0xc0,30],vec![0xe0,0,64],vec![0xa0,60,80],vec![0xd0,80],vec![0xf1,0],vec![0xf2,0,1],vec![0xf3,0],vec![0xf6],vec![0xf8],vec![0xfa],vec![0xfb],vec![0xfc],vec![0xfe],vec![0xff],vec![0xf0,0x7d,1,0xf7]] {
            s.script_midi(0,None,&bytes,false).unwrap();assert_eq!(messages.lock().unwrap().last().unwrap(),&bytes);
        }
        for bytes in [vec![],vec![60,90],vec![0x90,60],vec![0x90,60,128],vec![0xc0,1,2],vec![0xf4],vec![0xf5],vec![0xf7],vec![0xf9],vec![0xfd],vec![0xf0,1],vec![0xf0,0xff,0xf7],vec![0xf8,0xfa]] {assert!(s.script_midi(0,None,&bytes,false).is_err());}
        assert!(s.script_midi(0,None,&vec![0;65537],false).is_err());
        s.script_midi(0,None,&[0x90,60,100],false).unwrap();
        let count=messages.lock().unwrap().len();s.stop().unwrap();assert_eq!(messages.lock().unwrap().len(),count);
    }
    #[test]
    fn cc_channel_cleanup_does_not_expire_other_channels() {
        let messages=Arc::new(Mutex::new(Vec::new()));
        let mut s=Session::default();s.output=Some(Box::new(Fake(messages)));
        s.script_midi(0,Some(1),&[0x90,60,100],true).unwrap();
        s.script_midi(0,Some(2),&[0x91,60,100],true).unwrap();
        s.script_midi(0,None,&[0xb0,123,0],true).unwrap();
        assert!(!s.notes.contains_key(&(0,0,60)));assert!(s.notes.contains_key(&(0,1,60)));
        s.script_midi(0,None,&[0xb1,64,127],true).unwrap();
        s.script_midi(0,None,&[0xb1,121,0],true).unwrap();assert!(s.pedals.is_empty());
    }
    #[test]
    fn assigned_port_never_falls_back_to_another_same_name_device() {
        let ports=vec![Port{id:"a".into(),name:"Synth".into()},Port{id:"b".into(),name:"Synth".into()}];
        assert!(resolve_output_port(&ports,"Synth",None).is_err());
        assert_eq!(resolve_output_port(&ports,"Synth",Some("b")).unwrap(),1);
        assert!(resolve_output_port(&ports,"Synth",Some("missing")).is_err());
        assert!(resolve_output_port(&ports,"Renamed",Some("a")).is_err());
        assert!(resolve_output_port(&[],"Synth",Some("a")).is_err());
    }
    #[test]
    fn multiple_outputs_owners_channels_and_stale_runs() {
        let a=Arc::new(Mutex::new(Vec::new()));let b=Arc::new(Mutex::new(Vec::new()));
        let mut s=Session::default();
        s.routes.insert(1,Box::new(Fake(a.clone())));s.routes.insert(2,Box::new(Fake(b.clone())));
        s.routed_note(1,0,Some(11),60,1,90,100,None).unwrap();
        s.routed_note(1,0,Some(12),60,2,90,100,None).unwrap();
        s.routed_note(2,0,Some(13),60,1,90,100,None).unwrap();
        assert_eq!(s.notes.len(),3);
        s.release_owner(0,11).unwrap();assert_eq!(s.notes.len(),2);
        assert_eq!(b.lock().unwrap().len(),1);
        s.routed_note(2,0,Some(14),60,1,90,100,None).unwrap();
        s.release_owner(0,13).unwrap();assert!(s.notes.contains_key(&(2,0,60)));
        s.run_id=1;assert!(s.routed_note(1,0,None,61,1,90,100,None).is_err());
        s.stop().unwrap();assert!(s.notes.is_empty());
        assert_eq!(a.lock().unwrap().last().unwrap(),&vec![0x81,60,0]);
        assert_eq!(b.lock().unwrap().last().unwrap(),&vec![0x80,60,0]);
    }
    #[test]
    fn routed_notes_follow_external_ticks_and_timeout() {
        let mut s=Session {external_clock:true,external_started:true,last_clock:Some(Instant::now()),..Default::default()};
        s.clock.running=true;
        for route in [1,2] {s.routes.insert(route,Box::new(Fake(Arc::new(Mutex::new(Vec::new())))));}
        s.routed_note(1,0,None,60,1,90,10000,Some(0.5)).unwrap();
        s.routed_note(2,0,None,60,1,90,10000,Some(4.0)).unwrap();
        s.clock.ticks=12;s.expire(Instant::now()).unwrap();
        assert_eq!(s.notes.len(),1);assert!(s.notes.contains_key(&(2,0,60)));
        s.expire(Instant::now()+Duration::from_secs(2)).unwrap();assert!(s.notes.is_empty());
    }
    #[test]
    fn failed_output_does_not_block_other_note_offs() {
        struct Broken;
        impl NoteOutput for Broken {fn send(&mut self,_:&[u8])->Result<(),String>{Err("unplugged".into())}}
        let mut s=Session::default();let messages=Arc::new(Mutex::new(Vec::new()));
        s.routes.insert(1,Box::new(Broken));s.routes.insert(2,Box::new(Fake(messages.clone())));
        s.notes.insert((1,0,60),Some(Instant::now()));s.notes.insert((2,0,60),Some(Instant::now()));
        assert!(s.stop().is_err());assert!(!s.notes.contains_key(&(2,0,60)));
        assert_eq!(messages.lock().unwrap().as_slice(),&[vec![0x80,60,0]]);
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
        s.release_owner(0,1).unwrap();assert_eq!(s.note_ticks.get(&(0,0,60)),Some(&192));
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
        assert!(s.notes.contains_key(&(0,0, 60)));
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
        let voice=crate::voice_sysex::encode(0,synth_core::FmPatch::default());
        for message in [
            voice.as_slice(),
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
