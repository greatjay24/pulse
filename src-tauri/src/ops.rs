// ==========================================
// Operations: the Outbox (one-click send), Goals and Connections
// ==========================================
// Reads are local files under ~/portfolio. Writes go through the org's own scripts
// (bin/outbox.py, bin/outbox_send.py, bin/connections_check.py), except goals.json, which
// is validated here and written atomically.
//
// The send guard (bin/sendguard.py has the full design): the owner's click is the only
// thing that can send. On Send, Pulse re-reads the message, checks it still hashes to what
// the owner was shown, signs a one-time approval with an Ed25519 key whose secret half lives
// in the macOS Keychain (an item this process created, so only Pulse can read it without the
// owner seeing a prompt), and hands the approval to outbox_send.py on stdin. outbox_send.py
// refuses anything without a valid, unexpired, unused approval for that exact content.

use crate::{get_portfolio_dir, is_slug, read_portfolio_json, read_text_capped, resolve_portfolio_file, PYTHON_CANDIDATES};
use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

const OUTBOX_MAX_ITEMS: usize = 300;
const OUTBOX_ITEM_MAX_BYTES: u64 = 256 * 1024;
const APPROVAL_TTL_SECS: i64 = 120;
const KEYCHAIN_SERVICE: &str = "pulse-outbox-send";
const KEYCHAIN_ACCOUNT: &str = "ed25519-seed";
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(20);
const SEND_TIMEOUT: Duration = Duration::from_secs(90);
const CHECK_TIMEOUT: Duration = Duration::from_secs(240);

// ------------------------------------------
// Running the org's scripts: fixed interpreter, fixed script path, validated args
// ------------------------------------------

fn run_script(root: &Path, script: &str, args: &[String], stdin: Option<&str>, timeout: Duration) -> Result<serde_json::Value, String> {
    let path = resolve_portfolio_file(root, "bin", script).map_err(|e| format!("~/portfolio/bin/{}: {}", script, e))?;
    let python = PYTHON_CANDIDATES.iter().find(|p| Path::new(p).is_file()).ok_or("python3 not found")?;
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let mut child = std::process::Command::new(python)
        .arg(&path)
        .args(args)
        .current_dir(home)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start {}: {}", script, e))?;
    {
        // Always close stdin, so a script that reads it never waits.
        let mut pipe = child.stdin.take().ok_or("no stdin")?;
        if let Some(text) = stdin {
            pipe.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        }
    }
    let started = std::time::Instant::now();
    while child.try_wait().map_err(|e| e.to_string())?.is_none() {
        if started.elapsed() > timeout {
            let _ = child.kill();
            return Err(format!("{} did not answer in time", script));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // The scripts print one JSON object; take the whole output (mail-style indents) or the last line.
    let parsed = serde_json::from_str::<serde_json::Value>(stdout.trim())
        .or_else(|_| serde_json::from_str::<serde_json::Value>(stdout.lines().last().unwrap_or("").trim()));
    match parsed {
        Ok(v) if v.get("ok").and_then(|o| o.as_bool()) == Some(true) => Ok(v),
        Ok(v) => Err(v.get("error").and_then(|e| e.as_str()).unwrap_or("refused").to_string()),
        Err(_) => Err(format!(
            "{} failed: {}",
            script,
            String::from_utf8_lossy(&out.stderr).trim().chars().take(300).collect::<String>()
        )),
    }
}

async fn run_script_async(script: &'static str, args: Vec<String>, stdin: Option<String>, timeout: Duration) -> Result<serde_json::Value, String> {
    let root = get_portfolio_dir()?;
    tauri::async_runtime::spawn_blocking(move || run_script(&root, script, &args, stdin.as_deref(), timeout))
        .await
        .map_err(|e| e.to_string())?
}

// ------------------------------------------
// Outbox
// ------------------------------------------

fn str_list(v: Option<&serde_json::Value>) -> Vec<String> {
    v.and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn str_field<'a>(item: &'a serde_json::Value, key: &str) -> &'a str {
    item.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

// What the owner approves for each non-email kind, in order. Mirrors sendguard.HASH_FIELDS.
const HASH_FIELDS: &[(&str, &[&str])] = &[
    ("post", &["channel", "title", "body", "link", "media"]),
    ("text", &["to", "body"]),
    ("dm", &["channel", "to", "body", "link"]),
    ("slack", &["channel", "body", "link"]),
    ("stripe_send_invoice", &["stripe_id", "customer_id", "amount", "currency", "due_date", "subject", "body"]),
    ("stripe_send_quote", &["stripe_id", "customer_id", "amount", "currency", "subject", "body"]),
    ("stripe_refund", &["stripe_id", "amount", "currency", "reason", "subject", "body"]),
    ("stripe_subscription", &["action", "stripe_id", "customer_id", "items", "amount", "currency", "interval", "days_until_due", "subject", "body"]),
];

// Mirrors sendguard._part: strings as is, integers in decimal, lists joined with U+001F, null/missing empty.
fn hash_part(v: Option<&serde_json::Value>) -> Result<String, String> {
    match v {
        None | Some(serde_json::Value::Null) => Ok(String::new()),
        Some(serde_json::Value::String(s)) => Ok(s.clone()),
        Some(serde_json::Value::Number(n)) if n.is_i64() || n.is_u64() => Ok(n.to_string()),
        Some(serde_json::Value::Array(a)) => Ok(a.iter().map(|x| hash_part(Some(x))).collect::<Result<Vec<_>, _>>()?.join("\u{1f}")),
        Some(other) => Err(format!("can't hash {}", other)),
    }
}

fn item_kind(item: &serde_json::Value) -> &str {
    match str_field(item, "kind") {
        "" => "email",
        k => k,
    }
}

// Mirrors sendguard.content_hash. Email: the fields in order, lists joined with ',', U+001E between
// (unchanged since the first Outbox). Other kinds: "kind:<kind>", the entity, then HASH_FIELDS.
pub(crate) fn content_hash(item: &serde_json::Value) -> Result<String, String> {
    let kind = item_kind(item);
    if kind != "email" {
        let fields = HASH_FIELDS.iter().find(|(k, _)| *k == kind).map(|(_, f)| *f).ok_or_else(|| format!("unknown kind: {}", kind))?;
        let mut parts = vec![format!("kind:{}", kind), str_field(item, "entity").to_string()];
        for f in fields {
            parts.push(hash_part(item.get(*f))?);
        }
        return Ok(hex::encode(Sha256::digest(parts.join("\u{1e}").as_bytes())));
    }
    let parts = [
        str_field(item, "account").to_string(),
        str_list(item.get("to")).join(","),
        str_list(item.get("cc")).join(","),
        str_field(item, "subject").to_string(),
        str_field(item, "body").to_string(),
        str_field(item, "in_reply_to").to_string(),
        str_list(item.get("references")).join(" "),
    ];
    Ok(hex::encode(Sha256::digest(parts.join("\u{1e}").as_bytes())))
}

fn is_outbox_id(s: &str) -> bool {
    is_slug(s) && !s.contains('_')
}

#[derive(Serialize)]
struct OutboxItem {
    content: String,
    item: serde_json::Value,
}

#[derive(Serialize)]
struct OutboxSnapshot {
    items: Vec<OutboxItem>,
    key: Option<String>,
    errors: Vec<String>,
    read_at: String,
}

fn read_outbox_at(root: &Path) -> OutboxSnapshot {
    let mut items = Vec::new();
    let mut errors = Vec::new();
    if let Ok(dir) = fs::read_dir(root.join("outbox")) {
        for entry in dir.filter_map(|e| e.ok()) {
            let Some(name) = entry.file_name().to_str().map(String::from) else { continue };
            let Some(id) = name.strip_suffix(".json") else { continue };
            if !is_outbox_id(id) {
                continue;
            }
            match resolve_portfolio_file(root, "outbox", &name)
                .and_then(|p| read_text_capped(&p, OUTBOX_ITEM_MAX_BYTES))
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).map_err(|e| format!("malformed: {}", e)))
            {
                Ok(item) if item.get("id").and_then(|v| v.as_str()) == Some(id) => match content_hash(&item) {
                    Ok(content) => items.push(OutboxItem { content, item }),
                    Err(e) => errors.push(format!("outbox/{}: {}", name, e)),
                },
                Ok(_) => errors.push(format!("outbox/{}: id does not match the file name", name)),
                Err(e) => errors.push(format!("outbox/{}: {}", name, e)),
            }
        }
    }
    items.sort_by(|a, b| str_field(&b.item, "created_at").cmp(str_field(&a.item, "created_at")));
    items.truncate(OUTBOX_MAX_ITEMS);
    let key = fs::read_to_string(pubkey_path(root)).ok().and_then(|t| fingerprint_hex(t.trim()));
    OutboxSnapshot { items, key, errors, read_at: chrono::Local::now().to_rfc3339() }
}

#[tauri::command]
pub async fn read_outbox() -> Result<String, String> {
    let root = get_portfolio_dir()?;
    let snap = tauri::async_runtime::spawn_blocking(move || read_outbox_at(&root)).await.map_err(|e| e.to_string())?;
    serde_json::to_string(&snap).map_err(|e| e.to_string())
}

// The owner's edit. Which fields a kind may change is decided (and validated) by bin/outbox.py;
// here only the shape and size are checked.
const EDIT_FIELDS: &[&str] = &["to", "cc", "subject", "body", "title", "link"];

pub(crate) fn edit_fields_ok(fields: &serde_json::Value) -> Result<(), String> {
    let obj = fields.as_object().ok_or("edit must be an object")?;
    if obj.is_empty() {
        return Err("nothing to save".to_string());
    }
    if let Some(k) = obj.keys().find(|k| !EDIT_FIELDS.contains(&k.as_str())) {
        return Err(format!("can't edit {}", k));
    }
    if fields.to_string().len() > 64 * 1024 {
        return Err("message is too long".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn outbox_edit(id: String, fields: serde_json::Value) -> Result<String, String> {
    if !is_outbox_id(&id) {
        return Err("invalid outbox id".to_string());
    }
    edit_fields_ok(&fields)?;
    let v = run_script_async("outbox.py", vec!["edit".into(), id], Some(fields.to_string()), SCRIPT_TIMEOUT).await?;
    Ok(v.to_string())
}

// The owner posted an approved post/text/DM/Slack message by hand.
#[tauri::command]
pub async fn outbox_mark_published(id: String) -> Result<String, String> {
    if !is_outbox_id(&id) {
        return Err("invalid outbox id".to_string());
    }
    let v = run_script_async("outbox.py", vec!["published".into(), id], None, SCRIPT_TIMEOUT).await?;
    Ok(v.to_string())
}

#[tauri::command]
pub async fn outbox_skip(id: String) -> Result<String, String> {
    if !is_outbox_id(&id) {
        return Err("invalid outbox id".to_string());
    }
    let v = run_script_async("outbox.py", vec!["skip".into(), id], None, SCRIPT_TIMEOUT).await?;
    Ok(v.to_string())
}

// ------------------------------------------
// The send key: Keychain-held Ed25519, public half in .cache/outbox/send_key.pub
// ------------------------------------------

fn pubkey_path(root: &Path) -> PathBuf {
    root.join(".cache").join("outbox").join("send_key.pub")
}

fn fingerprint_hex(pub_hex: &str) -> Option<String> {
    let bytes = hex::decode(pub_hex).ok()?;
    (bytes.len() == 32).then(|| hex::encode(&Sha256::digest(&bytes)[..8]))
}

#[cfg(target_os = "macos")]
fn keychain_seed() -> Result<[u8; 32], String> {
    use security_framework::passwords::{get_generic_password, set_generic_password};
    match get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        Ok(bytes) => bytes.try_into().map_err(|_| "the send key in the Keychain is malformed".to_string()),
        Err(e) if e.code() == -25300 => {
            // errSecItemNotFound: first send on this Mac. Created by this process, so the
            // item's access list trusts Pulse alone.
            let mut seed = [0u8; 32];
            getrandom::getrandom(&mut seed).map_err(|e| e.to_string())?;
            set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, &seed).map_err(|e| format!("could not save the send key: {}", e))?;
            Ok(seed)
        }
        Err(e) => Err(format!("could not read the send key from the Keychain: {}", e)),
    }
}

#[cfg(not(target_os = "macos"))]
fn keychain_seed() -> Result<[u8; 32], String> {
    Err("one-click send needs the macOS Keychain".to_string())
}

// The pinned public key must be ours. If something replaced it, put ours back and say so.
fn ensure_pubkey(root: &Path, key: &SigningKey) -> Result<Option<String>, String> {
    let path = pubkey_path(root);
    let ours = hex::encode(key.verifying_key().to_bytes());
    let current = fs::read_to_string(&path).ok().map(|t| t.trim().to_string());
    if current.as_deref() == Some(ours.as_str()) {
        return Ok(None);
    }
    fs::create_dir_all(path.parent().ok_or("bad path")?).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("pub.tmp");
    fs::write(&tmp, format!("{}\n", ours)).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(current.map(|_| "The send key file had been changed by something other than Pulse. Pulse restored it.".to_string()))
}

pub(crate) fn approval(key: &SigningKey, id: &str, content: &str, nonce: &str, exp: i64) -> String {
    // preserve_order keeps the keys as written; Python verifies these exact bytes.
    let payload = serde_json::json!({ "v": 1, "purpose": "outbox-send", "id": id, "content": content, "nonce": nonce, "exp": exp }).to_string();
    let sig = key.sign(payload.as_bytes());
    serde_json::json!({ "payload": payload, "sig": hex::encode(sig.to_bytes()) }).to_string()
}

#[tauri::command]
pub async fn outbox_send(id: String, content: String) -> Result<String, String> {
    if !is_outbox_id(&id) {
        return Err("invalid outbox id".to_string());
    }
    if content.len() != 64 || !content.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid content hash".to_string());
    }
    let root = get_portfolio_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        // What the owner saw must still be what's on disk.
        let path = resolve_portfolio_file(&root, "outbox", &format!("{}.json", id)).map_err(|e| format!("outbox item: {}", e))?;
        let item: serde_json::Value =
            serde_json::from_str(&read_text_capped(&path, OUTBOX_ITEM_MAX_BYTES)?).map_err(|e| format!("malformed: {}", e))?;
        if str_field(&item, "id") != id {
            return Err("outbox item id does not match".to_string());
        }
        if str_field(&item, "status") != "pending" {
            return Err(format!("not sending: it is {}", str_field(&item, "status")));
        }
        if content_hash(&item)? != content {
            return Err("This message changed since you opened it. Review it and click Send again.".to_string());
        }
        let key = SigningKey::from_bytes(&keychain_seed()?);
        let warning = ensure_pubkey(&root, &key)?;
        let mut nonce = [0u8; 16];
        getrandom::getrandom(&mut nonce).map_err(|e| e.to_string())?;
        let exp = chrono::Utc::now().timestamp() + APPROVAL_TTL_SECS;
        let appr = approval(&key, &id, &content, &hex::encode(nonce), exp);
        let mut v = run_script(&root, "outbox_send.py", &[id], Some(&appr), SEND_TIMEOUT)?;
        if let (Some(w), Some(o)) = (warning, v.as_object_mut()) {
            o.insert("warning".into(), w.into());
        }
        Ok(v.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ------------------------------------------
// Goals: <entity path>/goals.json, validated here (mirrors bin/goals.py)
// ------------------------------------------

const GOAL_SOURCES: &[&str] = &["status", "stripe", "bank", "sales", "github", "tracker", "manual", "other"];
const GOAL_KEYS: &[&str] = &[
    "id", "title", "metric", "target", "unit", "by", "current", "source", "owner_note", "proposed", "start", "baseline",
    "direction", "lead_note", "at_risk", "updated", "source_detail",
];

fn goal_text(v: Option<&serde_json::Value>, name: &str, max: usize, required: bool) -> Result<String, String> {
    let s = match v {
        None | Some(serde_json::Value::Null) if !required => return Ok(String::new()),
        Some(serde_json::Value::String(s)) => s.chars().filter(|c| !c.is_control()).collect::<String>().trim().to_string(),
        _ => return Err(format!("{} must be text", name)),
    };
    if required && s.is_empty() {
        return Err(format!("{} is required", name));
    }
    if s.chars().count() > max {
        return Err(format!("{} is longer than {} characters", name, max));
    }
    Ok(s)
}

fn goal_num(v: Option<&serde_json::Value>, name: &str) -> Result<serde_json::Value, String> {
    match v {
        None | Some(serde_json::Value::Null) => Ok(serde_json::Value::Null),
        Some(n @ serde_json::Value::Number(x)) if x.as_f64().is_some_and(|f| f.is_finite()) => Ok(n.clone()),
        _ => Err(format!("{} must be a number or empty", name)),
    }
}

fn goal_date(v: Option<&serde_json::Value>, name: &str) -> Result<serde_json::Value, String> {
    match v {
        None | Some(serde_json::Value::Null) => Ok(serde_json::Value::Null),
        Some(serde_json::Value::String(s)) if s.is_empty() => Ok(serde_json::Value::Null),
        Some(serde_json::Value::String(s)) if s.len() == 10 && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok() => Ok(s.clone().into()),
        _ => Err(format!("{} must be a date (YYYY-MM-DD)", name)),
    }
}

// The owner's edit of one goal: the editable fields are re-validated, the rest kept from disk.
pub(crate) fn merge_goal(existing: &serde_json::Value, edit: &serde_json::Value) -> Result<serde_json::Value, String> {
    let edit = edit.as_object().ok_or("goal must be an object")?;
    if let Some(k) = edit.keys().find(|k| !GOAL_KEYS.contains(&k.as_str())) {
        return Err(format!("unknown goal field: {}", k));
    }
    let mut g = existing.as_object().cloned().ok_or("goal on disk is malformed")?;
    let editable = ["title", "metric", "target", "unit", "by", "current", "owner_note", "proposed"];
    for k in editable {
        if let Some(v) = edit.get(k) {
            g.insert(k.to_string(), v.clone());
        }
    }
    g.insert("title".into(), goal_text(g.get("title"), "title", 160, true)?.into());
    g.insert("metric".into(), goal_text(g.get("metric"), "metric", 160, true)?.into());
    g.insert("unit".into(), goal_text(g.get("unit"), "unit", 24, false)?.into());
    g.insert("owner_note".into(), goal_text(g.get("owner_note"), "owner note", 500, false)?.into());
    g.insert("target".into(), goal_num(g.get("target"), "target")?);
    g.insert("current".into(), goal_num(g.get("current"), "current")?);
    g.insert("by".into(), goal_date(g.get("by"), "date")?);
    match g.get("proposed") {
        None | Some(serde_json::Value::Bool(_)) => {}
        _ => return Err("proposed must be true or false".to_string()),
    }
    let source = g.get("source").and_then(|s| s.as_str()).unwrap_or("");
    if !GOAL_SOURCES.contains(&source) {
        return Err("goal source is not one of the known sources".to_string());
    }
    g.insert("updated".into(), chrono::Local::now().format("%Y-%m-%d").to_string().into());
    Ok(serde_json::Value::Object(g))
}

fn entity_path(root: &Path, entity_id: &str) -> Result<String, String> {
    let registry = resolve_portfolio_file(root, ".", "portfolio.json").and_then(|p| read_portfolio_json(&p))?;
    registry
        .get("entities")
        .and_then(|e| e.as_array())
        .and_then(|list| list.iter().find(|e| e.get("id").and_then(|v| v.as_str()) == Some(entity_id)))
        .and_then(|e| e.get("path").and_then(|p| p.as_str()).map(String::from))
        .ok_or_else(|| format!("unknown entity: {}", entity_id))
}

#[derive(Serialize)]
struct GoalsReport {
    entity: String,
    goals: Option<serde_json::Value>,
    error: Option<String>,
}

#[tauri::command]
pub fn read_goals() -> Result<String, String> {
    let root = get_portfolio_dir()?;
    let registry = resolve_portfolio_file(&root, ".", "portfolio.json").and_then(|p| read_portfolio_json(&p))?;
    let mut out = Vec::new();
    for e in registry.get("entities").and_then(|e| e.as_array()).cloned().unwrap_or_default() {
        let (Some(id), Some(rel)) = (e.get("id").and_then(|v| v.as_str()), e.get("path").and_then(|v| v.as_str())) else { continue };
        let (goals, error) = match resolve_portfolio_file(&root, rel, "goals.json").and_then(|p| read_portfolio_json(&p)) {
            Ok(v) => (Some(v), None),
            Err(e) => (None, Some(e)),
        };
        out.push(GoalsReport { entity: id.to_string(), goals, error });
    }
    serde_json::to_string(&serde_json::json!({ "entities": out, "read_at": chrono::Local::now().to_rfc3339() })).map_err(|e| e.to_string())
}

pub(crate) fn save_goal_at(root: &Path, entity_id: &str, goal: &serde_json::Value) -> Result<serde_json::Value, String> {
    if !is_slug(entity_id) {
        return Err("invalid entity id".to_string());
    }
    let gid = goal.get("id").and_then(|v| v.as_str()).ok_or("goal needs an id")?;
    if !is_slug(gid) {
        return Err("invalid goal id".to_string());
    }
    let rel = entity_path(root, entity_id)?;
    let path = resolve_portfolio_file(root, &rel, "goals.json")?;
    let mut doc = read_portfolio_json(&path)?;
    let list = doc.get_mut("goals").and_then(|g| g.as_array_mut()).ok_or("goals.json has no goals list")?;
    let slot = list.iter_mut().find(|g| g.get("id").and_then(|v| v.as_str()) == Some(gid)).ok_or_else(|| format!("no goal {}", gid))?;
    let merged = merge_goal(slot, goal)?;
    *slot = merged.clone();
    if let Some(o) = doc.as_object_mut() {
        o.insert("updated".into(), chrono::Local::now().to_rfc3339().into());
    }
    let text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())? + "\n";
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(merged)
}

#[tauri::command]
pub fn save_goal(entity_id: String, goal: serde_json::Value) -> Result<String, String> {
    let root = get_portfolio_dir()?;
    save_goal_at(&root, &entity_id, &goal).map(|g| g.to_string())
}

// ------------------------------------------
// Connections
// ------------------------------------------

#[tauri::command]
pub fn read_connections() -> Result<String, String> {
    let root = get_portfolio_dir()?;
    let path = resolve_portfolio_file(&root, ".", "connections.json")?;
    let doc = read_portfolio_json(&path)?;
    serde_json::to_string(&doc).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_connections() -> Result<String, String> {
    let v = run_script_async("connections_check.py", vec!["--json".into()], None, CHECK_TIMEOUT).await?;
    Ok(v.to_string())
}

#[cfg(test)]
mod ops_tests {
    use super::*;

    // The same constants as bin/test_outbox.py: Pulse signs, Python verifies.
    const PY_SIG: &str = "1bd81ad2d9c09a4be45b085b9afe9f4bd4631660a894a0d283f3d36061f83d9b91e3ea32f0b5fe2af79540453263bd851d012f2b4824245dca81497e1b35a50d";
    const PY_HASH: &str = "56815c408ccd028772d47aa56846591b90c3b4c5994b34aeaa736d4f08d37a9d";

    fn seed() -> [u8; 32] {
        let mut s = [0u8; 32];
        for (i, b) in s.iter_mut().enumerate() {
            *b = i as u8 + 1;
        }
        s
    }

    #[test]
    fn signature_matches_python() {
        let key = SigningKey::from_bytes(&seed());
        assert_eq!(hex::encode(key.verifying_key().to_bytes()), "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664");
        let msg = br#"{"v":1,"purpose":"outbox-send","id":"x","content":"c","nonce":"n","exp":1}"#;
        assert_eq!(hex::encode(key.sign(msg).to_bytes()), PY_SIG);
    }

    #[test]
    fn approval_payload_is_what_python_expects() {
        let key = SigningKey::from_bytes(&seed());
        let a: serde_json::Value = serde_json::from_str(&approval(&key, "x", "c", "n", 1)).unwrap();
        assert_eq!(a["payload"], r#"{"v":1,"purpose":"outbox-send","id":"x","content":"c","nonce":"n","exp":1}"#);
        assert_eq!(a["sig"], PY_SIG);
    }

    #[test]
    fn content_hash_matches_python() {
        let item = serde_json::json!({"account": "studio", "to": ["a@x.com", "b@y.com"], "cc": [], "subject": "Hi – there",
            "body": "Line 1\nLine 2\n", "in_reply_to": "m1@x", "references": ["m0@x", "m1@x"]});
        assert_eq!(content_hash(&item).unwrap(), PY_HASH);
        let mut edited = item.clone();
        edited["body"] = "Line 1\n".into();
        assert_ne!(content_hash(&edited).unwrap(), PY_HASH);
        // An explicit "email" kind hashes like the original Outbox items.
        let mut tagged = item.clone();
        tagged["kind"] = "email".into();
        assert_eq!(content_hash(&tagged).unwrap(), PY_HASH);
    }

    // Same item and constant as bin/test_outbox.py `test_kind_hash_matches_pulse`.
    #[test]
    fn kind_hash_matches_python() {
        let item = serde_json::json!({"kind": "stripe_subscription", "entity": "acme", "action": "create", "stripe_id": null,
            "customer_id": "cus_A1", "items": ["price_A:2", "price_B:1"], "amount": 4500, "currency": "usd",
            "interval": "month", "days_until_due": 30, "subject": "Start – sub", "body": "Line 1\nLine 2"});
        assert_eq!(content_hash(&item).unwrap(), "ff42dcc39b97ad759cd18bb70e8f393fd8b715a0e4c977c2ae1f06cbce12d7e3");
        let mut more = item.clone();
        more["amount"] = 4501.into();
        assert_ne!(content_hash(&more).unwrap(), content_hash(&item).unwrap());
        assert!(content_hash(&serde_json::json!({"kind": "fax"})).is_err());
        assert!(content_hash(&serde_json::json!({"kind": "stripe_refund", "amount": 1.5})).is_err());
    }

    #[test]
    fn edit_fields_are_checked() {
        assert!(edit_fields_ok(&serde_json::json!({"body": "hi", "link": "https://x.example"})).is_ok());
        assert!(edit_fields_ok(&serde_json::json!({"amount": 1})).is_err());
        assert!(edit_fields_ok(&serde_json::json!({})).is_err());
        assert!(edit_fields_ok(&serde_json::json!("body")).is_err());
    }

    #[test]
    fn outbox_ids_are_strict() {
        assert!(is_outbox_id("20261029-101500-acme-logo-files-ab12"));
        for bad in ["", "../x", "a_b", "A", "-x", "a/b", "a.json"] {
            assert!(!is_outbox_id(bad), "{bad}");
        }
    }

    fn temp_root() -> PathBuf {
        let mut n = [0u8; 6];
        getrandom::getrandom(&mut n).unwrap();
        let root = std::env::temp_dir().join(format!("pulse-ops-test-{}", hex::encode(n)));
        fs::create_dir_all(root.join("companies/acme")).unwrap();
        fs::write(root.join("portfolio.json"), r#"{"entities":[{"id":"acme","path":"companies/acme"},{"id":"evil","path":"../x"}]}"#).unwrap();
        fs::write(
            root.join("companies/acme/goals.json"),
            r#"{"entity":"acme","goals":[{"id":"acme-cash","title":"Cash","metric":"Cash in","target":null,"unit":"USD","by":null,"current":5,"source":"stripe","owner_note":"","proposed":true,"lead_note":"keep me"}]}"#,
        )
        .unwrap();
        root.canonicalize().unwrap()
    }

    #[test]
    fn goal_edits_are_validated_and_keep_lead_fields() {
        let root = temp_root();
        let ok = save_goal_at(&root, "acme", &serde_json::json!({"id": "acme-cash", "target": 10000, "by": "2026-12-31", "proposed": false})).unwrap();
        assert_eq!(ok["target"], 10000);
        assert_eq!(ok["proposed"], false);
        assert_eq!(ok["lead_note"], "keep me");
        let disk: serde_json::Value = serde_json::from_str(&fs::read_to_string(root.join("companies/acme/goals.json")).unwrap()).unwrap();
        assert_eq!(disk["goals"][0]["by"], "2026-12-31");

        for bad in [
            serde_json::json!({"id": "acme-cash", "target": "lots"}),
            serde_json::json!({"id": "acme-cash", "by": "Dec 31"}),
            serde_json::json!({"id": "acme-cash", "by": "2026-02-30"}),
            serde_json::json!({"id": "acme-cash", "title": ""}),
            serde_json::json!({"id": "acme-cash", "hack": 1}),
            serde_json::json!({"id": "nope", "target": 1}),
            serde_json::json!({"id": "../x", "target": 1}),
        ] {
            assert!(save_goal_at(&root, "acme", &bad).is_err(), "{bad}");
        }
        assert!(save_goal_at(&root, "evil", &serde_json::json!({"id": "acme-cash"})).is_err());
        assert!(save_goal_at(&root, "Acme", &serde_json::json!({"id": "acme-cash"})).is_err());
        // `source` is not editable from Pulse, so an attempt to change it is ignored, not applied.
        let kept = save_goal_at(&root, "acme", &serde_json::json!({"id": "acme-cash", "source": "vibes"})).unwrap();
        assert_eq!(kept["source"], "stripe");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn outbox_reads_only_well_named_items() {
        let root = temp_root();
        fs::create_dir_all(root.join("outbox")).unwrap();
        fs::write(root.join("outbox/a-1.json"), r#"{"id":"a-1","account":"studio","to":["x@y.z"],"subject":"s","body":"b","created_at":"2026-10-29"}"#).unwrap();
        fs::write(root.join("outbox/b-2.json"), r#"{"id":"other"}"#).unwrap();
        fs::write(root.join("outbox/Bad.json"), r#"{"id":"Bad"}"#).unwrap();
        let snap = read_outbox_at(&root);
        assert_eq!(snap.items.len(), 1);
        assert_eq!(snap.items[0].content, content_hash(&snap.items[0].item).unwrap());
        assert_eq!(snap.errors.len(), 1);
        let _ = fs::remove_dir_all(&root);
    }
}
