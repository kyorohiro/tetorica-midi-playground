//! Local MIDI Clock source for testing without a DAW clock master.
#[cfg(target_os = "macos")]
mod tool {
    use midir::{os::unix::VirtualOutput, MidiOutput};
    use std::{io::{self, BufRead}, sync::mpsc, time::{Duration, Instant}};

    struct Transport { bpm: f64, ticking: bool }
    impl Transport {
        fn interval(&self) -> Duration { Duration::from_secs_f64(60.0 / (self.bpm * 24.0)) }
        fn command(&mut self, line: &str) -> Result<(Option<u8>, bool), String> {
            let words: Vec<_> = line.split_whitespace().collect();
            match words.as_slice() {
                ["start"] => {self.ticking=true; Ok((Some(0xfa),false))},
                ["continue"] => {self.ticking=true; Ok((Some(0xfb),false))},
                ["stop"] => {self.ticking=false; Ok((Some(0xfc),false))},
                ["drop"] => {self.ticking=false; Ok((None,false))},
                ["quit"] => Ok((Some(0xfc),true)),
                ["bpm", value] => {
                    let bpm=value.parse::<f64>().map_err(|_| "Expected bpm 20–300")?;
                    if !bpm.is_finite() || !(20.0..=300.0).contains(&bpm) {return Err("Expected bpm 20–300".into());}
                    self.bpm=bpm; Ok((None,false))
                },
                _ => Err("Commands: start | stop | continue | bpm 90 | drop | quit".into()),
            }
        }
    }
    pub fn run() -> Result<(), Box<dyn std::error::Error>> {
        let self_test=std::env::args().skip(1).any(|arg| arg=="--self-test");
        let name=if self_test {format!("Tetorica Clock self-test {}",std::process::id())} else {"Tetorica Test Clock".into()};
        let mut output=MidiOutput::new(&name)?.create_virtual(&name)?;
        if self_test {
            use midir::{MidiInput, Ignore};
            let mut input=MidiInput::new("Tetorica Clock test receiver")?;
            input.ignore(Ignore::None);
            let port=input.ports().into_iter().find(|p| input.port_name(p).ok().as_deref()==Some(&name)).ok_or("Virtual Clock port not found")?;
            let (tx,rx)=mpsc::channel();
            let _connection=input.connect(&port,"Tetorica Clock test receiver",move |_,bytes,_| {let _=tx.send(bytes.to_vec());},())?;
            for byte in [0xfa].into_iter().chain(std::iter::repeat(0xf8).take(24)).chain([0xfc,0xfb,0xf8,0xfc]) {
                output.send(&[byte])?;
                if rx.recv_timeout(Duration::from_secs(2))? != vec![byte] {return Err("MIDI message mismatch".into());}
            }
            println!("PASS: virtual MIDI Start, 24 Clock pulses, Stop, Continue and Stop received.");
            return Ok(());
        }
        println!("MIDI source: {name}\nIn Tetorica: Refresh → Clock input → select this port → Connect input.\nChoose External MIDI, press Run, then enter start here.\nCommands: start | stop | continue | bpm 90 | drop | quit\nInitial BPM: 120. drop stops Clock WITHOUT sending Stop (timeout test).");
        let (tx,rx)=mpsc::channel();
        std::thread::spawn(move || {
            for line in io::stdin().lock().lines() {
                match line {Ok(line)=>if tx.send(line).is_err(){return},Err(_)=>break}
            }
        });
        let mut state=Transport{bpm:120.0,ticking:false};
        let mut deadline=Instant::now();
        loop {
            let wait=if state.ticking {deadline.saturating_duration_since(Instant::now())} else {Duration::from_secs(3600)};
            match rx.recv_timeout(wait) {
                Ok(line)=> match state.command(&line) {
                    Ok((byte,quit))=>{
                        if let Some(byte)=byte {output.send(&[byte])?;}
                        if quit {break;}
                        deadline=Instant::now()+state.interval();
                        println!("BPM {} · Clock {}",state.bpm,if state.ticking {"sending"} else {"paused"});
                    },
                    Err(message)=>eprintln!("{message}"),
                },
                Err(mpsc::RecvTimeoutError::Disconnected)=>{output.send(&[0xfc])?;break;},
                Err(mpsc::RecvTimeoutError::Timeout)=>if state.ticking {
                    output.send(&[0xf8])?;
                    deadline+=state.interval();
                    // Skip missed deadlines instead of emitting a burst after suspension.
                    if deadline<=Instant::now() {deadline=Instant::now()+state.interval();}
                },
            }
        }
        Ok(())
    }
    #[cfg(test)] mod tests {
        use super::*;
        #[test] fn transport_commands_and_silent_dropout() {
            let mut t=Transport{bpm:120.0,ticking:false};
            assert_eq!(t.command("start").unwrap(),(Some(0xfa),false)); assert!(t.ticking);
            assert_eq!(t.command("drop").unwrap(),(None,false)); assert!(!t.ticking);
            assert_eq!(t.command("continue").unwrap(),(Some(0xfb),false));
            assert_eq!(t.command("stop").unwrap(),(Some(0xfc),false)); assert!(!t.ticking);
            assert_eq!(t.command("quit").unwrap(),(Some(0xfc),true));
        }
        #[test] fn tempo_validation_and_24_pulses() {
            let mut t=Transport{bpm:120.0,ticking:false};
            assert!((t.interval().as_secs_f64()*24.0-0.5).abs()<0.000001);
            t.command("bpm 60").unwrap();assert!((t.interval().as_secs_f64()*24.0-1.0).abs()<0.000001);
            for line in ["bpm NaN","bpm 0","bpm 301","bpm -20","bpm 90 extra","garbage"] {assert!(t.command(line).is_err());}
            assert_eq!(t.bpm,60.0);
        }
    }
}
fn main() {
    #[cfg(target_os = "macos")]
    if let Err(error)=tool::run() {eprintln!("Clock sender: {error}"); std::process::exit(1);}
    #[cfg(not(target_os = "macos"))]
    {eprintln!("This test sender currently requires macOS virtual MIDI ports.");std::process::exit(1);}
}
