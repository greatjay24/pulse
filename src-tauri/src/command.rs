// ==========================================
// Commands and chat: the owner talks to a lead through ~/portfolio/bin/ask.py
// ==========================================
// ask.py validates again against portfolio.json, starts the lead in the background on the
// owner's claude sign-in (never an API key) and answers at once with the run id, whose live
// file and transcript the Working now strip and Conversations already read.

use super::{get_portfolio_dir, is_run_id, is_slug, read_portfolio_json, resolve_portfolio_file, PYTHON_CANDIDATES};
use std::path::{Path, PathBuf};

const ASK_MESSAGE_MAX: usize = 8000;
const ASK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
// Stopping waits for claude's process group to exit (up to a couple of seconds).
const STOP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
// pulse / org: the front door (portfolio.json front_door); chief-of-staff: the weekly reviewer.
const ORG_TARGETS: &[&str] = &["pulse", "org", "chief-of-staff"];

// Claude session ids are UUIDs: lowercase hex in 8-4-4-4-12.
pub(crate) fn is_session_id(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() == 5
        && parts.iter().zip([8, 4, 4, 4, 12]).all(|(p, n)| p.len() == n && p.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)))
}

// Model aliases or full names ("haiku", "claude-opus-5-5", "sonnet[1m]"): never a flag.
fn is_model(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && s.len() <= 64
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._-[]".contains(c))
}

// The argv after the script path, or why the request is refused. The message rides as one
// `--message=` argument, so its contents never become separate arguments.
pub(crate) fn ask_args(target: &str, message: &str, session: Option<&str>, fresh: bool, model: Option<&str>) -> Result<Vec<String>, String> {
    if !is_slug(target) {
        return Err("invalid target".to_string());
    }
    let message = message.trim();
    if message.is_empty() {
        return Err("type a message first".to_string());
    }
    if message.chars().count() > ASK_MESSAGE_MAX {
        return Err(format!("message is longer than {} characters", ASK_MESSAGE_MAX));
    }
    if message.contains('\0') {
        return Err("message contains a NUL byte".to_string());
    }
    let mut args = vec![target.to_string(), format!("--message={}", message)];
    match (session, fresh) {
        (Some(_), true) => return Err("pick a session or a new conversation, not both".to_string()),
        (Some(s), false) if !is_session_id(s) => return Err("invalid session id".to_string()),
        (Some(s), false) => args.push(format!("--session={}", s)),
        (None, true) => args.push("--new".to_string()),
        (None, false) => {}
    }
    if let Some(m) = model {
        if !is_model(m) {
            return Err("invalid model".to_string());
        }
        args.push(format!("--model={}", m));
    }
    Ok(args)
}

// Every agent the org runs: the front door, each entity's lead, the chief of staff and the managers.
pub(crate) fn org_agents(root: &Path) -> Result<Vec<String>, String> {
    let reg = resolve_portfolio_file(root, ".", "portfolio.json").and_then(|p| read_portfolio_json(&p))?;
    let mut out: Vec<String> = Vec::new();
    let mut add = |v: Option<&str>| {
        if let Some(s) = v.filter(|s| is_slug(s)) {
            if !out.iter().any(|x| x == s) {
                out.push(s.to_string());
            }
        }
    };
    add(reg.get("front_door").and_then(|c| c.get("lead")).and_then(|v| v.as_str()));
    for e in reg.get("entities").and_then(|e| e.as_array()).into_iter().flatten() {
        add(e.get("lead").and_then(|v| v.as_str()));
    }
    add(reg.get("chief_of_staff").and_then(|c| c.get("lead")).and_then(|v| v.as_str()));
    for m in reg.get("managers").and_then(|m| m.as_array()).into_iter().flatten() {
        add(m.as_str());
    }
    Ok(out)
}

fn target_known(root: &Path, target: &str) -> Result<(), String> {
    if ORG_TARGETS.contains(&target) {
        return Ok(());
    }
    let reg = resolve_portfolio_file(root, ".", "portfolio.json").and_then(|p| read_portfolio_json(&p))?;
    let known = reg.get("entities").and_then(|e| e.as_array()).is_some_and(|list| {
        list.iter().any(|e| {
            e.get("id").and_then(|v| v.as_str()) == Some(target) || e.get("lead").and_then(|v| v.as_str()) == Some(target)
        })
    });
    if known { Ok(()) } else { Err(format!("unknown entity or lead: {}", target)) }
}

fn python() -> Result<&'static str, String> {
    PYTHON_CANDIDATES.iter().copied().find(|p| Path::new(p).is_file()).ok_or_else(|| "python3 not found".to_string())
}

// Runs ~/portfolio/bin/ask.py and returns its one JSON line, or its refusal.
pub(crate) async fn run_ask(script: PathBuf, args: Vec<String>, timeout: std::time::Duration) -> Result<String, String> {
    let python = python()?;
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut child = std::process::Command::new(python)
            .arg(&script)
            .args(&args)
            .current_dir(home)
            .env_remove("ANTHROPIC_API_KEY")
            .env_remove("ANTHROPIC_AUTH_TOKEN")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not start ask.py: {}", e))?;
        let started = std::time::Instant::now();
        while child.try_wait().map_err(|e| e.to_string())?.is_none() {
            if started.elapsed() > timeout {
                let _ = child.kill();
                return Err("ask.py did not answer in time".to_string());
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        let line = stdout.lines().last().unwrap_or("").trim().to_string();
        match serde_json::from_str::<serde_json::Value>(&line) {
            Ok(v) if v.get("ok").and_then(|o| o.as_bool()) == Some(true) => Ok(line),
            Ok(v) => Err(v.get("error").and_then(|e| e.as_str()).unwrap_or("ask.py refused").to_string()),
            Err(_) => Err(format!("ask.py failed: {}", String::from_utf8_lossy(&out.stderr).trim().chars().take(300).collect::<String>())),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn ask_script(root: &Path) -> Result<PathBuf, String> {
    resolve_portfolio_file(root, "bin", "ask.py").map_err(|_| "~/portfolio/bin/ask.py is missing: update the org's bin scripts".to_string())
}

#[tauri::command]
pub(crate) async fn ask_lead(target: String, message: String, session: Option<String>, fresh: Option<bool>, model: Option<String>) -> Result<String, String> {
    let args = ask_args(&target, &message, session.as_deref(), fresh.unwrap_or(false), model.as_deref())?;
    let root = get_portfolio_dir()?;
    target_known(&root, &target)?;
    run_ask(ask_script(&root)?, args, ASK_TIMEOUT).await
}

#[tauri::command]
pub(crate) async fn stop_run(run_id: String) -> Result<String, String> {
    if !is_run_id(&run_id) {
        return Err("invalid run id".to_string());
    }
    let root = get_portfolio_dir()?;
    run_ask(ask_script(&root)?, vec![format!("--stop={}", run_id)], STOP_TIMEOUT).await
}

// "Open in Terminal.app": a one-off .command file Terminal runs, so no Apple Events
// permission is needed. The agent is checked against the org; the file holds nothing else.
pub(crate) fn terminal_script(agent: Option<&str>) -> String {
    let run = match agent {
        Some(a) => format!("exec claude --agent {}", a),
        None => "exec claude".to_string(),
    };
    format!("#!/bin/zsh -l\ncd ~ || exit 1\nunset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN\nrm -f \"$0\"\n{}\n", run)
}

pub(crate) fn check_agent(agent: Option<&str>) -> Result<Option<String>, String> {
    match agent {
        None => Ok(None),
        Some(a) => {
            if !is_slug(a) {
                return Err("invalid agent".to_string());
            }
            let root = get_portfolio_dir()?;
            if org_agents(&root)?.iter().any(|x| x == a) {
                Ok(Some(a.to_string()))
            } else {
                Err(format!("unknown agent: {}", a))
            }
        }
    }
}

#[tauri::command]
pub(crate) fn open_in_terminal(agent: Option<String>) -> Result<(), String> {
    let agent = check_agent(agent.as_deref())?;
    let dir = std::env::temp_dir().join("pulse-terminal");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}-{}.command", agent.as_deref().unwrap_or("claude"), std::process::id()));
    std::fs::write(&path, terminal_script(agent.as_deref())).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    std::process::Command::new("/usr/bin/open")
        .args(["-a", "Terminal"])
        .arg(&path)
        .spawn()
        .map_err(|e| format!("could not open Terminal: {}", e))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn list_org_agents() -> Result<Vec<String>, String> {
    org_agents(&get_portfolio_dir()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const SID: &str = "d0cc6ba1-f32e-4b4e-84e2-cc7367132ffd";

    #[test]
    fn session_ids_are_uuids() {
        assert!(is_session_id(SID));
        for bad in ["", "--resume", "D0CC6BA1-F32E-4B4E-84E2-CC7367132FFD", "d0cc6ba1-f32e-4b4e-84e2", "../d0cc6ba1-f32e-4b4e-84e2-cc7367132ff", "g0cc6ba1-f32e-4b4e-84e2-cc7367132ffd"] {
            assert!(!is_session_id(bad), "{bad}");
        }
    }

    #[test]
    fn ask_args_validate_every_input() {
        assert_eq!(ask_args("acme", " hi ", None, false, None).unwrap(), vec!["acme", "--message=hi"]);
        assert_eq!(ask_args("org", "hi", None, true, Some("haiku")).unwrap(), vec!["org", "--message=hi", "--new", "--model=haiku"]);
        assert_eq!(ask_args("acme", "hi", Some(SID), false, None).unwrap()[2], format!("--session={}", SID));
        assert!(ask_args("--stop", "hi", None, false, None).is_err());
        assert!(ask_args("../acme", "hi", None, false, None).is_err());
        assert!(ask_args("acme", "   ", None, false, None).is_err());
        assert!(ask_args("acme", &"x".repeat(8001), None, false, None).is_err());
        assert!(ask_args("acme", "a\0b", None, false, None).is_err());
        assert!(ask_args("acme", "hi", Some("nope"), false, None).is_err());
        assert!(ask_args("acme", "hi", Some(SID), true, None).is_err());
        assert!(ask_args("acme", "hi", None, false, Some("--dangerously-skip-permissions")).is_err());
        assert!(ask_args("acme", "hi", None, false, Some("a b")).is_err());
    }

    #[test]
    fn message_is_one_argument_even_when_it_looks_like_flags() {
        let args = ask_args("acme", "--stop x --worker /tmp/j; $(rm -rf ~)\n--new", None, false, None).unwrap();
        assert_eq!(args.len(), 2);
        assert_eq!(args[1], "--message=--stop x --worker /tmp/j; $(rm -rf ~)\n--new");
    }

    #[test]
    fn org_agents_and_targets_come_from_the_registry() {
        let root = std::env::temp_dir().join(format!("pulse-ask-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        fs::write(
            root.join("portfolio.json"),
            r#"{"front_door":{"lead":"pulse"},"entities":[{"id":"acme","lead":"acme-lead"},{"id":"bad","lead":"--x"}],"chief_of_staff":{"lead":"chief-of-staff"},"managers":["sales-manager","acme-lead"]}"#,
        )
        .unwrap();
        assert_eq!(org_agents(&root).unwrap(), vec!["pulse", "acme-lead", "chief-of-staff", "sales-manager"]);
        assert!(target_known(&root, "pulse").is_ok());
        assert!(target_known(&root, "acme").is_ok());
        assert!(target_known(&root, "acme-lead").is_ok());
        assert!(target_known(&root, "org").is_ok());
        assert!(target_known(&root, "globex").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn terminal_script_runs_only_claude() {
        let s = terminal_script(Some("acme-lead"));
        assert!(s.ends_with("exec claude --agent acme-lead\n"));
        assert!(s.contains("unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN"));
        assert!(terminal_script(None).ends_with("exec claude\n"));
    }
}
