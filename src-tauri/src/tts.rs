// ==========================================
// Roo's own voice: Kokoro TTS on this Mac, kept warm
// ==========================================
// scripts/roo-tts.py is compiled in and run with the voice venv's Python (`python -I -c`), so the
// app needs no path to the script. It loads the model once and speaks sentence by sentence (the
// first plays while the next is synthesized). Commands go over its stdin as JSON lines, events
// come back on stdout; nothing listens on the network.
//
// The model lives outside the repo: ROO_VOICE_DIR, default ~/.local/share/roo-voice, holding
// venv/ (kokoro-onnx, soundfile), kokoro-v1.0.onnx and voices-v1.0.bin. If any of that is missing
// or the daemon fails, speech falls back to macOS `say` (jarvis.rs) and the reason is logged once.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const SCRIPT: &str = include_str!("../../scripts/roo-tts.py");
// After a failure, don't try the daemon again (and pay its start-up) for a while.
const RETRY_AFTER: Duration = Duration::from_secs(600);

pub(crate) const VOICES: [&str; 2] = ["british-1", "british-2"];

pub(crate) fn is_kokoro_voice(v: &str) -> bool {
    VOICES.contains(&v)
}

pub(crate) fn voice_dir() -> PathBuf {
    match std::env::var("ROO_VOICE_DIR") {
        Ok(d) if !d.trim().is_empty() => {
            let d = d.trim();
            match d.strip_prefix("~/") {
                Some(rest) => dirs::home_dir().unwrap_or_default().join(rest),
                None => PathBuf::from(d),
            }
        }
        _ => dirs::home_dir().unwrap_or_default().join(".local/share/roo-voice"),
    }
}

fn python(dir: &std::path::Path) -> PathBuf {
    dir.join("venv/bin/python3")
}

// What's missing from the voice dir, if anything.
pub(crate) fn missing(dir: &std::path::Path) -> Option<String> {
    let need = [python(dir), dir.join("kokoro-v1.0.onnx"), dir.join("voices-v1.0.bin")];
    need.iter().find(|p| !p.is_file()).map(|p| format!("{} is missing", p.display()))
}

// The command line sent to the daemon.
pub(crate) fn speak_line(id: u64, text: &str, voice: &str) -> String {
    serde_json::json!({ "op": "speak", "id": id, "text": text, "voice": voice }).to_string()
}

// What the daemon said, as far as the app cares.
#[derive(Debug, PartialEq)]
pub(crate) enum Event {
    Ready,
    Done(u64),
    Error(u64, String),
    Failed(String),
    Other,
}

pub(crate) fn parse_event(line: &str) -> Event {
    let v: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return Event::Other,
    };
    let id = v.get("id").and_then(|x| x.as_u64()).unwrap_or(0);
    let msg = v.get("message").and_then(|x| x.as_str()).unwrap_or("").to_string();
    match v.get("event").and_then(|x| x.as_str()) {
        Some("ready") => Event::Ready,
        Some("done") => Event::Done(id),
        Some("error") => Event::Error(id, msg),
        Some("failed") => Event::Failed(msg),
        _ => Event::Other,
    }
}

// What's being spoken, and what to read with `say` if Kokoro can't.
#[derive(Clone)]
pub(crate) struct Pending {
    pub id: u64,
    pub text: String,
    pub mac_voice: Option<String>,
    pub rate: Option<u32>,
}

struct Daemon {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub(crate) struct Kokoro {
    daemon: Mutex<Option<Daemon>>,
    pending: Arc<Mutex<Option<Pending>>>,
    next_id: AtomicU64,
    failed_at: Arc<Mutex<Option<Instant>>>,
    logged: Arc<AtomicBool>,
}

// Called with the text to read instead when Kokoro couldn't speak it.
pub(crate) type Fallback = Arc<dyn Fn(Pending) + Send + Sync>;

impl Kokoro {
    fn note_failure(failed_at: &Mutex<Option<Instant>>, logged: &AtomicBool, why: &str) {
        *failed_at.lock().unwrap() = Some(Instant::now());
        if !logged.swap(true, Ordering::SeqCst) {
            eprintln!("voice: Roo British unavailable ({}); using macOS say", why);
        }
    }

    // Kokoro can be tried now: installed, and no recent failure.
    pub(crate) fn usable(&self) -> bool {
        let recent = self.failed_at.lock().unwrap().map(|t| t.elapsed() < RETRY_AFTER).unwrap_or(false);
        if recent {
            return false;
        }
        if let Some(why) = missing(&voice_dir()) {
            Self::note_failure(&self.failed_at, &self.logged, &why);
            return false;
        }
        true
    }

    pub(crate) fn is_speaking(&self) -> bool {
        self.pending.lock().unwrap().is_some()
    }

    // Start the daemon if it isn't running (loads the model in the background).
    pub(crate) fn warm(&self, fallback: Fallback) -> Result<(), String> {
        let mut slot = self.daemon.lock().unwrap();
        if let Some(d) = slot.as_mut() {
            if matches!(d.child.try_wait(), Ok(None)) {
                return Ok(());
            }
            *slot = None;
        }
        if !self.usable() {
            return Err("Roo British is not available".to_string());
        }
        let dir = voice_dir();
        let mut child = Command::new(python(&dir))
            .arg("-I")
            .arg("-c")
            .arg(SCRIPT)
            .env("ROO_VOICE_DIR", &dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| {
                let why = format!("could not start: {}", e);
                Self::note_failure(&self.failed_at, &self.logged, &why);
                why
            })?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let pending = self.pending.clone();
        let failed_at = self.failed_at.clone();
        let logged = self.logged.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                match parse_event(&line) {
                    Event::Done(id) => {
                        let mut p = pending.lock().unwrap();
                        if p.as_ref().map(|x| x.id) == Some(id) {
                            *p = None;
                        }
                    }
                    Event::Error(id, msg) => {
                        Self::note_failure(&failed_at, &logged, &msg);
                        let mut p = pending.lock().unwrap();
                        if p.as_ref().map(|x| x.id) == Some(id) {
                            if let Some(p) = p.take() {
                                fallback(p);
                            }
                        }
                    }
                    Event::Failed(msg) => Self::note_failure(&failed_at, &logged, &msg),
                    Event::Ready | Event::Other => {}
                }
            }
            // The daemon is gone: whatever it was about to say goes to `say`.
            if let Some(p) = pending.lock().unwrap().take() {
                Self::note_failure(&failed_at, &logged, "the voice process exited");
                fallback(p);
            }
        });
        *slot = Some(Daemon { child, stdin });
        Ok(())
    }

    pub(crate) fn new_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst) + 1
    }

    // Hand a line to the daemon; if it can't be reached, drop it and remember the failure.
    fn send(&self, line: &str) -> Result<(), String> {
        let mut slot = self.daemon.lock().unwrap();
        let sent = slot.as_mut().map(|d| writeln!(d.stdin, "{}", line).and_then(|_| d.stdin.flush()));
        if matches!(sent, Some(Ok(()))) {
            return Ok(());
        }
        if let Some(mut d) = slot.take() {
            let _ = d.child.kill();
            let _ = d.child.wait();
        }
        Self::note_failure(&self.failed_at, &self.logged, "could not reach the voice process");
        Err("voice process unreachable".to_string())
    }

    // Speak a whole text with a Roo voice. Err means it couldn't be handed over: use `say`.
    pub(crate) fn speak(&self, text: &str, voice: &str, mac_voice: Option<String>, rate: Option<u32>, fallback: Fallback) -> Result<(), String> {
        self.warm(fallback)?;
        let id = self.new_id();
        *self.pending.lock().unwrap() = Some(Pending { id, text: text.to_string(), mac_voice, rate });
        self.send(&speak_line(id, text, voice)).inspect_err(|_| *self.pending.lock().unwrap() = None)
    }

    // A reply arriving in pieces: begin, then append(text) as it streams in, then end. Each
    // sentence is spoken as soon as it's complete. If the daemon fails, `say` reads what arrived.
    pub(crate) fn begin(&self, voice: &str, mac_voice: Option<String>, rate: Option<u32>, fallback: Fallback) -> Result<u64, String> {
        self.warm(fallback)?;
        let id = self.new_id();
        *self.pending.lock().unwrap() = Some(Pending { id, text: String::new(), mac_voice, rate });
        let line = serde_json::json!({ "op": "begin", "id": id, "voice": voice }).to_string();
        self.send(&line).inspect_err(|_| *self.pending.lock().unwrap() = None)?;
        Ok(id)
    }

    pub(crate) fn append(&self, id: u64, text: &str) {
        {
            let mut p = self.pending.lock().unwrap();
            match p.as_mut().filter(|p| p.id == id) {
                Some(p) => p.text.push_str(text),
                None => return, // stopped or replaced
            }
        }
        let line = serde_json::json!({ "op": "append", "id": id, "text": text }).to_string();
        let _ = self.send(&line);
    }

    pub(crate) fn end(&self, id: u64) {
        if self.pending.lock().unwrap().as_ref().map(|p| p.id) == Some(id) {
            let _ = self.send(&serde_json::json!({ "op": "end", "id": id }).to_string());
        }
    }

    // Silence now: the daemon kills the audio and drops the queue; the model stays loaded.
    pub(crate) fn stop(&self) {
        *self.pending.lock().unwrap() = None;
        if let Some(d) = self.daemon.lock().unwrap().as_mut() {
            let _ = writeln!(d.stdin, "{{\"op\":\"stop\"}}").and_then(|_| d.stdin.flush());
        }
    }

    // App quitting: stop, close stdin (the daemon cleans up and exits), then make sure.
    pub(crate) fn shutdown(&self) {
        self.stop();
        if let Some(Daemon { mut child, stdin }) = self.daemon.lock().unwrap().take() {
            drop(stdin);
            let until = Instant::now() + Duration::from_millis(400);
            while Instant::now() < until && matches!(child.try_wait(), Ok(None)) {
                std::thread::sleep(Duration::from_millis(20));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[derive(serde::Serialize)]
pub(crate) struct VoiceEngineStatus {
    pub installed: bool,
    pub reason: Option<String>,
}

pub(crate) fn status() -> VoiceEngineStatus {
    let reason = missing(&voice_dir());
    VoiceEngineStatus { installed: reason.is_none(), reason }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_parse() {
        assert_eq!(parse_event(r#"{"event":"ready"}"#), Event::Ready);
        assert_eq!(parse_event(r#"{"event":"done","id":7}"#), Event::Done(7));
        assert_eq!(parse_event(r#"{"event":"error","id":3,"message":"boom"}"#), Event::Error(3, "boom".into()));
        assert_eq!(parse_event(r#"{"event":"failed","message":"no model"}"#), Event::Failed("no model".into()));
        assert_eq!(parse_event("not json"), Event::Other);
    }

    #[test]
    fn speak_line_is_one_json_line() {
        let l = speak_line(5, "Hi.\nSecond line \"quoted\"", "british-2");
        assert!(!l.contains('\n'));
        let v: serde_json::Value = serde_json::from_str(&l).unwrap();
        assert_eq!(v["op"], "speak");
        assert_eq!(v["id"], 5);
        assert_eq!(v["voice"], "british-2");
        assert_eq!(v["text"], "Hi.\nSecond line \"quoted\"");
    }

    #[test]
    fn only_known_voices() {
        assert!(is_kokoro_voice("british-1"));
        assert!(is_kokoro_voice("british-2"));
        assert!(!is_kokoro_voice("Samantha"));
        assert!(!is_kokoro_voice(""));
    }

    #[test]
    fn missing_names_the_first_absent_file() {
        let dir = std::env::temp_dir().join(format!("roo-voice-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        assert!(missing(&dir).unwrap().contains("python3"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn script_is_embedded() {
        assert!(SCRIPT.contains("def serve()"));
        assert!(SCRIPT.contains("\"british-1\""));
    }
}
