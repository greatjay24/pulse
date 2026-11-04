// Tasks: ~/project-tracker/todos.json, the owner's one to-do list. The Mac owns it (the server
// only queues changes for it), so Pulse is where it is shown and edited.
//
// Reading: the file is read directly, and only the fields below leave Rust.
// Writing: never by hand. Every change goes through `add_todo.py --stdin`, the tracker's one
// write path (it locks the file and knows the rules: same title = same task, a done task stays
// done unless reopened). Rust checks the change first, so the script only sees known keys.

use crate::{get_tracker_dir, read_text_capped, TrackerTask, PYTHON_CANDIDATES};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

const TODOS_MAX_BYTES: u64 = 4 * 1024 * 1024;
const WRITE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
const URGENCIES: &[&str] = &["now", "soon", "whenever"];

#[derive(Deserialize, Serialize, Clone, Debug)]
pub(crate) struct Todo {
    pub title: String,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub urgency: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub show_from: Option<String>,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub added: Option<String>,
    #[serde(default)]
    pub done_at: Option<String>,
    #[serde(default)]
    pub done_evidence: Option<String>,
    // The rule that closes it by itself ({"pr_merged": "owner/repo#12"} and the like).
    #[serde(default)]
    pub done_when: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct TodosSnapshot {
    installed: bool,
    error: Option<String>,
    todos: Vec<Todo>,
    skipped: usize, // rows that are not task-shaped (kept in the file, not shown)
    read_at: String,
}

// todos.json at the tracker root, and nowhere else (a symlink out of the root is refused).
fn todos_path(root: &Path) -> Result<PathBuf, String> {
    let resolved = root.join("todos.json").canonicalize().map_err(|_| "missing".to_string())?;
    if resolved.parent() != Some(root) {
        return Err("path is outside ~/project-tracker".to_string());
    }
    Ok(resolved)
}

pub(crate) fn read_todos_at(root: &Path) -> Result<(Vec<Todo>, usize), String> {
    let text = read_text_capped(&todos_path(root)?, TODOS_MAX_BYTES)?;
    let doc: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("malformed: {}", e))?;
    let rows = doc.get("todos").and_then(|v| v.as_array()).ok_or("malformed: no todos list")?;
    let mut skipped = 0;
    let todos = rows
        .iter()
        .filter_map(|v| match serde_json::from_value::<Todo>(v.clone()) {
            Ok(t) if !t.title.trim().is_empty() => Some(t),
            _ => {
                skipped += 1;
                None
            }
        })
        .collect();
    Ok((todos, skipped))
}

#[tauri::command]
pub fn read_todos() -> Result<String, String> {
    let mut snap = TodosSnapshot {
        installed: false,
        error: None,
        todos: vec![],
        skipped: 0,
        read_at: chrono::Local::now().to_rfc3339(),
    };
    match get_tracker_dir() {
        Err(e) => snap.error = Some(e),
        Ok(root) => {
            snap.installed = true;
            match read_todos_at(&root) {
                Ok((todos, skipped)) => {
                    snap.todos = todos;
                    snap.skipped = skipped;
                }
                Err(e) if e == "missing" => {} // no tasks yet
                Err(e) => snap.error = Some(format!("todos.json: {}", e)),
            }
        }
    }
    serde_json::to_string(&snap).map_err(|e| e.to_string())
}

fn is_date(s: &str) -> bool {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok() && s.len() == 10
}

fn text_field(v: &serde_json::Value, key: &str, max: usize) -> Result<String, String> {
    let s = v.as_str().ok_or(format!("{} must be text", key))?.trim().to_string();
    if s.chars().count() > max {
        return Err(format!("{} is too long", key));
    }
    Ok(s)
}

// One change from the Tasks view, checked before add_todo.py sees it. Returns the JSON task.
pub(crate) fn todo_change(change: &serde_json::Value) -> Result<serde_json::Value, String> {
    let obj = change.as_object().ok_or("a change must be an object")?;
    let mut out = serde_json::Map::new();
    let title = text_field(obj.get("title").ok_or("title is required")?, "title", 300)?;
    if title.is_empty() || title.contains('\n') {
        return Err("title is required (one line)".to_string());
    }
    out.insert("title".into(), title.into());
    for (key, v) in obj {
        match key.as_str() {
            "title" => {}
            "detail" => {
                out.insert(key.clone(), text_field(v, key, 2000)?.into());
            }
            "project" => {
                let p = text_field(v, key, 40)?;
                if !p.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_') {
                    return Err("project must be a tracker project id".to_string());
                }
                out.insert(key.clone(), p.into());
            }
            "urgency" => {
                let u = text_field(v, key, 10)?;
                if !URGENCIES.contains(&u.as_str()) {
                    return Err("urgency must be now, soon or whenever".to_string());
                }
                out.insert(key.clone(), u.into());
            }
            "url" => {
                let u = text_field(v, key, 1000)?;
                if !u.is_empty() && !(u.starts_with("https://") || u.starts_with("http://")) {
                    return Err("url must start with http(s)://".to_string());
                }
                out.insert(key.clone(), u.into());
            }
            "show_from" => {
                let d = text_field(v, key, 10)?;
                if !is_date(&d) {
                    return Err("show_from must be YYYY-MM-DD".to_string());
                }
                out.insert(key.clone(), d.into());
            }
            "done" | "reopen" => {
                if v.as_bool() != Some(true) {
                    return Err(format!("{} can only be true", key));
                }
                out.insert(key.clone(), true.into());
            }
            _ => return Err(format!("unknown field: {}", key)),
        }
    }
    if out.contains_key("done") && out.contains_key("reopen") {
        return Err("done and reopen together".to_string());
    }
    Ok(serde_json::Value::Object(out))
}

// add_todo.py prints one status line ("added: ...", "done: ...") or "invalid: ..." with exit 2.
fn run_add_todo(root: &Path, task: &serde_json::Value) -> Result<String, String> {
    let script = root.join("add_todo.py").canonicalize().map_err(|_| "~/project-tracker/add_todo.py not found")?;
    if script.parent() != Some(root) {
        return Err("add_todo.py is outside ~/project-tracker".to_string());
    }
    let python = PYTHON_CANDIDATES.iter().find(|p| Path::new(p).is_file()).ok_or("python3 not found")?;
    let mut child = std::process::Command::new(python)
        .arg(&script)
        .arg("--stdin")
        .current_dir(root)
        .env("TRACKER_ROLE", "owner") // Pulse runs on the Mac, which owns the list
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start add_todo.py: {}", e))?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(task.to_string().as_bytes())
        .map_err(|e| e.to_string())?;
    let started = std::time::Instant::now();
    while child.try_wait().map_err(|e| e.to_string())?.is_none() {
        if started.elapsed() > WRITE_TIMEOUT {
            let _ = child.kill();
            return Err("add_todo.py did not answer in time".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let line = stdout.lines().last().unwrap_or("").trim().to_string();
    if out.status.success() {
        return Ok(line);
    }
    if let Some(why) = line.strip_prefix("invalid: ") {
        return Err(why.to_string());
    }
    Err(format!("add_todo.py failed: {}", String::from_utf8_lossy(&out.stderr).trim().chars().take(300).collect::<String>()))
}

#[tauri::command]
pub async fn write_todo(change: serde_json::Value) -> Result<String, String> {
    let task = todo_change(&change)?;
    let root = get_tracker_dir()?;
    tauri::async_runtime::spawn_blocking(move || run_add_todo(&root, &task))
        .await
        .map_err(|e| e.to_string())?
}

fn placeholder_id(title: &str) -> String {
    use sha2::{Digest, Sha256};
    let h = Sha256::digest(format!("manual:{}", title).as_bytes());
    format!("todo-{}", &hex::encode(h)[..10])
}

// tasks.json only catches up on the hourly refresh, so the owner's own tasks are taken from
// todos.json as it is now: a task done or snoozed in Pulse leaves Today at once, and a new one
// shows up. Ids and first_seen are kept from tasks.json where the title matches.
pub(crate) fn overlay_manual(
    tasks: &mut Vec<TrackerTask>,
    known: &HashMap<String, (String, Option<f64>)>,
    todos: &[Todo],
    today: &str,
    now: f64,
) {
    tasks.retain(|t| t.source.as_deref() != Some("manual"));
    for td in todos.iter().filter(|t| !t.done) {
        let (id, first_seen) = known
            .get(&td.title)
            .cloned()
            .unwrap_or_else(|| (placeholder_id(&td.title), None));
        let added = td
            .added
            .as_deref()
            .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
            .and_then(|d| d.and_hms_opt(9, 0, 0))
            .map(|d| d.and_utc().timestamp() as f64);
        let show_from = td.show_from.clone().filter(|s| !s.is_empty());
        let scheduled = show_from.as_deref().is_some_and(|s| s > today);
        tasks.push(TrackerTask {
            id,
            title: td.title.clone(),
            detail: td.detail.clone(),
            url: td.url.clone(),
            project: td.project.clone(),
            kind: Some(td.kind.clone().unwrap_or_else(|| "todo".to_string())),
            urgency: Some(td.urgency.clone().unwrap_or_else(|| "whenever".to_string())),
            status: if scheduled { "scheduled" } else { "open" }.to_string(),
            source: Some("manual".to_string()),
            first_seen: first_seen.or(added).or(Some(now)),
            show_from,
        });
    }
}

// title -> (id, first_seen) for every manual task tasks.json has ever seen, done ones included.
pub(crate) fn known_manual(doc: &serde_json::Value) -> HashMap<String, (String, Option<f64>)> {
    let Some(map) = doc.get("tasks").and_then(|t| t.as_object()) else { return HashMap::new() };
    map.values()
        .filter(|v| v.get("source").and_then(|s| s.as_str()) == Some("manual"))
        .filter_map(|v| {
            Some((
                v.get("title")?.as_str()?.to_string(),
                (v.get("id")?.as_str()?.to_string(), v.get("first_seen").and_then(|f| f.as_f64())),
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pulse-todos-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("data")).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn checks_changes() {
        let ok = todo_change(&json!({"title": " Call Lamar ", "urgency": "soon", "show_from": "2026-11-09", "project": "crafted"})).unwrap();
        assert_eq!(ok, json!({"title": "Call Lamar", "urgency": "soon", "show_from": "2026-11-09", "project": "crafted"}));
        assert!(todo_change(&json!({"title": "x", "done": true})).is_ok());
        for bad in [
            json!({"urgency": "now"}),
            json!({"title": ""}),
            json!({"title": "two\nlines"}),
            json!({"title": "x", "urgency": "asap"}),
            json!({"title": "x", "show_from": "next week"}),
            json!({"title": "x", "show_from": "2026-13-01"}),
            json!({"title": "x", "done": false}),
            json!({"title": "x", "done": true, "reopen": true}),
            json!({"title": "x", "project": "../etc"}),
            json!({"title": "x", "url": "javascript:alert(1)"}),
            json!({"title": "x", "done_when": {"date_passed": "2026-01-01"}}),
            json!("just a string"),
        ] {
            assert!(todo_change(&bad).is_err(), "{}", bad);
        }
    }

    #[test]
    fn reads_todos_and_skips_odd_rows() {
        let root = temp_root("read");
        fs::write(root.join("todos.json"), r#"{"todos":[{"title":"A","done":false,"urgency":"now","reopened_at":5},{"title":"B","done":true,"done_when":{"date_passed":"2026-01-01"}},{"nope":1},{"title":""}]}"#).unwrap();
        let (todos, skipped) = read_todos_at(&root).unwrap();
        assert_eq!(todos.len(), 2);
        assert_eq!(skipped, 2);
        assert!(todos[1].done && todos[1].done_when.is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_symlinked_todos() {
        let root = temp_root("symlink");
        let outside = temp_root("symlink-outside");
        fs::write(outside.join("todos.json"), r#"{"todos":[]}"#).unwrap();
        std::os::unix::fs::symlink(outside.join("todos.json"), root.join("todos.json")).unwrap();
        assert_eq!(read_todos_at(&root).unwrap_err(), "path is outside ~/project-tracker");
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn overlays_the_live_list() {
        let doc = json!({"tasks": {
            "manual-1": {"id": "manual-1", "title": "Keep", "source": "manual", "status": "open", "first_seen": 100.0},
            "manual-2": {"id": "manual-2", "title": "Closed in Pulse", "source": "manual", "status": "open"},
            "email-1": {"id": "email-1", "title": "Reply to Ann", "source": "email", "status": "open"}
        }});
        let mut tasks = crate::tracker_tasks(&doc);
        let todos: Vec<Todo> = serde_json::from_value(json!([
            {"title": "Keep", "urgency": "now", "done": false},
            {"title": "Closed in Pulse", "done": true},
            {"title": "Snoozed", "done": false, "show_from": "2026-11-09"},
            {"title": "Brand new", "done": false, "added": "2026-11-02"}
        ])).unwrap();
        overlay_manual(&mut tasks, &known_manual(&doc), &todos, "2026-11-02", 5.0);
        let by: HashMap<_, _> = tasks.iter().map(|t| (t.title.as_str(), t)).collect();
        assert_eq!(tasks.len(), 4);
        assert!(by.contains_key("Reply to Ann"));
        assert!(!by.contains_key("Closed in Pulse"));
        assert_eq!(by["Keep"].id, "manual-1");
        assert_eq!(by["Keep"].first_seen, Some(100.0));
        assert_eq!(by["Keep"].urgency.as_deref(), Some("now"));
        assert_eq!(by["Snoozed"].status, "scheduled");
        assert!(by["Brand new"].id.starts_with("todo-"));
        assert_eq!(by["Brand new"].status, "open");
    }
}
