// ==========================================
// Terminals: every terminal session on this Mac, in one list
// ==========================================
// Roo's Terminal page shows two kinds of session:
//
// - tmux sessions. Every terminal opened from Roo (and from ~/portfolio/bin/open-sessions.sh)
//   runs inside a named tmux session, so the same session can be attached from a Roo tab
//   (pty.rs) and from Terminal.app at once, and it outlives both: closing either only detaches.
// - Terminal.app windows that aren't tmux. A running process can't be adopted, so these are shown
//   as what they are (name, folder, and Claude Code's status when it runs there), with a read-only
//   mirror of the window and a button that brings it to the front. Nothing is ever typed into them.
//
// Claude Code sessions are matched to both by their terminal (tty): each interactive session
// writes ~/.claude/sessions/<pid>.json (name, folder, idle/busy), and `ps` gives the pid's tty.
// Terminal.app is read over Apple Events (macOS asks once: "Roo wants to control Terminal");
// without that permission the list still shows every Claude Code session, from its own file.

use portable_pty::CommandBuilder;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use super::pty::{self, Ptys};

const TMUX_CANDIDATES: &[&str] = &["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"];
const NAME_MAX: usize = 60;
const OSA_TIMEOUT: Duration = Duration::from_secs(4);
const PEEK_MAX: usize = 200 * 1024;

// Applied to the tmux server whenever Roo starts or attaches a session (and by open-sessions.sh
// when it starts the server), so tmux behaves like a plain terminal in Roo and in Terminal.app:
// no status bar (Roo has tabs), no Esc delay (Claude Code reads Esc), the outer terminal keeps
// its own scrollback and selection (no alternate screen, no mouse capture), true colour.
pub(crate) const TMUX_CONF: &str = "# Managed by Roo: rewritten when Roo starts a terminal. Edits here are replaced.\n\
set -g default-terminal \"xterm-256color\"\n\
set -s escape-time 0\n\
set -g history-limit 50000\n\
set -g status off\n\
set -g mouse off\n\
set -g focus-events on\n\
set -g allow-passthrough on\n\
set -g window-size latest\n\
set -g aggressive-resize on\n\
set -g set-titles on\n\
set -g set-titles-string \"#S\"\n\
set -s 'terminal-overrides[90]' 'xterm*:smcup@:rmcup@'\n\
set -s 'terminal-features[90]' 'xterm*:RGB'\n";

// ------------------------------------------
// What the page gets
// ------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
pub(crate) struct ClaudeInfo {
    pub name: Option<String>,
    pub status: Option<String>, // idle, busy, shell (Claude Code's own words)
    pub pid: u32,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub(crate) struct Entry {
    pub id: String,           // "tmux:<name>" or "tty:/dev/ttys012"
    pub kind: &'static str,   // "tmux" (attachable) or "terminal" (Terminal.app, view only)
    pub label: String,
    pub tmux: Option<String>, // the tmux session to attach
    pub tty: Option<String>,  // the Terminal.app tab to focus or mirror
    pub cwd: Option<String>,
    pub claude: Option<ClaudeInfo>,
    pub clients: u32,         // tmux clients attached (Roo tabs and Terminal.app windows)
    pub activity: Option<i64>, // unix seconds of the last output (tmux only)
}

#[derive(Serialize, Debug)]
pub(crate) struct TermList {
    home: String,
    tmux: bool,                   // tmux is installed
    terminal_access: Option<bool>, // Terminal.app could be read (None: Terminal isn't running)
    entries: Vec<Entry>,
}

// ------------------------------------------
// Raw facts, parsed (pure, tested)
// ------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TmuxSession {
    pub name: String,
    pub clients: u32,
    pub activity: Option<i64>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Pane {
    pub session: String,
    pub tty: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ClaudeSession {
    pub pid: u32,
    pub name: Option<String>,
    pub status: Option<String>,
    pub cwd: Option<String>,
    pub tty: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TerminalTab {
    pub tty: String,
    pub title: String,
}

fn opt(s: &str) -> Option<String> {
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

// `tmux list-sessions -F '#{session_name}\t#{session_attached}\t#{session_activity}\t#{session_path}'`
pub(crate) fn parse_sessions(out: &str) -> Vec<TmuxSession> {
    out.lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\t').collect();
            let name = f.first().filter(|n| !n.is_empty())?.to_string();
            Some(TmuxSession {
                name,
                clients: f.get(1).and_then(|v| v.trim().parse().ok()).unwrap_or(0),
                activity: f.get(2).and_then(|v| v.trim().parse().ok()),
                path: f.get(3).and_then(|v| opt(v)),
            })
        })
        .collect()
}

// `tmux list-panes -a -F '#{session_name}\t#{pane_tty}\t#{pane_current_path}'`
pub(crate) fn parse_panes(out: &str) -> Vec<Pane> {
    out.lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\t').collect();
            Some(Pane { session: f.first().filter(|s| !s.is_empty())?.to_string(), tty: opt(f.get(1)?)?, path: f.get(2).and_then(|v| opt(v)) })
        })
        .collect()
}

// `tmux list-clients -F '#{client_tty}'`: terminals that are a tmux client, not a shell of their own.
pub(crate) fn parse_clients(out: &str) -> HashSet<String> {
    out.lines().filter_map(opt).collect()
}

// `ps -o pid=,tty=,comm= -p ...`: pid → /dev/tty for processes that are still Claude Code.
// (A pid in a stale session file may have been reused by something else.)
pub(crate) fn parse_ps(out: &str) -> HashMap<u32, Option<String>> {
    let mut m = HashMap::new();
    for l in out.lines() {
        let mut f = l.split_whitespace();
        let (Some(pid), Some(tty)) = (f.next().and_then(|p| p.parse::<u32>().ok()), f.next()) else { continue };
        let comm = f.collect::<Vec<_>>().join(" ");
        let base = comm.rsplit('/').next().unwrap_or("");
        let is_claude = base == "claude" || comm.contains("/claude/versions/") || comm.contains("/.claude/");
        if !is_claude {
            continue;
        }
        let tty = (tty != "??" && tty != "-").then(|| if tty.starts_with("/dev/") { tty.to_string() } else { format!("/dev/{}", tty) });
        m.insert(pid, tty);
    }
    m
}

// One ~/.claude/sessions/<pid>.json. Only interactive sessions (not background jobs or Roo's runs).
pub(crate) fn parse_claude_file(text: &str) -> Option<ClaudeSession> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    if v.get("kind").and_then(|k| k.as_str()) != Some("interactive") {
        return None;
    }
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).and_then(opt);
    Some(ClaudeSession { pid: v.get("pid")?.as_u64()? as u32, name: s("name"), status: s("status"), cwd: s("cwd"), tty: None })
}

// The osascript listing below: one "tty<TAB>title" line per Terminal.app tab.
pub(crate) fn parse_tabs(out: &str) -> Vec<TerminalTab> {
    out.lines()
        .filter_map(|l| {
            let (tty, title) = l.split_once('\t')?;
            is_tty(tty.trim()).then(|| TerminalTab { tty: tty.trim().to_string(), title: clean_title(title) })
        })
        .collect()
}

pub(crate) fn is_tty(s: &str) -> bool {
    s.strip_prefix("/dev/ttys").is_some_and(|n| !n.is_empty() && n.len() <= 4 && n.chars().all(|c| c.is_ascii_digit()))
}

// Terminal titles carry Claude Code's status glyph ("✳ Roo", "◑ Roo") and Terminal's own
// " — zsh — 80×24" suffixes; the page wants just the name.
pub(crate) fn clean_title(t: &str) -> String {
    let t = t.trim();
    let t = t.split(" — ").next().unwrap_or(t);
    t.trim_start_matches(|c: char| !c.is_alphanumeric() && c != '~' && c != '/' && c != '(').trim().to_string()
}

fn folder_label(cwd: Option<&str>) -> Option<String> {
    let cwd = cwd?;
    let home = dirs::home_dir().map(|h| h.to_string_lossy().to_string()).unwrap_or_default();
    if !home.is_empty() && cwd == home {
        return Some("~".to_string());
    }
    Path::new(cwd).file_name().map(|n| n.to_string_lossy().to_string())
}

// Everything, merged: each tmux session once (with the Claude Code inside it, if any), each
// Terminal.app tab that isn't a tmux client once, and any Claude Code session found in neither
// (Terminal.app unreadable, or another terminal app) under its own tty.
pub(crate) fn merge(sessions: &[TmuxSession], panes: &[Pane], clients: &HashSet<String>, claudes: &[ClaudeSession], tabs: &[TerminalTab]) -> Vec<Entry> {
    let by_tty: HashMap<&str, &ClaudeSession> = claudes.iter().filter_map(|c| Some((c.tty.as_deref()?, c))).collect();
    let info = |c: &ClaudeSession| ClaudeInfo { name: c.name.clone(), status: c.status.clone(), pid: c.pid };
    let mut used: HashSet<u32> = HashSet::new();
    let mut out = Vec::new();

    for s in sessions {
        let mine: Vec<&Pane> = panes.iter().filter(|p| p.session == s.name).collect();
        let claude = mine.iter().find_map(|p| by_tty.get(p.tty.as_str()).copied());
        if let Some(c) = claude {
            used.insert(c.pid);
        }
        out.push(Entry {
            id: format!("tmux:{}", s.name),
            kind: "tmux",
            label: s.name.clone(),
            tmux: Some(s.name.clone()),
            tty: None,
            cwd: mine.first().and_then(|p| p.path.clone()).or_else(|| s.path.clone()),
            claude: claude.map(info),
            clients: s.clients,
            activity: s.activity,
        });
    }
    for t in tabs {
        if clients.contains(&t.tty) {
            continue; // a window attached to a tmux session: that session is already listed
        }
        let claude = by_tty.get(t.tty.as_str()).copied();
        if let Some(c) = claude {
            used.insert(c.pid);
        }
        let label = claude.and_then(|c| c.name.clone()).or_else(|| opt(&t.title)).unwrap_or_else(|| "Terminal".to_string());
        out.push(Entry {
            id: format!("tty:{}", t.tty),
            kind: "terminal",
            label,
            tmux: None,
            tty: Some(t.tty.clone()),
            cwd: claude.and_then(|c| c.cwd.clone()),
            claude: claude.map(info),
            clients: 0,
            activity: None,
        });
    }
    for c in claudes {
        if used.contains(&c.pid) || c.tty.as_ref().is_some_and(|t| clients.contains(t)) {
            continue;
        }
        let in_pane = c.tty.as_ref().is_some_and(|t| panes.iter().any(|p| &p.tty == t));
        if in_pane {
            continue;
        }
        out.push(Entry {
            id: c.tty.as_ref().map(|t| format!("tty:{}", t)).unwrap_or_else(|| format!("pid:{}", c.pid)),
            kind: "terminal",
            label: c.name.clone().or_else(|| folder_label(c.cwd.as_deref())).unwrap_or_else(|| "Claude Code".to_string()),
            tmux: None,
            tty: c.tty.clone(),
            cwd: c.cwd.clone(),
            claude: Some(info(c)),
            clients: 0,
            activity: None,
        });
    }
    out
}

// A tmux session name from what the owner typed: tmux forbids '.' and ':' (it reads them as
// window and pane separators) and control characters break its listings.
pub(crate) fn session_name(raw: &str) -> Option<String> {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '.' | ':' => '-',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let words = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let name: String = words.chars().take(NAME_MAX).collect::<String>().trim().to_string();
    (!name.is_empty()).then_some(name)
}

// The first of `name`, `name 2`, `name 3`... that isn't taken.
pub(crate) fn unique_name(name: &str, taken: &[String]) -> String {
    if !taken.iter().any(|t| t == name) {
        return name.to_string();
    }
    (2..).map(|i| format!("{} {}", name, i)).find(|n| !taken.iter().any(|t| t == n)).unwrap_or_else(|| name.to_string())
}

// Single-quotes for a POSIX shell.
pub(crate) fn sq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

// What a new session runs. Plain terminals get tmux's default (the login shell). Claude runs in
// the login shell, so PATH and sign-in are the everyday ones, with keys that would switch billing
// unset; when it exits the tab drops to a shell in the same folder instead of vanishing.
pub(crate) fn session_command(shell: &str, claude: bool, agent: Option<&str>, name: &str) -> Option<String> {
    if !claude {
        return None;
    }
    let agent = agent.map(|a| format!(" --agent {}", a)).unwrap_or_default();
    let inner = format!("unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; claude{} -n {}; exec {} -l", agent, sq(name), sq(shell));
    Some(format!("exec {} -l -i -c {}", sq(shell), sq(&inner)))
}

// A folder a new terminal may start in: an existing directory under the home folder.
pub(crate) fn check_cwd(raw: &str, home: &Path) -> Result<PathBuf, String> {
    let p = match raw.strip_prefix("~") {
        Some(rest) => home.join(rest.trim_start_matches('/')),
        None => PathBuf::from(raw),
    };
    let p = p.canonicalize().map_err(|_| format!("No folder at {}", raw))?;
    let home = home.canonicalize().unwrap_or_else(|_| home.to_path_buf());
    if !p.is_dir() || !p.starts_with(&home) {
        return Err("Pick a folder inside your home folder.".to_string());
    }
    Ok(p)
}

// ------------------------------------------
// Running tmux, ps and osascript
// ------------------------------------------

pub(crate) fn tmux_bin() -> Option<&'static str> {
    TMUX_CANDIDATES.iter().copied().find(|p| Path::new(p).is_file())
}

// The login shell's PATH (Roo is started by launchd with a bare one), read once.
fn login_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let shell = pty::login_shell();
        let read = Command::new(&shell)
            .args(["-l", "-c", "printf %s \"$PATH\""])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .filter(|p| p.contains("/usr/bin"));
        read.unwrap_or_else(|| "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string())
    })
}

fn lang() -> String {
    std::env::var("LANG").ok().filter(|l| l.to_uppercase().contains("UTF-8")).unwrap_or_else(|| "en_US.UTF-8".to_string())
}

fn tmux_cmd(bin: &str) -> Command {
    let mut c = Command::new(bin);
    c.arg("-u")
        .env("PATH", login_path())
        .env("LANG", lang())
        .env_remove("TMUX")
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("ANTHROPIC_AUTH_TOKEN")
        .stdin(Stdio::null());
    c
}

fn tmux(bin: &str, args: &[&str]) -> Result<String, String> {
    let out = tmux_cmd(bin).args(args).output().map_err(|e| format!("tmux: {}", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// No server yet is an empty list, not an error.
fn tmux_list(bin: &str, args: &[&str]) -> String {
    tmux(bin, args).unwrap_or_default()
}

pub(crate) fn conf_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".config").join("roo").join("tmux.conf"))
}

// Writes Roo's tmux settings and applies them to a running server.
fn apply_conf(bin: &str) {
    let Some(p) = conf_path() else { return };
    if std::fs::read_to_string(&p).ok().as_deref() != Some(TMUX_CONF) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&p, TMUX_CONF);
    }
    let _ = tmux(bin, &["source-file", &p.to_string_lossy()]);
}

fn session_names(bin: &str) -> Vec<String> {
    parse_sessions(&tmux_list(bin, &["list-sessions", "-F", "#{session_name}"])).into_iter().map(|s| s.name).collect()
}

fn claude_sessions() -> Vec<ClaudeSession> {
    let Some(dir) = dirs::home_dir().map(|h| h.join(".claude").join("sessions")) else { return vec![] };
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut found: Vec<ClaudeSession> = rd
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|t| parse_claude_file(&t))
        .collect();
    if found.is_empty() {
        return found;
    }
    let pids = found.iter().map(|c| c.pid.to_string()).collect::<Vec<_>>().join(",");
    let ps = Command::new("/bin/ps").args(["-o", "pid=,tty=,comm=", "-p", &pids]).output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    let live = parse_ps(&ps);
    found.retain(|c| live.contains_key(&c.pid));
    for c in &mut found {
        c.tty = live.get(&c.pid).cloned().flatten();
    }
    found.sort_by_key(|c| c.pid);
    found
}

fn terminal_running() -> bool {
    Command::new("/usr/bin/pgrep").args(["-xq", "Terminal"]).status().is_ok_and(|s| s.success())
}

// Runs an AppleScript with arguments, giving up after OSA_TIMEOUT (a permission prompt that
// nobody answers must not hang the page).
fn osascript(script: &str, args: &[&str]) -> Result<String, String> {
    let mut child = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > OSA_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Terminal didn't answer".to_string());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(e.to_string()),
        }
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(if err.contains("-1743") || err.contains("Not authorized") {
            "Roo isn't allowed to see Terminal yet. Turn on Roo > Terminal in System Settings > Privacy & Security > Automation.".to_string()
        } else {
            err.trim().to_string()
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

const LIST_TABS: &str = r#"tell application "Terminal"
  set out to ""
  repeat with w in windows
    repeat with t in tabs of w
      set ttl to custom title of t
      if ttl is "" then set ttl to name of w
      set out to out & (tty of t) & tab & ttl & linefeed
    end repeat
  end repeat
  return out
end tell"#;

const FIND_TAB: &str = r#"on run argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is (item 1 of argv) then
          if (item 2 of argv) is "focus" then
            set selected tab of w to t
            set index of w to 1
            activate
            return "ok"
          else
            return contents of t
          end if
        end if
      end repeat
    end repeat
  end tell
  error "That Terminal window has closed."
end run"#;

// ------------------------------------------
// Commands
// ------------------------------------------

#[tauri::command]
pub(crate) async fn term_list() -> Result<TermList, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let bin = tmux_bin();
        let (sessions, panes, clients) = match bin {
            Some(b) => (
                parse_sessions(&tmux_list(b, &["list-sessions", "-F", "#{session_name}\t#{session_attached}\t#{session_activity}\t#{session_path}"])),
                parse_panes(&tmux_list(b, &["list-panes", "-a", "-F", "#{session_name}\t#{pane_tty}\t#{pane_current_path}"])),
                parse_clients(&tmux_list(b, &["list-clients", "-F", "#{client_tty}"])),
            ),
            None => (vec![], vec![], HashSet::new()),
        };
        let claudes = claude_sessions();
        let (tabs, access) = if terminal_running() {
            match osascript(LIST_TABS, &[]) {
                Ok(out) => (parse_tabs(&out), Some(true)),
                Err(_) => (vec![], Some(false)),
            }
        } else {
            (vec![], None)
        };
        TermList { home: dirs::home_dir().map(|h| h.to_string_lossy().to_string()).unwrap_or_default(), tmux: bin.is_some(), terminal_access: access, entries: merge(&sessions, &panes, &clients, &claudes, &tabs) }
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NewTerminal {
    name: String,
    cwd: String,
    claude: bool,
    agent: Option<String>,
    cols: u16,
    rows: u16,
}

// Starts a tmux session (detached) and returns its name; the page then attaches a tab to it.
// An agent's session ("Open in terminal" from Conversations) is reused when it's already running.
#[tauri::command]
pub(crate) async fn term_new(req: NewTerminal) -> Result<String, String> {
    let agent = super::command::check_agent(req.agent.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let bin = tmux_bin().ok_or("tmux isn't installed. In Terminal: brew install tmux")?;
        let home = dirs::home_dir().ok_or("Could not find home directory")?;
        let cwd = check_cwd(&req.cwd, &home)?;
        let base = session_name(&req.name).ok_or("Give the terminal a name.")?;
        let taken = session_names(bin);
        if agent.is_some() && taken.iter().any(|t| t == &base) {
            return Ok(base);
        }
        let name = unique_name(&base, &taken);
        let shell = pty::login_shell();
        let cols = req.cols.clamp(20, 1000).to_string();
        let rows = req.rows.clamp(5, 500).to_string();
        let cwd_s = cwd.to_string_lossy().to_string();
        let mut args: Vec<String> = ["new-session", "-d", "-s", &name, "-c", &cwd_s, "-x", &cols, "-y", &rows].iter().map(|s| s.to_string()).collect();
        if let Some(conf) = conf_path().filter(|p| p.is_file()) {
            args.splice(0..0, ["-f".to_string(), conf.to_string_lossy().to_string()]);
        }
        if let Some(cmd) = session_command(&shell, req.claude, agent.as_deref(), &name) {
            args.push(cmd);
        }
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        tmux(bin, &refs).map_err(|e| format!("couldn't start the terminal: {}", e))?;
        apply_conf(bin);
        Ok(name)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn existing_session(bin: &str, name: &str) -> Result<(), String> {
    if session_name(name).as_deref() != Some(name) {
        return Err("invalid session name".to_string());
    }
    tmux(bin, &["has-session", "-t", &format!("={}", name)]).map(|_| ()).map_err(|_| format!("{} has ended.", name))
}

// A Roo tab: a pty running `tmux attach` to the session. See pty.rs.
#[tauri::command]
pub(crate) fn term_attach(ptys: State<'_, Ptys>, name: String, cols: u16, rows: u16, on_data: Channel<InvokeResponseBody>) -> Result<u32, String> {
    let bin = tmux_bin().ok_or("tmux isn't installed. In Terminal: brew install tmux")?;
    existing_session(bin, &name)?;
    apply_conf(bin);
    let mut cmd = CommandBuilder::new(bin);
    cmd.args(["-u", "attach-session", "-t", &format!("={}", name)]);
    if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    }
    cmd.env_remove("TMUX");
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
    cmd.env("PATH", login_path());
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("LANG", lang());
    pty::spawn(&ptys, cmd, cols, rows, on_data)
}

// Ends a session and everything running in it (the page asks first).
#[tauri::command]
pub(crate) async fn term_kill(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bin = tmux_bin().ok_or("tmux isn't installed")?;
        existing_session(bin, &name)?;
        tmux(bin, &["kill-session", "-t", &format!("={}", name)]).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

// The same session in a Terminal.app window. A one-off .command file, so no Apple Events needed.
pub(crate) fn attach_script(bin: &str, name: &str) -> String {
    format!("#!/bin/zsh -l\nrm -f \"$0\"\nprintf '\\e]0;%s\\a' {}\nexec {} -u attach-session -t {}\n", sq(name), bin, sq(&format!("={}", name)))
}

#[tauri::command]
pub(crate) fn term_open_outside(name: String) -> Result<(), String> {
    let bin = tmux_bin().ok_or("tmux isn't installed")?;
    existing_session(bin, &name)?;
    let dir = std::env::temp_dir().join("pulse-terminal");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut rnd = [0u8; 4];
    getrandom::getrandom(&mut rnd).map_err(|e| e.to_string())?;
    let path = dir.join(format!("attach-{}.command", hex::encode(rnd)));
    std::fs::write(&path, attach_script(bin, &name)).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Command::new("/usr/bin/open").args(["-a", "Terminal"]).arg(&path).spawn().map_err(|e| format!("could not open Terminal: {}", e))?;
    Ok(())
}

// Brings a Terminal.app tab to the front. Only reads and selects; never types into it.
#[tauri::command]
pub(crate) async fn term_focus(tty: String) -> Result<(), String> {
    if !is_tty(&tty) {
        return Err("invalid terminal".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || osascript(FIND_TAB, &[&tty, "focus"]).map(|_| ())).await.map_err(|e| e.to_string())?
}

// What a Terminal.app tab shows right now, for the read-only mirror.
#[tauri::command]
pub(crate) async fn term_peek(tty: String) -> Result<String, String> {
    if !is_tty(&tty) {
        return Err("invalid terminal".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let text = osascript(FIND_TAB, &[&tty, "peek"])?;
        let text = text.trim_end();
        let start = text.len().saturating_sub(PEEK_MAX);
        let start = (start..text.len()).find(|i| text.is_char_boundary(*i)).unwrap_or(text.len());
        Ok(text[start..].to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct Folder {
    name: String,
    path: String,
}

// Folders to start a terminal in: home, the org, and every project in the tracker that exists.
pub(crate) fn folders_from(projects_json: &str, home: &Path, portfolio: Option<&Path>) -> Vec<Folder> {
    let mut out = vec![Folder { name: "Home".to_string(), path: home.to_string_lossy().to_string() }];
    if let Some(p) = portfolio.filter(|p| p.is_dir()) {
        out.push(Folder { name: "Portfolio (org)".to_string(), path: p.to_string_lossy().to_string() });
    }
    let v: serde_json::Value = serde_json::from_str(projects_json).unwrap_or_default();
    for p in v.get("projects").and_then(|x| x.as_array()).into_iter().flatten() {
        let (Some(name), Some(path)) = (p.get("name").and_then(|x| x.as_str()), p.get("path").and_then(|x| x.as_str())) else { continue };
        let full = match path.strip_prefix("~/") {
            Some(rest) => home.join(rest),
            None => PathBuf::from(path),
        };
        if full.is_dir() && !out.iter().any(|f| Path::new(&f.path) == full) {
            out.push(Folder { name: name.to_string(), path: full.to_string_lossy().to_string() });
        }
    }
    out
}

#[tauri::command]
pub(crate) fn term_folders() -> Result<Vec<Folder>, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let tracker = super::get_tracker_dir().ok();
    let projects = tracker.map(|t| t.join("projects.json")).and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
    let portfolio = super::get_portfolio_dir().ok();
    Ok(folders_from(&projects, &home, portfolio.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claude(pid: u32, name: &str, tty: &str) -> ClaudeSession {
        ClaudeSession { pid, name: Some(name.to_string()), status: Some("idle".to_string()), cwd: Some(format!("/Users/j/{}", pid)), tty: Some(tty.to_string()) }
    }

    #[test]
    fn tmux_listings_parse() {
        let s = parse_sessions("Visuo · Give It a Try\t1\t1795022871\t/Users/j/Visuo\nscratch\t0\t\t\n\n");
        assert_eq!(s.len(), 2);
        assert_eq!(s[0], TmuxSession { name: "Visuo · Give It a Try".into(), clients: 1, activity: Some(1795022871), path: Some("/Users/j/Visuo".into()) });
        assert_eq!(s[1].clients, 0);
        assert_eq!(s[1].path, None);
        let p = parse_panes("scratch\t/dev/ttys020\t/Users/j\nbad\n");
        assert_eq!(p, vec![Pane { session: "scratch".into(), tty: "/dev/ttys020".into(), path: Some("/Users/j".into()) }]);
        assert!(parse_clients("/dev/ttys021\n\n").contains("/dev/ttys021"));
        assert!(parse_sessions("").is_empty());
    }

    #[test]
    fn ps_keeps_only_live_claude() {
        let ps = "26227 ttys009  claude\n26914 ttys001  /Users/j/.local/share/claude/versions/2.1.321\n  999 ttys003  vim\n 1234 ??  claude\n";
        let m = parse_ps(ps);
        assert_eq!(m.get(&26227), Some(&Some("/dev/ttys009".to_string())));
        assert_eq!(m.get(&26914), Some(&Some("/dev/ttys001".to_string())));
        assert_eq!(m.get(&1234), Some(&None));
        assert!(!m.contains_key(&999), "a reused pid that isn't claude is dropped");
    }

    #[test]
    fn only_interactive_session_files() {
        let i = r#"{"pid":26384,"cwd":"/Users/j/portfolio","kind":"interactive","name":"Roo","status":"busy"}"#;
        let c = parse_claude_file(i).unwrap();
        assert_eq!((c.pid, c.name.as_deref(), c.status.as_deref()), (26384, Some("Roo"), Some("busy")));
        assert!(parse_claude_file(r#"{"pid":1,"kind":"bg","name":"x"}"#).is_none());
        assert!(parse_claude_file("not json").is_none());
    }

    #[test]
    fn terminal_tabs_parse_and_titles_clean() {
        let t = parse_tabs("/dev/ttys012\t◑ Roo\n/dev/ttys010\t✳ Give It a Try\nbogus\tx\n/dev/ttys014\tjay — -zsh — 80×24\n");
        assert_eq!(t.iter().map(|x| x.title.as_str()).collect::<Vec<_>>(), vec!["Roo", "Give It a Try", "jay"]);
        assert!(is_tty("/dev/ttys012"));
        for bad in ["/dev/ttys", "/dev/tty12", "/dev/ttys12345", "/dev/ttys01; rm", "ttys012"] {
            assert!(!is_tty(bad), "{bad}");
        }
    }

    #[test]
    fn merge_lists_each_terminal_once() {
        let sessions = vec![TmuxSession { name: "Visuo · Give It a Try".into(), clients: 1, activity: Some(5), path: None }];
        let panes = vec![Pane { session: "Visuo · Give It a Try".into(), tty: "/dev/ttys020".into(), path: Some("/Users/j/Visuo".into()) }];
        // ttys021 is Terminal.app attached to that tmux session; ttys012 is an old plain window.
        let clients: HashSet<String> = ["/dev/ttys021".to_string()].into();
        let claudes = vec![
            claude(10, "Give It a Try", "/dev/ttys020"),
            claude(11, "Roo", "/dev/ttys012"),
            claude(12, "Elsewhere", "/dev/ttys030"), // e.g. a VS Code terminal
        ];
        let tabs = vec![
            TerminalTab { tty: "/dev/ttys021".into(), title: "Visuo · Give It a Try".into() },
            TerminalTab { tty: "/dev/ttys012".into(), title: "Roo".into() },
            TerminalTab { tty: "/dev/ttys013".into(), title: "jay".into() },
        ];
        let e = merge(&sessions, &panes, &clients, &claudes, &tabs);
        let ids: Vec<&str> = e.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(ids, vec!["tmux:Visuo · Give It a Try", "tty:/dev/ttys012", "tty:/dev/ttys013", "tty:/dev/ttys030"]);
        assert_eq!(e[0].kind, "tmux");
        assert_eq!(e[0].claude.as_ref().unwrap().pid, 10);
        assert_eq!(e[0].cwd.as_deref(), Some("/Users/j/Visuo"));
        assert_eq!((e[1].kind, e[1].label.as_str(), e[1].claude.as_ref().unwrap().pid), ("terminal", "Roo", 11));
        assert_eq!((e[2].label.as_str(), e[2].claude.is_none()), ("jay", true));
        assert_eq!((e[3].label.as_str(), e[3].tty.as_deref()), ("Elsewhere", Some("/dev/ttys030")));
    }

    #[test]
    fn without_terminal_access_claude_sessions_still_show() {
        let claudes = vec![claude(11, "Roo", "/dev/ttys012"), claude(12, "Positioning", "/dev/ttys013")];
        let e = merge(&[], &[], &HashSet::new(), &claudes, &[]);
        assert_eq!(e.iter().map(|x| (x.label.as_str(), x.tty.as_deref())).collect::<Vec<_>>(), vec![("Roo", Some("/dev/ttys012")), ("Positioning", Some("/dev/ttys013"))]);
    }

    #[test]
    fn session_names_are_safe_for_tmux() {
        assert_eq!(session_name("  Visuo · Give It a Try ").as_deref(), Some("Visuo · Give It a Try"));
        assert_eq!(session_name("v1.2: fix").as_deref(), Some("v1-2- fix"));
        assert_eq!(session_name("a\tb\nc").as_deref(), Some("a b c"));
        assert_eq!(session_name("   "), None);
        assert_eq!(session_name(&"x".repeat(100)).unwrap().len(), NAME_MAX);
        let taken = vec!["Roo".to_string(), "Roo 2".to_string()];
        assert_eq!(unique_name("Roo", &taken), "Roo 3");
        assert_eq!(unique_name("New", &taken), "New");
    }

    #[test]
    fn session_command_quotes_everything() {
        assert_eq!(session_command("/bin/zsh", false, None, "x"), None);
        let c = session_command("/bin/zsh", true, Some("crafted-lead"), "Jay's tab").unwrap();
        // A shell splits it into exactly: the shell, its flags, and one script with the name intact.
        let args = c.strip_prefix("exec ").unwrap();
        let out = Command::new("/bin/sh").args(["-c", &format!("for a in {}; do printf '%s\\n--\\n' \"$a\"; done", args)]).output().unwrap();
        let parts: Vec<String> = String::from_utf8_lossy(&out.stdout).split("\n--\n").filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
        assert_eq!(
            parts,
            vec!["/bin/zsh", "-l", "-i", "-c", "unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; claude --agent crafted-lead -n 'Jay'\\''s tab'; exec '/bin/zsh' -l"]
        );
    }

    #[test]
    fn cwd_must_be_a_folder_under_home() {
        let home = std::env::temp_dir().join(format!("pulse-term-home-{}", std::process::id()));
        std::fs::create_dir_all(home.join("proj")).unwrap();
        std::fs::write(home.join("file"), b"x").unwrap();
        assert!(check_cwd("~/proj", &home).is_ok());
        assert!(check_cwd(&home.join("proj").to_string_lossy(), &home).is_ok());
        assert!(check_cwd("~/file", &home).is_err());
        assert!(check_cwd("~/missing", &home).is_err());
        assert!(check_cwd("/", &home).is_err());
        assert!(check_cwd("~/../", &home).is_err());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn folders_come_from_the_tracker() {
        let home = std::env::temp_dir().join(format!("pulse-term-folders-{}", std::process::id()));
        std::fs::create_dir_all(home.join("Visuo")).unwrap();
        let json = r#"{"projects":[{"name":"Visuo","path":"~/Visuo"},{"name":"Gone","path":"~/gone"},{"name":"Dup","path":"~/Visuo"}]}"#;
        let f = folders_from(json, &home, None);
        assert_eq!(f.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), vec!["Home", "Visuo"]);
        assert_eq!(folders_from("garbage", &home, None).len(), 1);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn attach_script_names_the_exact_session() {
        let s = attach_script("/opt/homebrew/bin/tmux", "Jay's");
        assert!(s.ends_with("exec /opt/homebrew/bin/tmux -u attach-session -t '=Jay'\\''s'\n"), "{s}");
    }

    // Real tmux, on a private socket: start, list, attach through a pty, detach, the session lives on.
    #[test]
    fn tmux_round_trip() {
        let Some(bin) = tmux_bin() else { return };
        let sock = format!("pulse-test-{}", std::process::id());
        let t = |args: &[&str]| {
            let mut all = vec!["-L", sock.as_str()];
            all.extend_from_slice(args);
            tmux(bin, &all)
        };
        t(&["-f", "/dev/null", "new-session", "-d", "-s", "Roo · test", "-x", "80", "-y", "24"]).unwrap();
        let s = parse_sessions(&t(&["list-sessions", "-F", "#{session_name}\t#{session_attached}\t#{session_activity}\t#{session_path}"]).unwrap());
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].name, "Roo · test");
        assert_eq!(s[0].clients, 0);

        use portable_pty::{native_pty_system, PtySize};
        use std::io::Read;
        let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new(bin);
        cmd.args(["-u", "-L", &sock, "attach-session", "-t", "=Roo · test"]);
        cmd.env("TERM", "xterm-256color");
        cmd.env_remove("TMUX");
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut buf = [0u8; 4096];
        let _ = reader.read(&mut buf); // the first screen arrives
        let deadline = Instant::now() + Duration::from_secs(5);
        while parse_clients(&t(&["list-clients", "-F", "#{client_tty}"]).unwrap_or_default()).is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(parse_clients(&t(&["list-clients", "-F", "#{client_tty}"]).unwrap()).len(), 1);
        child.kill().unwrap();
        let _ = child.wait();
        // Detached, not ended.
        assert!(t(&["has-session", "-t", "=Roo · test"]).is_ok());
        t(&["kill-server"]).ok();
    }
}
