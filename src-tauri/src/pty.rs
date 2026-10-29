// ==========================================
// Terminal: a real Claude Code session in a Pulse tab
// ==========================================
// Each tab is a pseudo-terminal running the owner's login shell, which runs
// `claude --agent <lead>` (or plain `claude`) in ~ with their normal environment and sign-in.
// The only command a tab can start is claude; what the owner types goes to it as keystrokes.
// Output streams to the window as `pty://data` events; `pty://exit` says a tab's session ended.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

const MAX_TABS: usize = 8;
const WRITE_MAX: usize = 64 * 1024;
const SHELL_FALLBACK: &str = "/bin/zsh";

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub(crate) struct Ptys {
    next: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

#[derive(Clone, Serialize)]
struct PtyData {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: u32,
}

// The owner's login shell when it is a real, listed shell; zsh otherwise.
fn login_shell() -> String {
    let listed = std::fs::read_to_string("/etc/shells").unwrap_or_default();
    std::env::var("SHELL")
        .ok()
        .filter(|s| s.starts_with('/') && listed.lines().any(|l| l.trim() == s) && std::path::Path::new(s).is_file())
        .unwrap_or_else(|| SHELL_FALLBACK.to_string())
}

// What the shell runs. The agent is already checked against the org (a slug, so no quoting
// is needed); keys exported by the shell's own startup files are unset so a stray key can't
// switch billing.
pub(crate) fn shell_command(agent: Option<&str>) -> String {
    let run = match agent {
        Some(a) => format!("exec claude --agent {}", a),
        None => "exec claude".to_string(),
    };
    format!("unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; {}", run)
}

// Splits bytes into the longest valid UTF-8 prefix and the bytes of a character cut off at
// the end of a read, which are carried into the next read.
pub(crate) fn utf8_split(buf: &[u8]) -> (String, Vec<u8>) {
    match std::str::from_utf8(buf) {
        Ok(s) => (s.to_string(), Vec::new()),
        Err(e) if e.error_len().is_none() => {
            let (ok, rest) = buf.split_at(e.valid_up_to());
            (String::from_utf8_lossy(ok).into_owned(), rest.to_vec())
        }
        Err(_) => (String::from_utf8_lossy(buf).into_owned(), Vec::new()),
    }
}

#[tauri::command]
pub(crate) fn pty_open(app: AppHandle, ptys: State<'_, Ptys>, agent: Option<String>, cols: u16, rows: u16) -> Result<u32, String> {
    let agent = super::command::check_agent(agent.as_deref())?;
    if ptys.sessions.lock().map_err(|e| e.to_string())?.len() >= MAX_TABS {
        return Err(format!("close a tab first (at most {} at once)", MAX_TABS));
    }
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.clamp(5, 500), cols: cols.clamp(20, 1000), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("could not open a terminal: {}", e))?;

    let mut cmd = CommandBuilder::new(login_shell());
    cmd.args(["-l", "-i", "-c", &shell_command(agent.as_deref())]);
    cmd.cwd(&home);
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if std::env::var("LANG").is_err() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("could not start claude: {}", e))?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = ptys.next.fetch_add(1, Ordering::Relaxed) + 1;
    ptys.sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, Session { master: pair.master, writer, child });

    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let (text, rest) = utf8_split(&carry);
                    carry = rest;
                    if !text.is_empty() {
                        let _ = app.emit("pty://data", PtyData { id, data: text });
                    }
                }
            }
        }
        let _ = app.emit("pty://exit", PtyExit { id });
    });
    Ok(id)
}

#[tauri::command]
pub(crate) fn pty_write(ptys: State<'_, Ptys>, id: u32, data: String) -> Result<(), String> {
    if data.len() > WRITE_MAX {
        return Err("too much input at once".to_string());
    }
    let mut sessions = ptys.sessions.lock().map_err(|e| e.to_string())?;
    let s = sessions.get_mut(&id).ok_or("that terminal has closed")?;
    s.writer.write_all(data.as_bytes()).and_then(|_| s.writer.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn pty_resize(ptys: State<'_, Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = ptys.sessions.lock().map_err(|e| e.to_string())?;
    let s = sessions.get(&id).ok_or("that terminal has closed")?;
    s.master
        .resize(PtySize { rows: rows.clamp(5, 500), cols: cols.clamp(20, 1000), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

fn hang_up(mut s: Session) {
    // The shell leads its own session: a hangup to the group ends claude and what it started.
    #[cfg(unix)]
    if let Some(pid) = s.child.process_id() {
        extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        const SIGHUP: i32 = 1;
        if pid > 1 && pid <= i32::MAX as u32 {
            unsafe { kill(-(pid as i32), SIGHUP) };
        }
    }
    let _ = s.child.kill();
    let _ = s.child.wait();
}

#[tauri::command]
pub(crate) fn pty_close(ptys: State<'_, Ptys>, id: u32) -> Result<(), String> {
    let s = ptys.sessions.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(s) = s {
        std::thread::spawn(move || hang_up(s));
    }
    Ok(())
}

// Quitting Pulse ends every tab's session.
pub(crate) fn close_all(ptys: &Ptys) {
    if let Ok(mut sessions) = ptys.sessions.lock() {
        for (_, s) in sessions.drain() {
            hang_up(s);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_runs_only_claude() {
        assert_eq!(shell_command(Some("acme-lead")), "unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; exec claude --agent acme-lead");
        assert_eq!(shell_command(None), "unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; exec claude");
    }

    #[test]
    fn utf8_cut_mid_character_is_carried() {
        let bytes = "ok ✓".as_bytes();
        let (text, rest) = utf8_split(&bytes[..bytes.len() - 1]);
        assert_eq!(text, "ok ");
        assert_eq!(rest, &bytes[3..bytes.len() - 1]);
        let mut next = rest.clone();
        next.push(bytes[bytes.len() - 1]);
        assert_eq!(utf8_split(&next), ("✓".to_string(), vec![]));
        // Bytes that are invalid (not just cut off) never stall the stream.
        assert_eq!(utf8_split(&[0xff, b'a']).1, Vec::<u8>::new());
    }

    #[test]
    fn a_real_pty_runs_a_shell() {
        let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "printf pulse-pty-ok"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut out = String::new();
        let mut buf = [0u8; 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            out.push_str(&String::from_utf8_lossy(&buf[..n]));
            if out.contains("pulse-pty-ok") {
                break;
            }
        }
        child.wait().unwrap();
        assert!(out.contains("pulse-pty-ok"));
    }
}
