mod clock;
use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde::Serialize;
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
    off: Option<Instant>,
    follow: bool,
    last_clock: Option<Instant>,
    error: Option<String>,
}
impl Session {
    fn stop(&mut self) -> Result<(), String> {
        if self.off.is_some() {
            if let Some(out) = &mut self.output {
                out.send(&[0x80, 60, 0]).map_err(|e| e.to_string())?;
            }
            self.off = None;
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
#[tauri::command]
fn connect_input(id: String, state: tauri::State<AppState>) -> Result<(), String> {
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
                    s.clock.receive(timestamp, bytes[0]);
                    if bytes[0] == 0xf8 {
                        s.last_clock = Some(Instant::now());
                    }
                    // Output is handled by worker, never by this callback.
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
    let next = output
        .connect(&port, "Tetorica Notes")
        .map_err(|e| e.to_string())?;
    let mut s = state.session.lock().unwrap();
    s.stop()?;
    s.output = Some(Box::new(next));
    Ok(())
}
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
    s.follow = false;
    s.stop()
}
#[tauri::command]
fn disconnect(state: tauri::State<AppState>) -> Result<(), String> {
    state.input.lock().unwrap().take();
    let mut s = state.session.lock().unwrap();
    s.follow = false;
    let result = s.stop();
    s.output = None;
    s.clock = Default::default();
    s.last_clock = None;
    result
}
#[derive(Serialize)]
struct Snapshot {
    clock: clock::Clock,
    output_connected: bool,
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
        .invoke_handler(tauri::generate_handler![
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
