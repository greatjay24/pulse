// ==========================================
// Pictures for Roo: a pasted or dropped image, or a capture of the screen
// ==========================================
// The listening panel can attach one image to a question. Every image is copied into Roo's own
// folder (~/Library/Application Support/com.pulse.app/attachments), shrunk to at most 2000 px on
// its long side, and handed to both lanes as an absolute path ("Image attached: <path> — read it
// with the Read tool"): the quick lane may Read that folder and nothing else (quick.rs), full Roo
// reads it like any file. Files older than a week are pruned whenever a new one arrives.
//
// The screen is captured with macOS's own `screencapture`, of the display the panel is on, with
// the panel hidden for the moment it takes. That needs Screen Recording permission; without it
// the capture fails (or comes back empty) and the panel says where to turn it on.

use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};

const KEEP_FOR: Duration = Duration::from_secs(7 * 24 * 3600);
const MAX_BYTES: usize = 25 * 1024 * 1024;
const MAX_SIDE: u32 = 2000; // Claude sees no more than this anyway; smaller reads faster
const THUMB_SIDE: u32 = 96;
const HIDE_SETTLE: Duration = Duration::from_millis(300); // the panel's gone before the capture
const LISTEN_WINDOW: &str = "listen";
pub(crate) const SCREEN_PERMISSION: &str = "Roo can't see your screen yet. Turn on Roo in System Settings > Privacy & Security > Screen Recording, then quit and reopen Roo.";
const SCREEN_SETTINGS_URL: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

#[derive(Serialize, Debug)]
pub(crate) struct Attachment {
    path: String,
    thumb: String, // a data: URL for the panel's chip
}

// ------------------------------------------
// Pure helpers
// ------------------------------------------

// What the bytes are, by their magic numbers (never by the name they came with).
pub(crate) fn image_kind(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        Some("gif")
    } else if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("webp")
    } else if b.len() >= 12 && &b[4..8] == b"ftyp" && matches!(&b[8..12], b"heic" | b"heix" | b"mif1" | b"msf1" | b"hevc") {
        Some("heic")
    } else if b.starts_with(b"II*\0") || b.starts_with(b"MM\0*") {
        Some("tiff")
    } else {
        None
    }
}

// The kinds Claude reads as images; the rest are converted to PNG first.
fn claude_reads(kind: &str) -> bool {
    matches!(kind, "png" | "jpg" | "gif" | "webp")
}

// A clipboard paste arrives as a data: URL (or bare base64).
pub(crate) fn decode_data_url(data: &str) -> Result<Vec<u8>, String> {
    let b64 = match data.strip_prefix("data:") {
        Some(rest) => rest.split_once(";base64,").map(|(_, b)| b).ok_or("not a base64 data URL")?,
        None => data,
    };
    if b64.len() > MAX_BYTES / 3 * 4 + 4 {
        return Err("That image is too big (25 MB at most).".to_string());
    }
    base64::engine::general_purpose::STANDARD.decode(b64.trim()).map_err(|_| "That image couldn't be read.".to_string())
}

// Names Roo gives its attachments: 20261109-201512-ab12cd34.png (and nothing else is pruned).
pub(crate) fn is_attachment_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else { return false };
    matches!(ext, "png" | "jpg" | "gif" | "webp" | "heic" | "tiff")
        && stem.len() == 24
        && stem.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

// `sips -g pixelWidth -g pixelHeight` output: the image's long side.
pub(crate) fn long_side(sips_out: &str) -> Option<u32> {
    let mut sides = sips_out.lines().filter_map(|l| {
        let (k, v) = l.trim().split_once(':')?;
        matches!(k.trim(), "pixelWidth" | "pixelHeight").then(|| v.trim().parse::<u32>().ok()).flatten()
    });
    let (a, b) = (sides.next()?, sides.next()?);
    Some(a.max(b))
}

// `screencapture -R x,y,w,h` takes points; Tauri reports a monitor in physical pixels.
pub(crate) fn capture_rect(pos: (i32, i32), size: (u32, u32), scale: f64) -> String {
    let s = if scale > 0.0 { scale } else { 1.0 };
    let p = |v: f64| (v / s).round() as i64;
    format!("{},{},{},{}", p(pos.0 as f64), p(pos.1 as f64), p(size.0 as f64), p(size.1 as f64))
}

// What both lanes get: the path first, then the question.
pub(crate) fn image_prompt(path: &str, message: &str) -> String {
    format!("Image attached: {} — read it with the Read tool.\n\n{}", path, message.trim())
}

// Drops attachments older than a week.
pub(crate) fn prune(dir: &Path, now: SystemTime) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let old = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| now.duration_since(t).ok()).is_some_and(|age| age > KEEP_FOR);
        if old && is_attachment_name(&name) {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

// ------------------------------------------
// The folder, and storing an image in it
// ------------------------------------------

pub(crate) fn attachments_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't make the attachments folder: {}", e))?;
    Ok(dir)
}

// A path the panel sends back must be one of Roo's own attachments.
pub(crate) fn attached_image(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let dir = attachments_dir(app)?.canonicalize().map_err(|e| e.to_string())?;
    let p = Path::new(path).canonicalize().map_err(|_| "The attached image is gone: attach it again.".to_string())?;
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if p.parent() != Some(dir.as_path()) || !is_attachment_name(&name) || !p.is_file() {
        return Err("That image isn't one of Roo's attachments.".to_string());
    }
    Ok(p)
}

fn new_path(dir: &Path, ext: &str) -> Result<PathBuf, String> {
    let mut rnd = [0u8; 4];
    getrandom::getrandom(&mut rnd).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{}-{}.{}", chrono::Local::now().format("%Y%m%d-%H%M%S"), hex::encode(rnd), ext)))
}

fn sips(args: &[&str]) -> Result<String, String> {
    let out = Command::new("/usr/bin/sips").args(args).output().map_err(|e| format!("sips: {}", e))?;
    if !out.status.success() {
        return Err("macOS couldn't open that image.".to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// Shrinks to MAX_SIDE, makes the chip's thumbnail, prunes the folder.
fn finish(dir: &Path, path: PathBuf) -> Result<Attachment, String> {
    let p = path.to_string_lossy().to_string();
    if long_side(&sips(&["-g", "pixelWidth", "-g", "pixelHeight", &p])?).is_some_and(|s| s > MAX_SIDE) {
        sips(&["-Z", &MAX_SIDE.to_string(), &p])?;
    }
    let thumb_path = dir.join(format!("{}.thumb.jpg", path.file_stem().unwrap_or_default().to_string_lossy()));
    let t = thumb_path.to_string_lossy().to_string();
    let thumb = sips(&["-Z", &THUMB_SIDE.to_string(), "-s", "format", "jpeg", &p, "--out", &t])
        .and_then(|_| std::fs::read(&thumb_path).map_err(|e| e.to_string()))
        .map(|b| format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
        .unwrap_or_default();
    let _ = std::fs::remove_file(&thumb_path);
    prune(dir, SystemTime::now());
    Ok(Attachment { path: p, thumb })
}

fn store(dir: &Path, bytes: &[u8]) -> Result<Attachment, String> {
    if bytes.len() > MAX_BYTES {
        return Err("That image is too big (25 MB at most).".to_string());
    }
    let kind = image_kind(bytes).ok_or("That isn't an image Roo can read (PNG, JPEG, GIF, WebP, HEIC or TIFF).")?;
    let path = new_path(dir, kind)?;
    std::fs::write(&path, bytes).map_err(|e| format!("couldn't save the image: {}", e))?;
    if claude_reads(kind) {
        return finish(dir, path);
    }
    let png = path.with_extension("png");
    let converted = sips(&["-s", "format", "png", &path.to_string_lossy(), "--out", &png.to_string_lossy()]);
    let _ = std::fs::remove_file(&path);
    converted?;
    finish(dir, png)
}

// ------------------------------------------
// Commands
// ------------------------------------------

// Cmd+V: the image on the clipboard, as a data: URL.
#[tauri::command]
pub(crate) async fn save_attachment(app: AppHandle, data: String) -> Result<Attachment, String> {
    let dir = attachments_dir(&app)?;
    let bytes = decode_data_url(&data)?;
    tauri::async_runtime::spawn_blocking(move || store(&dir, &bytes)).await.map_err(|e| e.to_string())?
}

// A file dropped on the panel: copied in, so the original is never touched.
#[tauri::command]
pub(crate) async fn attach_file(app: AppHandle, path: String) -> Result<Attachment, String> {
    let dir = attachments_dir(&app)?;
    let src = PathBuf::from(&path);
    if !src.is_absolute() || !src.is_file() {
        return Err("Drop an image file.".to_string());
    }
    if src.metadata().map(|m| m.len() as usize > MAX_BYTES).unwrap_or(true) {
        return Err("That image is too big (25 MB at most).".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&src).map_err(|e| format!("couldn't read that file: {}", e))?;
        store(&dir, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

// Whether Roo may record the screen. The first time it isn't, macOS is asked to list Roo under
// Screen Recording (it shows its own prompt once).
#[cfg(target_os = "macos")]
fn screen_access() -> bool {
    // SAFETY: plain CoreGraphics calls with no arguments.
    unsafe { CGPreflightScreenCaptureAccess() || { CGRequestScreenCaptureAccess(); false } }
}

#[cfg(not(target_os = "macos"))]
fn screen_access() -> bool {
    false
}

// The "📷 screen" button and "look at my screen": the display the panel is on, panel hidden.
#[tauri::command]
pub(crate) async fn capture_screen(app: AppHandle) -> Result<Attachment, String> {
    if !screen_access() {
        return Err(SCREEN_PERMISSION.to_string());
    }
    let dir = attachments_dir(&app)?;
    let path = new_path(&dir, "png")?;
    let panel = app.get_webview_window(LISTEN_WINDOW);
    let monitor = panel.as_ref().and_then(|w| w.current_monitor().ok().flatten()).or_else(|| app.primary_monitor().ok().flatten());
    let rect = monitor.map(|m| capture_rect((m.position().x, m.position().y), (m.size().width, m.size().height), m.scale_factor()));
    let shown = panel.as_ref().is_some_and(|w| w.is_visible().unwrap_or(false));
    if let (Some(w), true) = (&panel, shown) {
        let _ = w.hide();
    }
    let p = path.clone();
    let captured = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(HIDE_SETTLE);
        let mut cmd = Command::new("/usr/sbin/screencapture");
        cmd.args(["-x", "-t", "png"]);
        if let Some(r) = rect {
            cmd.args(["-R", &r]);
        }
        cmd.arg(&p).output()
    })
    .await
    .map_err(|e| e.to_string())?;
    if let (Some(w), true) = (&panel, shown) {
        let _ = w.show();
        let _ = w.set_focus();
    }
    let ok = captured.is_ok_and(|o| o.status.success()) && path.metadata().is_ok_and(|m| m.len() > 0);
    if !ok {
        let _ = std::fs::remove_file(&path);
        return Err(SCREEN_PERMISSION.to_string());
    }
    tauri::async_runtime::spawn_blocking(move || finish(&dir, path)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn open_screen_settings() -> Result<(), String> {
    Command::new("/usr/bin/open").arg(SCREEN_SETTINGS_URL).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_come_from_magic_bytes() {
        assert_eq!(image_kind(b"\x89PNG\r\n\x1a\n...."), Some("png"));
        assert_eq!(image_kind(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0]), Some("jpg"));
        assert_eq!(image_kind(b"GIF89a.."), Some("gif"));
        assert_eq!(image_kind(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(image_kind(b"\0\0\0\x18ftypheic\0\0"), Some("heic"));
        assert_eq!(image_kind(b"MM\0*...."), Some("tiff"));
        assert_eq!(image_kind(b"%PDF-1.7"), None);
        assert_eq!(image_kind(b"#!/bin/sh"), None);
        assert_eq!(image_kind(b""), None);
    }

    #[test]
    fn data_urls_decode() {
        assert_eq!(decode_data_url("data:image/png;base64,aGk=").unwrap(), b"hi");
        assert_eq!(decode_data_url("aGk=").unwrap(), b"hi");
        assert!(decode_data_url("data:text/plain,hi").is_err());
        assert!(decode_data_url("data:image/png;base64,***").is_err());
    }

    #[test]
    fn only_roos_names_are_attachments() {
        assert!(is_attachment_name("20261109-201512-ab12cd34.png"));
        assert!(is_attachment_name("20261109-201512-ab12cd34.jpg"));
        assert!(!is_attachment_name("20261109-201512-ab12cd34.thumb.jpg"));
        assert!(!is_attachment_name("notes.png"));
        assert!(!is_attachment_name("20261109-201512-ab12cd34.sh"));
        assert!(!is_attachment_name("../../20261109-201512-ab.png"));
    }

    #[test]
    fn long_side_reads_sips() {
        let out = "/x/a.png\n  pixelWidth: 3024\n  pixelHeight: 1964\n";
        assert_eq!(long_side(out), Some(3024));
        assert_eq!(long_side("/x/a.png\n  pixelWidth: 800\n  pixelHeight: 1200\n"), Some(1200));
        assert_eq!(long_side("nope"), None);
    }

    #[test]
    fn capture_rect_is_in_points() {
        // A 2x retina main display, and an external 1x one to its left.
        assert_eq!(capture_rect((0, 0), (3024, 1964), 2.0), "0,0,1512,982");
        assert_eq!(capture_rect((-1920, 0), (1920, 1080), 1.0), "-1920,0,1920,1080");
        assert_eq!(capture_rect((3024, -400), (5120, 2880), 2.0), "1512,-200,2560,1440");
    }

    #[test]
    fn prompt_names_the_path_first() {
        let p = image_prompt("/a b/x.png", "  what's this?  ");
        assert_eq!(p, "Image attached: /a b/x.png — read it with the Read tool.\n\nwhat's this?");
    }

    #[test]
    fn prune_drops_only_old_attachments() {
        let dir = std::env::temp_dir().join(format!("pulse-attach-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let keep = dir.join("20261109-201512-ab12cd34.png");
        let other = dir.join("keep-me.png");
        std::fs::write(&keep, b"x").unwrap();
        std::fs::write(&other, b"x").unwrap();
        prune(&dir, SystemTime::now());
        assert!(keep.exists());
        prune(&dir, SystemTime::now() + KEEP_FOR + Duration::from_secs(60));
        assert!(!keep.exists());
        assert!(other.exists(), "files Roo didn't name are never pruned");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // A 64x32 red PNG.
    const RED: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x20,  0x08, 0x02, 0x00, 0x00, 0x00, 0x2d, 0xff, 0xe9, 0xd3, 0x00, 0x00, 0x00,  0x48, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0xed, 0xcf, 0xc1, 0x09, 0x00,  0x30, 0x10, 0x84, 0xc0, 0xed, 0xbf, 0xe9, 0xa4, 0x88, 0x7b, 0x88, 0x20,  0x4c, 0x01, 0xba, 0xb7, 0xa9, 0xf1, 0x05, 0x0d, 0xc8, 0xf1, 0x05, 0x0d,  0xc8, 0xf1, 0x05, 0x0d, 0xc8, 0xf1, 0x05, 0x0d, 0xc8, 0xf1, 0x05, 0x0d,  0xc8, 0xf1, 0x05, 0x0d, 0xc8, 0xf1, 0x05, 0x0d, 0xc8, 0xf1, 0x05, 0x0d,  0xc8, 0xf1, 0x05, 0x0d, 0xc8, 0xf1, 0x05, 0x0d, 0xc8, 0xf1, 0x05, 0x47,  0x1f, 0x32, 0xc3, 0xf8, 0x6a, 0x07, 0x6e, 0x4d, 0x3a, 0x00, 0x00, 0x00,  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

    #[cfg(target_os = "macos")]
    #[test]
    fn store_saves_shrinks_and_thumbs() {
        let dir = std::env::temp_dir().join(format!("pulse-attach-store-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = store(&dir, RED).unwrap();
        let name = Path::new(&a.path).file_name().unwrap().to_string_lossy().to_string();
        assert!(is_attachment_name(&name) && name.ends_with(".png"), "{}", name);
        assert!(a.thumb.starts_with("data:image/jpeg;base64,"));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1, "the thumbnail file is cleaned up");
        // A big one comes back at most MAX_SIDE on its long side.
        sips(&["-z", "1500", "3000", &a.path]).unwrap();
        let big = std::fs::read(&a.path).unwrap();
        let b = store(&dir, &big).unwrap();
        assert_eq!(long_side(&sips(&["-g", "pixelWidth", "-g", "pixelHeight", &b.path]).unwrap()), Some(MAX_SIDE));
        assert!(store(&dir, b"not an image").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
