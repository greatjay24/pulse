// ==========================================
// Usage (where the plan's usage goes) and Memory (what Pulse has learned)
// ==========================================
// Reads are local files under ~/portfolio. bin/usage.py builds logs/usage/usage.json from
// the org's run logs and Claude Code's own usage numbers; Pulse asks it to refresh and then
// reads the file. Preference toggles go through bin/learn.py, which never deletes a line.

use crate::ops::run_script;
use crate::{get_portfolio_dir, read_text_capped, resolve_portfolio_file};
use std::path::Path;
use std::time::Duration;

const USAGE_MAX_BYTES: u64 = 20 * 1024 * 1024;
const PREFS_MAX_BYTES: u64 = 2 * 1024 * 1024;
const USAGE_TIMEOUT: Duration = Duration::from_secs(180);
const LEARN_TIMEOUT: Duration = Duration::from_secs(20);

fn read_json_at(root: &Path, dir: &str, file: &str, max: u64) -> Result<serde_json::Value, String> {
    let path = resolve_portfolio_file(root, dir, file)?;
    let text = read_text_capped(&path, max)?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("malformed: {}", e))?;
    if !v.is_object() {
        return Err("malformed: not a JSON object".to_string());
    }
    Ok(v)
}

/// The usage report. `refresh` rebuilds it first (bin/usage.py); a failed refresh still
/// returns the last report, with the error alongside.
#[tauri::command]
pub async fn read_usage(refresh: bool) -> Result<String, String> {
    let root = get_portfolio_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        let refresh_error = if refresh { run_script(&root, "usage.py", &[], None, USAGE_TIMEOUT).err() } else { None };
        let report = read_json_at(&root, "logs/usage", "usage.json", USAGE_MAX_BYTES);
        match (report, refresh_error) {
            (Ok(r), err) => Ok(serde_json::json!({ "report": r, "refresh_error": err }).to_string()),
            (Err(_), Some(err)) => Err(err),
            (Err(e), None) if e == "missing" => Ok(serde_json::json!({ "report": null, "refresh_error": null }).to_string()),
            (Err(e), None) => Err(e),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn is_pref_id(s: &str) -> bool {
    s.len() == 8 && s.starts_with("p-") && s[2..].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[tauri::command]
pub fn read_preferences() -> Result<String, String> {
    let root = get_portfolio_dir()?;
    match read_json_at(&root, "memory", "preferences.json", PREFS_MAX_BYTES) {
        Ok(v) => Ok(v.to_string()),
        Err(e) if e == "missing" => Ok(serde_json::json!({ "preferences": [] }).to_string()),
        Err(e) => Err(e),
    }
}

/// Turns a learned preference off (or back on). learn.py keeps the line and re-renders
/// memory/preferences.md without it.
#[tauri::command]
pub async fn set_preference_disabled(id: String, disabled: bool) -> Result<String, String> {
    if !is_pref_id(&id) {
        return Err("invalid preference id".to_string());
    }
    let root = get_portfolio_dir()?;
    let args = vec!["--set".to_string(), id, "--disabled".to_string(), if disabled { "true" } else { "false" }.to_string()];
    tauri::async_runtime::spawn_blocking(move || run_script(&root, "learn.py", &args, None, LEARN_TIMEOUT).map(|v| v.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod usage_tests {
    use super::*;

    #[test]
    fn preference_ids_are_strict() {
        assert!(is_pref_id("p-4976e6"));
        for bad in ["p-4976E6", "p-4976e", "p-4976e6a", "../p-1", "p-zzzzzz", "", "--set"] {
            assert!(!is_pref_id(bad), "{}", bad);
        }
    }

    #[test]
    fn reads_only_objects_inside_the_root() {
        let dir = std::env::temp_dir().join(format!("pulse-usage-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("logs/usage")).unwrap();
        std::fs::write(dir.join("logs/usage/usage.json"), r#"{"runs": []}"#).unwrap();
        std::fs::write(dir.join("logs/usage/list.json"), "[1]").unwrap();
        let root = dir.canonicalize().unwrap();
        assert!(read_json_at(&root, "logs/usage", "usage.json", 1024).is_ok());
        assert!(read_json_at(&root, "logs/usage", "list.json", 1024).is_err());
        assert!(read_json_at(&root, "../", "usage.json", 1024).is_err());
        assert_eq!(read_json_at(&root, "memory", "preferences.json", 1024).unwrap_err(), "missing");
        assert_eq!(read_json_at(&root, "logs/usage", "usage.json", 4).unwrap_err(), "file too large");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
