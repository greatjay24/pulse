// ==========================================
// Voice and the front door: speak replies, listen from a global hotkey, brief on demand
// ==========================================
// Speech out is Roo's own British voice (Kokoro, local: tts.rs) or macOS's `say` (installed
// voices), which is also the fallback whenever Kokoro isn't installed or fails. Speech in is pulse-listen,
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
    kokoro: super::tts::Kokoro,
    // A reply streamed to `say`: its sentences, read one after another as they arrive.
    say_stream: Mutex<Option<SayStream>>,
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

fn clean(text: &str) -> String {
    text.chars().filter(|c| *c != '\0').take(SPEAK_MAX_CHARS).collect()
}

// Read `text` with `say`, replacing whatever `say` was reading.
fn say_now(slot: &Mutex<Option<Child>>, text: &str, voice: Option<&str>, rate: Option<u32>) -> Result<(), String> {
    let args = say_args(voice, rate)?;
    stop_child(slot);
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
    *slot.lock().unwrap() = Some(child);
    Ok(())
}

// When Kokoro can't finish something, `say` reads it instead.
fn fallback(app: &AppHandle) -> super::tts::Fallback {
    let app = app.clone();
    std::sync::Arc::new(move |p: super::tts::Pending| {
        let state = app.state::<Voice>();
        let _ = say_now(&state.speaking, &p.text, p.mac_voice.as_deref(), p.rate);
    })
}

pub(crate) struct SayStream {
    id: u64,
    voice: Option<String>,
    rate: Option<u32>,
    queue: std::collections::VecDeque<String>,
    ended: bool,
}

// Reads a streamed reply with `say`, a sentence at a time, until it ends or is stopped (stop
// clears the stream and kills the current `say`).
fn say_stream_worker(app: AppHandle, id: u64) {
    let tick = std::time::Duration::from_millis(30);
    loop {
        let state = app.state::<Voice>();
        let next = {
            let mut slot = state.say_stream.lock().unwrap();
            match slot.as_mut() {
                // Whatever has queued up goes in one `say`: fewer gaps between sentences.
                Some(st) if st.id == id => match st.queue.is_empty() {
                    false => Some((st.queue.drain(..).collect::<Vec<_>>().join(" "), st.voice.clone(), st.rate)),
                    true if st.ended => {
                        *slot = None;
                        return;
                    }
                    true => None,
                },
                _ => return, // stopped or replaced
            }
        };
        let Some((text, voice, rate)) = next else {
            std::thread::sleep(tick);
            continue;
        };
        if say_now(&state.speaking, &text, voice.as_deref(), rate).is_err() {
            continue;
        }
        // Wait for this sentence (or a stop) before the next.
        loop {
            {
                let mut child = state.speaking.lock().unwrap();
                match child.as_mut().map(|c| c.try_wait()) {
                    Some(Ok(None)) => {}
                    _ => break,
                }
            }
            std::thread::sleep(tick);
        }
    }
}

// Everything stops: `say`, Roo's voice and its queue, a half-collected stream.
fn silence(state: &Voice) {
    stop_child(&state.speaking);
    state.kokoro.stop();
    *state.say_stream.lock().unwrap() = None;
}

// engine: "british-1" / "british-2" (Roo's voice) or "mac" (`say` with `voice` and `rate`).
#[tauri::command]
pub(crate) fn speak(app: AppHandle, state: tauri::State<'_, Voice>, text: String, voice: Option<String>, rate: Option<u32>, engine: Option<String>) -> Result<(), String> {
    say_args(voice.as_deref(), rate)?;
    let text = clean(&text);
    silence(&state);
    if text.trim().is_empty() {
        return Ok(());
    }
    if let Some(e) = engine.as_deref().filter(|e| super::tts::is_kokoro_voice(e)) {
        if state.kokoro.speak(&text, e, voice.clone(), rate, fallback(&app)).is_ok() {
            return Ok(());
        }
    }
    say_now(&state.speaking, &text, voice.as_deref(), rate)
}

// A reply arriving in pieces (streamed reply text): begin, append as text comes, end. Each
// sentence is spoken as soon as it's complete, with Roo's voice or with `say`.
#[tauri::command]
pub(crate) fn speak_begin(app: AppHandle, state: tauri::State<'_, Voice>, voice: Option<String>, rate: Option<u32>, engine: Option<String>) -> Result<u64, String> {
    say_args(voice.as_deref(), rate)?;
    silence(&state);
    if let Some(e) = engine.as_deref().filter(|e| super::tts::is_kokoro_voice(e)) {
        if let Ok(id) = state.kokoro.begin(e, voice.clone(), rate, fallback(&app)) {
            return Ok(id);
        }
    }
    let id = state.kokoro.new_id();
    *state.say_stream.lock().unwrap() = Some(SayStream { id, voice, rate, queue: Default::default(), ended: false });
    std::thread::spawn(move || say_stream_worker(app, id));
    Ok(id)
}

// Text appended here is already cleaned and cut at sentence ends (SpokenStream in voiceText.ts).
#[tauri::command]
pub(crate) fn speak_append(state: tauri::State<'_, Voice>, id: u64, text: String) {
    let text = clean(&text);
    if let Some(st) = state.say_stream.lock().unwrap().as_mut().filter(|st| st.id == id) {
        if !text.trim().is_empty() && st.queue.len() < 200 {
            st.queue.push_back(text);
        }
        return;
    }
    state.kokoro.append(id, &text);
}

#[tauri::command]
pub(crate) fn speak_end(state: tauri::State<'_, Voice>, id: u64) {
    if let Some(st) = state.say_stream.lock().unwrap().as_mut().filter(|st| st.id == id) {
        st.ended = true;
        return;
    }
    state.kokoro.end(id);
}

// Something is being read out (by either engine).
pub(crate) fn is_speaking(state: &Voice) -> bool {
    if state.kokoro.is_speaking() || state.say_stream.lock().unwrap().is_some() {
        return true;
    }
    let mut slot = state.speaking.lock().unwrap();
    match slot.as_mut().map(|c| c.try_wait()) {
        Some(Ok(None)) => true,
        Some(_) => {
            *slot = None;
            false
        }
        None => false,
    }
}

#[tauri::command]
pub(crate) fn stop_speaking(state: tauri::State<'_, Voice>) {
    silence(&state);
}

// Load Roo's voice ahead of the first reply (the model takes about a second).
#[tauri::command]
pub(crate) fn voice_warm(app: AppHandle, state: tauri::State<'_, Voice>) -> Result<(), String> {
    state.kokoro.warm(fallback(&app))
}

#[tauri::command]
pub(crate) fn voice_engine_status() -> super::tts::VoiceEngineStatus {
    super::tts::status()
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

// The helper sits next to Roo's own binary in the bundle; in development, where the build
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
pub(crate) fn start_listening(app: AppHandle, state: tauri::State<'_, Voice>, locale: Option<String>, pause: Option<f64>, max: Option<u32>) -> Result<(), String> {
    let mut cmd = Command::new(listen_helper()?);
    cmd.args(listen_args(locale.as_deref(), pause, max)?);
    stop_listening_now(&state, "cancel");
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

// pulse-listen's flags. pause: seconds of silence that send (0.6 to 10), or 0 for press-to-send,
// where only the hotkey or Enter sends; max: the longest one listen may run, in seconds.
pub(crate) fn listen_args(locale: Option<&str>, pause: Option<f64>, max: Option<u32>) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    if let Some(l) = locale.filter(|l| !l.is_empty()) {
        if !(l.len() <= 16 && l.starts_with(|c: char| c.is_ascii_alphabetic()) && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')) {
            return Err("invalid locale".to_string());
        }
        args.extend(["--locale".to_string(), l.to_string()]);
    }
    if let Some(p) = pause {
        if !(p == 0.0 || (0.6..=10.0).contains(&p)) {
            return Err("pause must be 0 (press to send) or 0.6 to 10 seconds".to_string());
        }
        args.extend(["--pause".to_string(), format!("{}", p)]);
    }
    if let Some(m) = max {
        if !(10..=600).contains(&m) {
            return Err("max must be 10 to 600 seconds".to_string());
        }
        args.extend(["--max".to_string(), m.to_string()]);
    }
    Ok(args)
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
    open_panel(app, false);
}

// The hotkey while the panel is up doesn't start over: the panel decides (press-to-send sends,
// a finished reply starts a new listen). Released matters to hold-to-talk.
fn open_panel(app: &AppHandle, from_hotkey: bool) {
    if let Some(w) = app.get_webview_window(LISTEN_WINDOW) {
        if from_hotkey && w.is_visible().unwrap_or(false) {
            let _ = app.emit_to(LISTEN_WINDOW, "pulse://listen-hotkey", "pressed");
            return;
        }
        place_on_active_screen(app, &w);
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to(LISTEN_WINDOW, "pulse://listen-open", ());
        return;
    }
    let built = WebviewWindowBuilder::new(app, LISTEN_WINDOW, WebviewUrl::App("index.html#listen".into()))
        .title("Roo")
        .inner_size(560.0, 210.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .visible_on_all_workspaces(true)
        .focused(true)
        .build();
    match built {
        Ok(w) => place_on_active_screen(app, &w),
        Err(e) => eprintln!("listen panel: {}", e),
    }
}

// The panel follows Jay: it joins every Space (so opening it never jumps back to the desktop it
// was first made on) and centres on the screen the pointer is on, in its upper third.
fn place_on_active_screen(app: &AppHandle, w: &tauri::WebviewWindow) {
    let _ = w.set_visible_on_all_workspaces(true);
    let Ok(cursor) = app.cursor_position() else { return };
    let Ok(Some(m)) = app.monitor_from_point(cursor.x, cursor.y) else { return };
    let Ok(size) = w.outer_size() else { return };
    let (x, y) = panel_origin((m.position().x, m.position().y), (m.size().width, m.size().height), (size.width, size.height));
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
}

// Top-left corner for a panel of `panel` size on a monitor at `origin` with `screen` size
// (all physical pixels): centred across, a third of the way down.
pub(crate) fn panel_origin(origin: (i32, i32), screen: (u32, u32), panel: (u32, u32)) -> (i32, i32) {
    let x = origin.0 + (screen.0 as i32 - panel.0 as i32) / 2;
    let y = origin.1 + (screen.1 as i32 - panel.1 as i32) / 3;
    (x, y)
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

// The listening panel's "Open in Roo": the main window, on that run.
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
    match state {
        ShortcutState::Pressed => open_panel(app, true),
        ShortcutState::Released => {
            let _ = app.emit_to(LISTEN_WINDOW, "pulse://listen-hotkey", "released");
        }
    }
}

pub(crate) fn setup(app: &AppHandle) {
    if let Err(e) = register_hotkey(app, DEFAULT_HOTKEY) {
        eprintln!("hotkey: {}", e);
    }
}

pub(crate) fn close_all(state: &Voice) {
    stop_child(&state.speaking);
    state.kokoro.shutdown();
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
    fn panel_lands_on_the_given_screen() {
        // Main 1512x982 retina at 2x = 3024x1964 physical; panel 1120x420.
        assert_eq!(panel_origin((0, 0), (3024, 1964), (1120, 420)), (952, 514));
        // A second screen to the left, and one above with negative coordinates.
        assert_eq!(panel_origin((-1920, 0), (1920, 1080), (560, 210)), (-1240, 290));
        assert_eq!(panel_origin((0, -1080), (1920, 1080), (560, 210)), (680, -790));
    }

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
    fn listen_args_validate_pause_and_max() {
        assert_eq!(listen_args(None, None, None).unwrap(), Vec::<String>::new());
        assert_eq!(listen_args(Some("en-US"), Some(0.0), Some(180)).unwrap(), vec!["--locale", "en-US", "--pause", "0", "--max", "180"]);
        assert_eq!(listen_args(None, Some(2.5), None).unwrap(), vec!["--pause", "2.5"]);
        assert!(listen_args(None, Some(0.3), None).is_err());
        assert!(listen_args(None, Some(f64::NAN), None).is_err());
        assert!(listen_args(None, Some(11.0), None).is_err());
        assert!(listen_args(None, None, Some(5)).is_err());
        assert!(listen_args(Some("--max"), None, None).is_err());
    }

    #[test]
    fn default_hotkey_parses() {
        assert!(Shortcut::from_str(DEFAULT_HOTKEY).is_ok());
    }
}
