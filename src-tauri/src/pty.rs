// ==========================================
// Terminal tabs: a real terminal attached to a tmux session
// ==========================================
// Each Roo terminal tab is a pseudo-terminal running `tmux attach -t =<session>`. The session
// itself lives in tmux (terminals.rs starts it), so closing a tab or quitting Roo only detaches:
// whatever runs inside keeps running, and Terminal.app can attach to the same session.
//
// Output is sent to the tab as raw bytes over its own IPC channel (an ArrayBuffer in the page;
// xterm.js decodes UTF-8 across chunks itself). Reads are coalesced for a few milliseconds so a
// burst of output is one message, not hundreds, while a single keystroke's echo still goes at once.
// When the client ends (the session ended, or it was detached elsewhere) the channel gets
// `{"exit": true}`.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

const MAX_TABS: usize = 24;
const WRITE_MAX: usize = 256 * 1024; // a big paste arrives in one write
const SHELL_FALLBACK: &str = "/bin/zsh";
const COALESCE: Duration = Duration::from_millis(4);
const FLUSH_AT: usize = 256 * 1024;

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

// The owner's login shell when it is a real, listed shell; zsh otherwise.
pub(crate) fn login_shell() -> String {
    let listed = std::fs::read_to_string("/etc/shells").unwrap_or_default();
    std::env::var("SHELL")
        .ok()
        .filter(|s| s.starts_with('/') && listed.lines().any(|l| l.trim() == s) && std::path::Path::new(s).is_file())
        .unwrap_or_else(|| SHELL_FALLBACK.to_string())
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.clamp(5, 500), cols: cols.clamp(20, 1000), pixel_width: 0, pixel_height: 0 }
}

// Collects chunks from `rx` into batches: the first chunk of a batch waits for nothing; after it,
// more is gathered while it keeps arriving within `window`, up to `max` bytes. Returns None when
// the reader has finished and everything was handed out.
pub(crate) fn next_batch(rx: &mpsc::Receiver<Vec<u8>>, window: Duration, max: usize) -> Option<Vec<u8>> {
    let mut out = rx.recv().ok()?;
    let started = Instant::now();
    while out.len() < max {
        let left = window.saturating_sub(started.elapsed());
        match rx.recv_timeout(left) {
            Ok(more) => out.extend_from_slice(&more),
            Err(_) => break,
        }
    }
    Some(out)
}

// Starts `cmd` on a new pty and streams its output to `channel`. Returns the tab's pty id.
pub(crate) fn spawn(ptys: &Ptys, cmd: CommandBuilder, cols: u16, rows: u16, channel: Channel<InvokeResponseBody>) -> Result<u32, String> {
    if ptys.sessions.lock().map_err(|e| e.to_string())?.len() >= MAX_TABS {
        return Err(format!("close a tab first (at most {} at once)", MAX_TABS));
    }
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| format!("could not open a terminal: {}", e))?;
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("could not start the terminal: {}", e))?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = ptys.next.fetch_add(1, Ordering::Relaxed) + 1;
    ptys.sessions.lock().map_err(|e| e.to_string())?.insert(id, Session { master: pair.master, writer, child });

    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    std::thread::spawn(move || {
        while let Some(batch) = next_batch(&rx, COALESCE, FLUSH_AT) {
            if channel.send(InvokeResponseBody::Raw(batch)).is_err() {
                break;
            }
        }
        let _ = channel.send(InvokeResponseBody::Json("{\"exit\":true}".to_string()));
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
    s.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

fn hang_up(mut s: Session) {
    // The pty's process (a tmux client) leads its own session: a hangup detaches it. The tmux
    // session it was attached to, and everything running in it, carries on.
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

// Closing a tab detaches it (see hang_up); the session keeps running.
#[tauri::command]
pub(crate) fn pty_close(ptys: State<'_, Ptys>, id: u32) -> Result<(), String> {
    let s = ptys.sessions.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(s) = s {
        std::thread::spawn(move || hang_up(s));
    }
    Ok(())
}

// Quitting Roo detaches every tab.
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
    fn batches_coalesce_a_burst_but_never_hold_the_first_chunk() {
        let (tx, rx) = mpsc::channel();
        tx.send(b"a".to_vec()).unwrap();
        tx.send(b"b".to_vec()).unwrap();
        tx.send(b"c".to_vec()).unwrap();
        assert_eq!(next_batch(&rx, Duration::from_millis(20), 1024).unwrap(), b"abc");
        // A lone chunk comes back after at most the window.
        tx.send(b"x".to_vec()).unwrap();
        let t = Instant::now();
        assert_eq!(next_batch(&rx, Duration::from_millis(5), 1024).unwrap(), b"x");
        assert!(t.elapsed() < Duration::from_millis(200));
        // A batch stops growing at `max`.
        tx.send(vec![1; 8]).unwrap();
        tx.send(vec![2; 8]).unwrap();
        tx.send(vec![3; 8]).unwrap();
        assert_eq!(next_batch(&rx, Duration::from_millis(20), 10).unwrap().len(), 16);
        assert_eq!(next_batch(&rx, Duration::from_millis(1), 10).unwrap(), vec![3; 8]);
        drop(tx);
        assert!(next_batch(&rx, Duration::from_millis(1), 10).is_none());
    }

    #[test]
    fn a_real_pty_runs_a_shell() {
        let pair = native_pty_system().openpty(size(80, 24)).unwrap();
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
