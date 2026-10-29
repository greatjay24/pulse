// ==========================================
// Voice and the front door: speak replies, listen from a global hotkey, brief on demand
// ==========================================
// Speech out is macOS's own `say` (installed voices, no paid TTS). Speech in is pulse-listen,
// a small Swift helper (src-tauri/listen) that runs the Speech framework on-device and prints
// JSON lines; its events reach every window as `pulse://listen`. The hotkey opens the small
// "listen" window (index.html#listen), which sends the transcript to the front door.

use super::{get_portfolio_dir, resolve_portfolio_file};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::str::FromStr;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

// ⌥Space belongs to ChatGPT's launcher and Claude's quick entry; ⌥⇧Space is free by default.
pub(crate) const DEFAULT_HOTKEY: &str = "Alt+Shift+Space";
const SPEAK_MAX_CHARS: usize = 4000;
const LISTEN_WINDOW: &str = "listen";
const BRIEF_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

#[derive(Default)]
pub(crate) struct Voice {
    speaking: Mutex<Option<Child>>,
    listening: Mutex<Option<(Child, Option<ChildStdin>)>>,
    hotkey: Mutex<Option<Shortcut>>,
}

// Installed voice names ("Samantha", "Eddy (English (US))"): never a flag, never a path.
pub(crate) fn is_voice_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('-')
        && s.chars().all(|c| c.is_alphanumeric() || " ()'._-".contains(c))
}

// `say` arguments for a voice and a rate (words per minute); the text goes on stdin.
pub(crate) fn say_args(voice: Option<&str>, rate: Option<u32>) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    if let Some(v) = voice.filter(|v| !v.is_empty()) {
        if !is_voice_name(v) {
            return Err("invalid voice".to_string());
        }
        args.push(format!("--voice={}", v));
    }
    if let Some(r) = rate {
        if !(80..=400).contains(&r) {
            return Err("rate must be 80 to 400 words a minute".to_string());
        }
        args.push(format!("--rate={}", r));
    }
    Ok(args)
}

fn stop_child(slot: &Mutex<Option<Child>>) {
    if let Some(mut c) = slot.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

#[tauri::command]
pub(crate) fn speak(state: tauri::State<'_, Voice>, text: String, voice: Option<String>, rate: Option<u32>) -> Result<(), String> {
    let args = say_args(voice.as_deref(), rate)?;
    let text: String = text.chars().filter(|c| *c != '\0').take(SPEAK_MAX_CHARS).collect();
    stop_child(&state.speaking);
    if text.trim().is_empty() {
        return Ok(());
    }
    let mut child = Command::new("/usr/bin/say")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start say: {}", e))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }
    *state.speaking.lock().unwrap() = Some(child);
    Ok(())
}

#[tauri::command]
pub(crate) fn stop_speaking(state: tauri::State<'_, Voice>) {
    stop_child(&state.speaking);
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub(crate) struct VoiceInfo {
    name: String,
    locale: String,
}

// `say -v ?` lines: "Eddy (English (US))   en_US    # Hello! My name is Eddy."
pub(crate) fn parse_voices(out: &str) -> Vec<VoiceInfo> {
    out.lines()
        .filter_map(|l| {
            let head = l.split('#').next()?.trim_end();
            let (name, locale) = head.rsplit_once(char::is_whitespace)?;
            let name = name.trim();
            (is_voice_name(name) && locale.contains('_')).then(|| VoiceInfo { name: name.to_string(), locale: locale.to_string() })
        })
        .collect()
}

#[tauri::command]
pub(crate) async fn list_voices() -> Result<Vec<VoiceInfo>, String> {
    let out = tauri::async_runtime::spawn_blocking(|| Command::new("/usr/bin/say").arg("-v").arg("?").output())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("could not list voices: {}", e))?;
    Ok(parse_voices(&String::from_utf8_lossy(&out.stdout)))
}

// The helper sits next to Pulse's own binary in the bundle; in development, where the build
// script leaves it.
fn listen_helper() -> Result<PathBuf, String> {
    let bundled = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("pulse-listen")));
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/pulse-listen");
    bundled
        .into_iter()
        .chain(std::iter::once(dev))
        .find(|p| p.is_file())
        .ok_or_else(|| "pulse-listen is missing: run scripts/build-listen.sh".to_string())
}

fn stop_listening_now(state: &Voice, how: &str) {
    if let Some((mut child, stdin)) = state.listening.lock().unwrap().take() {
        if let Some(mut s) = stdin {
            let _ = writeln!(s, "{}", how);
        }
        if how == "cancel" {
            let _ = child.kill();
        }
        // The reader thread reaps it after its final line.
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
}

#[tauri::command]
pub(crate) fn start_listening(app: AppHandle, state: tauri::State<'_, Voice>, locale: Option<String>) -> Result<(), String> {
    stop_listening_now(&state, "cancel");
    let mut cmd = Command::new(listen_helper()?);
    if let Some(l) = locale.filter(|l| !l.is_empty()) {
        if !(l.len() <= 16 && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')) {
            return Err("invalid locale".to_string());
        }
        cmd.args(["--locale", &l]);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start listening: {}", e))?;
    let stdout = child.stdout.take().ok_or("no output from pulse-listen")?;
    let stdin = child.stdin.take();
    *state.listening.lock().unwrap() = Some((child, stdin));
    std::thread::spawn(move || {
        for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                if v.is_object() {
                    let _ = app.emit("pulse://listen", v);
                }
            }
        }
        let _ = app.emit("pulse://listen", serde_json::json!({"type": "end"}));
    });
    Ok(())
}

// Enter: stop now and keep what was said (the helper sends its final transcript).
#[tauri::command]
pub(crate) fn stop_listening(state: tauri::State<'_, Voice>) {
    stop_listening_now(&state, "stop");
}

// Esc: drop it.
#[tauri::command]
pub(crate) fn cancel_listening(state: tauri::State<'_, Voice>) {
    stop_listening_now(&state, "cancel");
}

pub(crate) fn show_listen_panel(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LISTEN_WINDOW) {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to(LISTEN_WINDOW, "pulse://listen-open", ());
        return;
    }
    let built = WebviewWindowBuilder::new(app, LISTEN_WINDOW, WebviewUrl::App("index.html#listen".into()))
        .title("Pulse")
        .inner_size(560.0, 210.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .focused(true)
        .build();
    if let Err(e) = built {
        eprintln!("listen panel: {}", e);
    }
}

#[tauri::command]
pub(crate) async fn open_listen_panel(app: AppHandle) {
    show_listen_panel(&app);
}

#[tauri::command]
pub(crate) fn hide_listen_panel(app: AppHandle, state: tauri::State<'_, Voice>) {
    stop_listening_now(&state, "cancel");
    if let Some(w) = app.get_webview_window(LISTEN_WINDOW) {
        let _ = w.hide();
    }
}

// The listening panel's "Open in Pulse": the main window, on that run.
#[tauri::command]
pub(crate) fn open_run_in_main(app: AppHandle, run_id: String) -> Result<(), String> {
    if !super::is_run_id(&run_id) {
        return Err("invalid run id".to_string());
    }
    super::show_main_window(&app);
    let _ = app.emit_to("main", "pulse://open-run", run_id);
    Ok(())
}

// The global hotkey: one at a time, any Tauri accelerator ("Alt+Shift+Space", "Ctrl+Alt+P").
pub(crate) fn register_hotkey(app: &AppHandle, accel: &str) -> Result<String, String> {
    let shortcut = Shortcut::from_str(accel).map_err(|e| format!("not a shortcut: {}", e))?;
    let state = app.state::<Voice>();
    let mut cur = state.hotkey.lock().unwrap();
    if let Some(old) = cur.take() {
        let _ = app.global_shortcut().unregister(old);
    }
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("couldn't take {} (another app may use it): {}", accel, e))?;
    *cur = Some(shortcut);
    Ok(shortcut.into_string())
}

#[tauri::command]
pub(crate) fn set_listen_hotkey(app: AppHandle, shortcut: String) -> Result<String, String> {
    if shortcut.len() > 40 {
        return Err("not a shortcut".to_string());
    }
    register_hotkey(&app, &shortcut)
}

pub(crate) fn on_shortcut(app: &AppHandle, _shortcut: &Shortcut, state: ShortcutState) {
    if state == ShortcutState::Pressed {
        show_listen_panel(app);
    }
}

pub(crate) fn setup(app: &AppHandle) {
    if let Err(e) = register_hotkey(app, DEFAULT_HOTKEY) {
        eprintln!("hotkey: {}", e);
    }
}

pub(crate) fn close_all(state: &Voice) {
    stop_child(&state.speaking);
    stop_listening_now(state, "cancel");
}

// "Brief me": ~/portfolio/bin/pulse.py brief <kind> starts the front door on the brief and
// answers at once with the run, like ask.py.
pub(crate) fn brief_args(kind: &str) -> Result<Vec<String>, String> {
    match kind {
        "morning" | "evening" => Ok(vec!["brief".into(), kind.into(), "--source".into(), "pulse".into()]),
        _ => Err("kind: morning or evening".to_string()),
    }
}

#[tauri::command]
pub(crate) async fn pulse_brief(kind: String) -> Result<String, String> {
    let args = brief_args(&kind)?;
    let root = get_portfolio_dir()?;
    let script = resolve_portfolio_file(&root, "bin", "pulse.py").map_err(|_| "~/portfolio/bin/pulse.py is missing: update the org's bin scripts".to_string())?;
    super::command::run_ask(script, args, BRIEF_TIMEOUT).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn say_args_validate_voice_and_rate() {
        assert_eq!(say_args(None, None).unwrap(), Vec::<String>::new());
        assert_eq!(say_args(Some("Eddy (English (US))"), Some(190)).unwrap(), vec!["--voice=Eddy (English (US))", "--rate=190"]);
        assert!(say_args(Some("-o /tmp/x"), None).is_err());
        assert!(say_args(Some("a/b"), None).is_err());
        assert!(say_args(Some("x;rm"), None).is_err());
        assert!(say_args(None, Some(20)).is_err());
        assert!(say_args(None, Some(900)).is_err());
        assert_eq!(say_args(Some(""), None).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn voices_parse_from_say() {
        let out = "Albert              en_US    # Hello! My name is Albert.\nEddy (English (US)) en_US    # Hello! My name is Eddy.\nAmélie              fr_CA    # Bonjour\nbroken line\n";
        let v = parse_voices(out);
        assert_eq!(v.len(), 3);
        assert_eq!(v[1], VoiceInfo { name: "Eddy (English (US))".into(), locale: "en_US".into() });
        assert_eq!(v[2].name, "Amélie");
    }

    #[test]
    fn brief_kinds_are_fixed() {
        assert_eq!(brief_args("morning").unwrap(), vec!["brief", "morning", "--source", "pulse"]);
        assert!(brief_args("--wait").is_err());
        assert!(brief_args("noon").is_err());
    }

    #[test]
    fn default_hotkey_parses() {
        assert!(Shortcut::from_str(DEFAULT_HOTKEY).is_ok());
    }
}
