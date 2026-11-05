// ==========================================
// Proactive voice: Roo speaks first
// ==========================================
// The webview decides what to say (src/hooks/useProactiveVoice.ts). This side gives it what it
// reads and what it needs to stay quiet: the watcher's notifications (watch/notify.jsonl) and
// calendar cache (watch/calendar.json), whether the mic is in use or the screen is locked, and
// a notification whose click opens Roo on what was said.

use super::{get_portfolio_dir, pick_fields, read_jsonl_tail, read_portfolio_json, resolve_portfolio_file, show_main_window};
use std::sync::atomic::AtomicUsize;
use tauri::{AppHandle, Emitter};

const NOTIFY_ROWS: usize = 60;
const NOTIFY_FIELDS: &[&str] = &["id", "at", "delivered_at", "level", "entity", "title", "source", "event_key"];
// Each notification waiting for a click holds a thread; past this many, new ones don't wait.
const MAX_WAITING: usize = 4;
static WAITING: AtomicUsize = AtomicUsize::new(0);

fn watch_file(name: &str) -> Option<std::path::PathBuf> {
    let root = get_portfolio_dir().ok()?;
    resolve_portfolio_file(&root, "watch", name).ok()
}

// The newest rows Roo was told about. No bodies or links: only what a sentence is made from.
#[tauri::command]
pub(crate) fn read_watch_notify() -> Result<Vec<serde_json::Value>, String> {
    let Some(path) = watch_file("notify.jsonl") else { return Ok(Vec::new()) };
    Ok(read_jsonl_tail(&path, NOTIFY_ROWS)?.iter().map(|r| pick_fields(r, NOTIFY_FIELDS)).collect())
}

// The next 24 hours from the watcher's cache: start, title, how many people, my answer.
pub(crate) fn calendar_rows(v: &serde_json::Value) -> Vec<serde_json::Value> {
    v.get("events")
        .and_then(|e| e.as_array())
        .map(|events| {
            events
                .iter()
                .filter(|e| e.get("id").and_then(|x| x.as_str()).is_some() && e.get("start").and_then(|x| x.as_str()).is_some())
                .map(|e| {
                    let people = e.get("attendees").and_then(|a| a.as_array()).map(|a| a.iter().filter(|x| x.as_str().is_some_and(|s| !s.contains("resource.calendar"))).count()).unwrap_or(0);
                    serde_json::json!({
                        "id": e["id"],
                        "start": e["start"],
                        "summary": e.get("summary").cloned().unwrap_or(serde_json::Value::Null),
                        "my_response": e.get("my_response").cloned().unwrap_or(serde_json::Value::Null),
                        "people": people,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub(crate) fn read_watch_calendar() -> Result<Vec<serde_json::Value>, String> {
    let Some(path) = watch_file("calendar.json") else { return Ok(Vec::new()) };
    Ok(calendar_rows(&read_portfolio_json(&path)?))
}

// ==========================================
// Meeting prep (~/portfolio/bin/meeting_prep.py)
// ==========================================
// The watcher writes briefs to watch/prep/<key>.md and an index (watch/prep/index.json) with when
// each one is due: 10 minutes before, and 8pm the night before for meetings before 9am. Roo offers
// them ("your meeting with X is in 10 minutes. Want a quick brief?") and tells the watcher it is
// open and what it offered (watch/desktop.json, every minute). A stale heartbeat or a locked
// screen means the desktop is closed: the watcher sends the brief to Telegram instead.

const PREP_FIELDS: &[&str] = &["key", "title", "start", "entity", "who", "spoken", "status", "slots", "delivered", "ids"];
const PREP_OFFERED_MAX: usize = 60;

// A prep key: a date and a title slug ("2026-11-06-brownfield-grant"). Nothing else reaches a path.
pub(crate) fn is_prep_key(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && !s.starts_with('-')
}

// "<key>:night" or "<key>:pre"
pub(crate) fn is_prep_tag(s: &str) -> bool {
    match s.rsplit_once(':') {
        Some((k, slot)) => is_prep_key(k) && (slot == "night" || slot == "pre"),
        None => false,
    }
}

pub(crate) fn prep_rows(v: &serde_json::Value) -> Vec<serde_json::Value> {
    let Some(map) = v.get("meetings").and_then(|m| m.as_object()) else { return Vec::new() };
    map.iter()
        .filter(|(k, r)| is_prep_key(k) && r.get("start").and_then(|x| x.as_str()).is_some())
        .map(|(k, r)| {
            let mut row = pick_fields(r, PREP_FIELDS);
            row["key"] = serde_json::Value::String(k.clone());
            row
        })
        .collect()
}

#[tauri::command]
pub(crate) fn read_meeting_prep() -> Result<Vec<serde_json::Value>, String> {
    let Some(path) = watch_file("prep/index.json") else { return Ok(Vec::new()) };
    Ok(prep_rows(&read_portfolio_json(&path)?))
}

// One brief's markdown, by key (never by path).
#[tauri::command]
pub(crate) fn read_prep_brief(key: String) -> Result<String, String> {
    if !is_prep_key(&key) {
        return Err("invalid key".to_string());
    }
    let root = get_portfolio_dir()?;
    let path = resolve_portfolio_file(&root, "watch/prep", &format!("{}.md", key))?;
    super::read_portfolio_text(&path)
}

pub(crate) fn heartbeat_json(at: &str, screen_locked: Option<bool>, offered: &[String]) -> serde_json::Value {
    let mut keep: Vec<&String> = offered.iter().filter(|t| is_prep_tag(t)).collect();
    let skip = keep.len().saturating_sub(PREP_OFFERED_MAX);
    keep.drain(..skip);
    serde_json::json!({ "at": at, "app": "roo", "screen_locked": screen_locked, "prep_offered": keep })
}

// Roo is open: written every minute while the window exists (hidden or not).
#[tauri::command]
pub(crate) fn desktop_heartbeat(prep_offered: Vec<String>) -> Result<(), String> {
    let root = get_portfolio_dir()?;
    let dir = root.join("watch");
    let dir = dir.canonicalize().map_err(|_| "~/portfolio/watch not found".to_string())?;
    if !dir.starts_with(&root) {
        return Err("path is outside ~/portfolio".to_string());
    }
    let body = heartbeat_json(&chrono::Local::now().to_rfc3339(), mac::screen_locked(), &prep_offered);
    let tmp = dir.join("desktop.json.tmp");
    std::fs::write(&tmp, body.to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join("desktop.json")).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub(crate) struct ProactiveStatus {
    speaking: bool,
    mic_in_use: Option<bool>, // None: couldn't tell
    screen_locked: Option<bool>,
}

#[tauri::command]
pub(crate) fn proactive_status(state: tauri::State<'_, super::jarvis::Voice>) -> ProactiveStatus {
    ProactiveStatus { speaking: super::jarvis::is_speaking(&state), mic_in_use: mac::mic_in_use(), screen_locked: mac::screen_locked() }
}

pub(crate) fn is_item_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_:.".contains(c))
}

fn clip(s: &str, n: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(n).collect()
}

// A notification for what Roo just said. A click brings the main window up on the Roo thread
// with it (`pulse://proactive-open`).
#[tauri::command]
pub(crate) fn proactive_notify(app: AppHandle, title: String, body: String, id: String) -> Result<(), String> {
    if !is_item_id(&id) {
        return Err("invalid id".to_string());
    }
    let (title, body) = (clip(&title, 120), clip(&body, 400));
    std::thread::spawn(move || {
        if mac::notify_and_wait(&app, &title, &body) {
            show_main_window(&app);
            let _ = app.emit_to("main", "pulse://proactive-open", id);
        }
    });
    Ok(())
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{MAX_WAITING, WAITING};
    use std::ffi::{c_char, c_void};
    use std::sync::atomic::Ordering;

    #[repr(C)]
    struct PropertyAddress {
        selector: u32,
        scope: u32,
        element: u32,
    }

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyData(id: u32, addr: *const PropertyAddress, qsize: u32, qdata: *const c_void, size: *mut u32, data: *mut c_void) -> i32;
    }

    type CFRef = *const c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFDictionaryGetValue(dict: CFRef, key: CFRef) -> CFRef;
        fn CFStringCreateWithCString(alloc: CFRef, s: *const c_char, encoding: u32) -> CFRef;
        fn CFGetTypeID(x: CFRef) -> usize;
        fn CFBooleanGetTypeID() -> usize;
        fn CFBooleanGetValue(b: CFRef) -> u8;
        fn CFRelease(x: CFRef);
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGSessionCopyCurrentDictionary() -> CFRef;
    }

    pub(crate) const fn fourcc(s: &[u8; 4]) -> u32 {
        ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | s[3] as u32
    }

    fn get_u32(object: u32, selector: &[u8; 4]) -> Option<u32> {
        let addr = PropertyAddress { selector: fourcc(selector), scope: fourcc(b"glob"), element: 0 };
        let (mut out, mut size) = (0u32, 4u32);
        // SAFETY: a 4-byte property read into a u32 the size of which we pass.
        let st = unsafe { AudioObjectGetPropertyData(object, &addr, 0, std::ptr::null(), &mut size, &mut out as *mut u32 as *mut c_void) };
        (st == 0).then_some(out)
    }

    // Some app is recording from the default input (a call, a dictation, Roo's own listening).
    pub(crate) fn mic_in_use() -> Option<bool> {
        let device = get_u32(1, b"dIn ").filter(|d| *d != 0)?; // the system object's default input
        get_u32(device, b"gone").map(|running| running != 0) // kAudioDevicePropertyDeviceIsRunningSomewhere
    }

    pub(crate) fn screen_locked() -> Option<bool> {
        // SAFETY: Core Foundation calls on objects we own (Copy/Create) and release; the value
        // read from the dictionary is borrowed and type-checked first.
        unsafe {
            let dict = CGSessionCopyCurrentDictionary();
            if dict.is_null() {
                return None;
            }
            let key = CFStringCreateWithCString(std::ptr::null(), c"CGSSessionScreenIsLocked".as_ptr(), 0x0800_0100);
            let v = if key.is_null() { std::ptr::null() } else { CFDictionaryGetValue(dict, key) };
            let locked = !v.is_null() && CFGetTypeID(v) == CFBooleanGetTypeID() && CFBooleanGetValue(v) != 0;
            if !key.is_null() {
                CFRelease(key);
            }
            CFRelease(dict);
            Some(locked)
        }
    }

    // Shows the notification and, while few are waiting, blocks this thread until it is clicked
    // or dismissed. True on a click.
    pub(crate) fn notify_and_wait(app: &tauri::AppHandle, title: &str, body: &str) -> bool {
        let bundle = if tauri::is_dev() { "com.apple.Terminal".to_string() } else { app.config().identifier.clone() };
        let _ = mac_notification_sys::set_application(&bundle); // already set by the notification plugin: fine
        let wait = WAITING.fetch_add(1, Ordering::SeqCst) < MAX_WAITING;
        let r = mac_notification_sys::Notification::new().title(title).message(body).wait_for_click(wait).send();
        WAITING.fetch_sub(1, Ordering::SeqCst);
        wait && matches!(r, Ok(mac_notification_sys::NotificationResponse::Click))
    }
}

#[cfg(not(target_os = "macos"))]
mod mac {
    pub(crate) fn mic_in_use() -> Option<bool> {
        None
    }
    pub(crate) fn screen_locked() -> Option<bool> {
        None
    }
    pub(crate) fn notify_and_wait(_app: &tauri::AppHandle, _title: &str, _body: &str) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn item_ids_are_plain() {
        assert!(is_item_id("n-20261105-041023-ee58"));
        assert!(is_item_id("cal:abc123:2026-11-05T10.00"));
        assert!(!is_item_id(""));
        assert!(!is_item_id("a b"));
        assert!(!is_item_id("../x"));
        assert!(!is_item_id(&"x".repeat(81)));
    }

    #[test]
    fn calendar_rows_keep_only_what_a_sentence_needs() {
        let v = serde_json::json!({"events": [
            {"id": "e1", "start": "2026-11-05T12:00:00-05:00", "summary": "Quarterly review", "attendees": ["a@x.com", "b@y.com", "room@resource.calendar.google.com"], "my_response": "accepted", "description": "secret notes"},
            {"id": "e2"},
            {"start": "2026-11-05T13:00:00-05:00"}
        ]});
        let rows = calendar_rows(&v);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["people"], 2);
        assert_eq!(rows[0]["summary"], "Quarterly review");
        assert!(rows[0].get("description").is_none());
        assert!(calendar_rows(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn prep_keys_and_tags_are_plain() {
        assert!(is_prep_key("2026-11-06-brownfield-grant"));
        assert!(!is_prep_key("../x"));
        assert!(!is_prep_key("a.md"));
        assert!(!is_prep_key("-x"));
        assert!(!is_prep_key(""));
        assert!(is_prep_tag("2026-11-06-call:pre"));
        assert!(is_prep_tag("2026-11-06-call:night"));
        assert!(!is_prep_tag("2026-11-06-call:later"));
        assert!(!is_prep_tag("nocolon"));
    }

    #[test]
    fn prep_rows_drop_bad_keys_and_paths() {
        let v = serde_json::json!({"meetings": {
            "2026-11-06-call": {"start": "2026-11-06T08:00:00-05:00", "title": "Call", "status": "ready", "path": "/Users/x/secret.md", "short": "phone text"},
            "../evil": {"start": "2026-11-06T08:00:00-05:00"},
            "2026-11-06-nostart": {"title": "x"}
        }});
        let rows = prep_rows(&v);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["key"], "2026-11-06-call");
        assert!(rows[0].get("path").is_none());
        assert!(rows[0].get("short").is_none());
        assert!(prep_rows(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn heartbeat_keeps_only_valid_recent_tags() {
        let mut offered: Vec<String> = (0..70).map(|i| format!("2026-11-06-m{}:pre", i)).collect();
        offered.push("../x:pre".to_string());
        let v = heartbeat_json("2026-11-05T12:00:00-05:00", Some(false), &offered);
        let list = v["prep_offered"].as_array().unwrap();
        assert_eq!(list.len(), PREP_OFFERED_MAX);
        assert_eq!(list.last().unwrap(), "2026-11-06-m69:pre");
        assert_eq!(v["screen_locked"], false);
    }

    #[test]
    fn clip_drops_control_characters() {
        assert_eq!(clip("a\r\nb\u{0}c", 10), "abc");
        assert_eq!(clip("abcdef", 3), "abc");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn fourcc_matches_core_audio() {
        assert_eq!(mac::fourcc(b"glob"), 0x676c_6f62);
        assert_eq!(mac::fourcc(b"dIn "), 0x6449_6e20);
    }
}
