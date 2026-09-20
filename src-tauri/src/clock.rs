use serde::Serialize;

#[derive(Default, Clone, Serialize)]
pub struct Clock {
    pub running: bool,
    pub ticks: u64,
    pub bpm: Option<f64>,
    #[serde(skip)]
    last: Option<u64>,
}
impl Clock {
    // Timestamps are microseconds within this input connection only.
    pub fn receive(&mut self, timestamp: u64, byte: u8) {
        match byte {
            0xfa => {
                self.running = true;
                self.ticks = 0;
                self.last = None;
                self.bpm = None;
            }
            0xfb => {
                self.running = true;
                self.last = None;
            }
            0xfc => {
                self.running = false;
            }
            0xf8 => {
                if let Some(previous) = self.last {
                    if let Some(delta) = timestamp
                        .checked_sub(previous)
                        .filter(|d| *d > 0 && *d < 500_000)
                    {
                        let measured = 60_000_000.0 / (24.0 * delta as f64);
                        self.bpm =
                            Some(self.bpm.map_or(measured, |old| old * 0.8 + measured * 0.2));
                    } else {
                        self.bpm = None;
                    }
                }
                self.last = Some(timestamp);
                if self.running {
                    self.ticks += 1;
                }
            }
            _ => {}
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transport_and_tempo() {
        let mut c = Clock::default();
        c.receive(0, 0xfa);
        for n in 0..24 {
            c.receive(n * 20_833, 0xf8);
        }
        assert_eq!(c.ticks, 24);
        assert!((c.bpm.unwrap() - 120.0).abs() < 0.01);
        c.receive(500_000, 0xfc);
        c.receive(520_000, 0xf8);
        assert_eq!(c.ticks, 24);
        c.receive(530_000, 0xfb);
        c.receive(540_000, 0xf8);
        assert_eq!(c.ticks, 25);
        c.receive(550_000, 0xfa);
        assert_eq!(c.ticks, 0);
    }
    #[test]
    fn invalid_timestamps_and_gap() {
        let mut c = Clock::default();
        for t in [100, 100, 50, 1_000_000] {
            c.receive(t, 0xf8);
        }
        assert!(c.bpm.is_none());
        assert_eq!(c.ticks, 0);
    }
}
