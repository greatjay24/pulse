// ==========================================
// Roo's quick lane and the reply stream
// ==========================================
// A full Roo turn starts `claude -p --agent pulse` with every tool, which takes 5 to 25 seconds
// even for "hi". Quick questions ("what's on my list", "what's next", "hi") don't need tools:
// the quick lane answers them with a lean, tool-less Haiku call over a small snapshot of the
// owner's files (status.json, open tasks, the Outbox, the calendar cache, runs working now),
// streamed token by token. When the question needs real work, or the snapshot can't answer it,
// the model replies HANDOFF (or the router never tries) and the message goes to full Roo as before.
//
// Both lanes report on one event, `pulse://roo-reply`, so the listening panel shows the reply
// as it is written and speech can start on the first sentence:
//   {id, lane: "fast"|"full", type: "start"}                         working
//   {id, lane, type: "delta", text}                                  more of the reply (fast: tokens;
//                                                                    full: each message Roo writes)
//   {id, lane, type: "sentence", text}                               one finished sentence, in order
//   {id, lane, type: "step", text}                                   full Roo's current step
//   {id, lane: "fast", type: "handoff"}                              needs full Roo: send it there
//   {id, lane, type: "done", text, ok, run_id}                       the whole reply
//   {id, lane, type: "error", text}                                  it failed (fast: fall back to full)
//
// The quick lane gets no tools, no MCP servers, no settings, no hooks and no session: it can only
// read the snapshot it is given. It runs on the owner's claude sign-in (never an API key), and
// its turns are written to logs/transcripts as kind "quick", so they show in the Roo thread.

use super::{get_portfolio_dir, get_tracker_dir, is_run_id, read_live_at, read_portfolio_json, resolve_portfolio_file, pid_alive};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub(crate) const REPLY_EVENT: &str = "pulse://roo-reply";
const QUICK_MODEL: &str = "haiku";
const QUICK_TIMEOUT: Duration = Duration::from_secs(30);
const HANDOFF: &str = "HANDOFF";
const MESSAGE_MAX: usize = 2000; // longer than this is never a quick question
const SNAPSHOT_MAX: usize = 9000;
const LINE_MAX: usize = 180;
const HISTORY_TURNS: usize = 3;
const HISTORY_FRESH: Duration = Duration::from_secs(15 * 60);
const WATCH_EVERY: Duration = Duration::from_millis(120);
const WATCH_MAX: Duration = Duration::from_secs(3 * 3600);
// The variables that would bill an API key or route to another provider (same list as ask.py).
const BILLING_ENV: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_BEDROCK_BASE_URL",
    "ANTHROPIC_VERTEX_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
];

#[derive(Default)]
pub(crate) struct Replies {
    turns: Mutex<HashMap<String, Turn>>,
    history: Mutex<Vec<(Instant, String, String)>>, // recent quick exchanges: (when, asked, answered)
}

struct Turn {
    cancel: Arc<AtomicBool>,
    child: Option<Arc<Mutex<Child>>>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct ReplyEvent {
    pub id: String,
    pub lane: &'static str,
    #[serde(rename = "type")]
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ok: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

fn event(id: &str, lane: &'static str, kind: &'static str, text: Option<String>) -> ReplyEvent {
    ReplyEvent { id: id.to_string(), lane, kind, text, ok: None, run_id: None }
}

// Ids the panel makes up for a turn: short slugs, so they can't carry anything else.
fn is_turn_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

// ------------------------------------------
// Router: requests that are obviously work skip the quick lane
// ------------------------------------------

const WORK_VERBS: &[&str] = &[
    "add", "analyse", "analyze", "ask", "book", "build", "buy", "call", "cancel", "change", "check", "clean", "compare",
    "create", "delete", "deploy", "dig", "draft", "email", "fetch", "figure", "find", "fix", "follow", "go", "invite",
    "investigate", "look", "make", "mark", "merge", "message", "move", "open", "order", "pay", "plan", "post", "prep",
    "prepare", "publish", "pull", "put", "read", "remind", "remove", "rename", "reply", "research", "reschedule",
    "respond", "review", "run", "schedule", "search", "send", "set", "ship", "start", "stop", "summarise", "summarize",
    "text", "update", "write",
];
const WORK_PHRASES: &[&str] = &[
    "my inbox", "my email", "my emails", "the email", "an email", "emails from", "email from", "pull request",
    "github", "the web", "online", "on the internet", "news", "weather", "stock price", "website", "the repo", "the code",
    "a draft", "the draft",
];
const POLITE: &[&str] = &["please", "can", "could", "would", "will", "you", "roo", "hey", "ok", "okay", "so", "and", "then", "now", "go", "ahead", "i", "need", "want", "to", "me"];

pub(crate) fn words(message: &str) -> Vec<String> {
    message
        .to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || c == '\''))
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

// True when the message should go straight to full Roo. Anything else tries the quick lane,
// whose model hands off on its own when it can't answer from the snapshot.
pub(crate) fn needs_full(message: &str) -> bool {
    let m = message.trim();
    if m.is_empty() || m.chars().count() > 280 || m.contains('\n') {
        return true;
    }
    let lower = format!(" {} ", m.to_lowercase());
    if WORK_PHRASES.iter().any(|p| lower.contains(&format!(" {}", p))) {
        return true;
    }
    // "Draft a reply…", "Can you please check…", "Roo, go ahead and merge it": the first word
    // after the politeness is a verb of work.
    let w = words(m);
    let first = w.iter().find(|x| !POLITE.contains(&x.as_str()));
    match first {
        Some(v) if WORK_VERBS.contains(&v.as_str()) => true,
        // "go" alone is in POLITE ("go ahead and …"); "go" with nothing after is still work
        None => w.iter().any(|x| x == "go"),
        _ => false,
    }
}

// ------------------------------------------
// Snapshot: what the quick lane knows, a few KB
// ------------------------------------------

fn clip(s: &str, n: usize) -> String {
    let one = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() <= n {
        one
    } else {
        format!("{}…", one.chars().take(n.saturating_sub(1)).collect::<String>().trim_end())
    }
}

fn str_of<'a>(v: &'a serde_json::Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

fn arr<'a>(v: &'a serde_json::Value, key: &str) -> &'a [serde_json::Value] {
    v.get(key).and_then(|x| x.as_array()).map(|a| a.as_slice()).unwrap_or(&[])
}

pub(crate) fn entity_lines(status: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    let name = match str_of(status, "name") {
        "" => str_of(status, "entity"),
        n => n,
    };
    let health = str_of(status, "health");
    let stage = str_of(status, "stage");
    let mut head = format!("### {}", name);
    if !health.is_empty() || !stage.is_empty() {
        head.push_str(&format!(" ({})", [health, stage].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join(", ")));
    }
    out.push(head);
    let headline = str_of(status, "headline");
    if !headline.is_empty() {
        out.push(clip(headline, LINE_MAX * 2));
    }
    for d in arr(status, "decisions").iter().take(4) {
        let rec = str_of(d, "recommend");
        let due = str_of(d, "due");
        let mut line = format!("- Decision for the owner: {}", clip(str_of(d, "ask"), LINE_MAX));
        if !rec.is_empty() {
            line.push_str(&format!(" (recommended: {})", clip(rec, 80)));
        }
        if !due.is_empty() {
            line.push_str(&format!(" due {}", due));
        }
        out.push(line);
    }
    for a in arr(status, "jay_actions").iter().take(4) {
        let due = str_of(a, "due");
        out.push(format!("- Owner to do: {}{}", clip(str_of(a, "what"), LINE_MAX), if due.is_empty() { String::new() } else { format!(" (due {})", due) }));
    }
    for w in arr(status, "waiting_on").iter().take(3) {
        out.push(format!("- Waiting on {}: {}", clip(str_of(w, "who"), 40), clip(str_of(w, "what"), LINE_MAX)));
    }
    for r in arr(status, "risks").iter().filter(|r| str_of(r, "severity") == "high").take(2) {
        out.push(format!("- Risk: {}", clip(str_of(r, "what"), LINE_MAX)));
    }
    let next: Vec<String> = arr(status, "next").iter().filter_map(|n| n.as_str()).take(3).map(|n| clip(n, 120)).collect();
    if !next.is_empty() {
        out.push(format!("- Next: {}", next.join("; ")));
    }
    out
}

fn fmt_time(dt: &chrono::DateTime<chrono::Local>, now: &chrono::DateTime<chrono::Local>) -> String {
    let day = if dt.date_naive() == now.date_naive() {
        "today".to_string()
    } else if dt.date_naive() == now.date_naive().succ_opt().unwrap_or(now.date_naive()) {
        "tomorrow".to_string()
    } else {
        dt.format("%a %b %-d").to_string()
    };
    format!("{} {}", day, dt.format("%-I:%M %p"))
}

pub(crate) fn calendar_lines(cal: &serde_json::Value, now: &chrono::DateTime<chrono::Local>) -> Vec<String> {
    let mut events: Vec<(chrono::DateTime<chrono::Local>, String)> = arr(cal, "events")
        .iter()
        .filter_map(|e| {
            let start = chrono::DateTime::parse_from_rfc3339(str_of(e, "start")).ok()?.with_timezone(&chrono::Local);
            let end = chrono::DateTime::parse_from_rfc3339(str_of(e, "end")).ok().map(|d| d.with_timezone(&chrono::Local));
            // Still ahead or under way, and within the next day and a half.
            if end.unwrap_or(start) < *now || start > *now + chrono::Duration::hours(36) {
                return None;
            }
            let mut line = format!("- {}: {}", fmt_time(&start, now), clip(str_of(e, "summary"), 100));
            if let Some(end) = end {
                line.push_str(&format!(" (until {})", end.format("%-I:%M %p")));
            }
            let loc = str_of(e, "location");
            if !loc.is_empty() {
                line.push_str(&format!(" at {}", clip(loc, 60)));
            }
            Some((start, line))
        })
        .collect();
    events.sort_by_key(|(s, _)| *s);
    events.into_iter().take(10).map(|(_, l)| l).collect()
}

pub(crate) fn todo_lines(todos: &[super::todos::Todo], today: &str) -> Vec<String> {
    let rank = |u: Option<&str>| match u {
        Some("now") => 0,
        Some("soon") => 1,
        _ => 2,
    };
    let mut open: Vec<&super::todos::Todo> = todos
        .iter()
        .filter(|t| !t.done && rank(t.urgency.as_deref()) < 2 && t.show_from.as_deref().is_none_or(|d| d <= today))
        .collect();
    open.sort_by_key(|t| rank(t.urgency.as_deref()));
    let total = open.len();
    let mut out: Vec<String> = open
        .iter()
        .take(15)
        .map(|t| {
            let project = t.project.as_deref().map(|p| format!(", {}", p)).unwrap_or_default();
            format!("- [{}{}] {}", t.urgency.as_deref().unwrap_or(""), project, clip(&t.title, LINE_MAX))
        })
        .collect();
    if total > out.len() {
        out.push(format!("- …and {} more", total - out.len()));
    }
    out
}

pub(crate) fn outbox_lines(items: &[serde_json::Value]) -> Vec<String> {
    let pending: Vec<&serde_json::Value> = items.iter().filter(|i| str_of(i, "status") == "pending").collect();
    let mut out: Vec<String> = pending
        .iter()
        .take(8)
        .map(|i| {
            let kind = match str_of(i, "kind") {
                "" => "email",
                k => k,
            };
            let what = match (str_of(i, "subject"), str_of(i, "title")) {
                ("", "") => clip(str_of(i, "body"), 80),
                ("", t) => clip(t, 100),
                (s, _) => clip(s, 100),
            };
            let to = arr(i, "to").iter().filter_map(|x| x.as_str()).next().map(|t| format!(" to {}", clip(t, 50))).unwrap_or_default();
            format!("- {} ({}){}: {}", kind, str_of(i, "entity"), to, what)
        })
        .collect();
    if pending.len() > out.len() {
        out.push(format!("- …and {} more", pending.len() - out.len()));
    }
    out
}

fn running_lines(live: &super::LiveSnapshot) -> Vec<String> {
    live.runs
        .iter()
        .filter(|r| matches!(str_of(r, "state"), "running" | "queued"))
        .take(6)
        .map(|r| format!("- {} ({}): {}", str_of(r, "agent"), str_of(r, "state"), clip(str_of(r, "doing"), 120)))
        .collect()
}

// Everything the quick lane may know, as short plain text. Missing sources are just left out.
pub(crate) fn build_snapshot(portfolio: Option<&Path>, tracker: Option<&Path>, now: chrono::DateTime<chrono::Local>) -> String {
    let mut s = String::new();
    let mut section = |title: &str, lines: Vec<String>| {
        if !lines.is_empty() {
            s.push_str(&format!("\n## {}\n{}\n", title, lines.join("\n")));
        }
    };
    if let Some(root) = portfolio {
        let cal = resolve_portfolio_file(root, "watch", "calendar.json").and_then(|p| read_portfolio_json(&p));
        section("Calendar (next 36 hours)", match &cal {
            Ok(c) => {
                let l = calendar_lines(c, &now);
                if l.is_empty() { vec!["- Nothing on the calendar.".to_string()] } else { l }
            }
            Err(_) => vec![],
        });
    }
    if let Some(t) = tracker {
        if let Ok((todos, _)) = super::todos::read_todos_at(t) {
            let l = todo_lines(&todos, &now.format("%Y-%m-%d").to_string());
            section("Open tasks, now and soon (the owner's list)", if l.is_empty() { vec!["- None open.".to_string()] } else { l });
        }
    }
    if let Some(root) = portfolio {
        let ob = super::ops::read_outbox_at(root);
        let items: Vec<serde_json::Value> = ob.items.iter().map(|i| i.item.clone()).collect();
        section("Outbox: waiting for the owner to send", outbox_lines(&items));
        section("Working right now", running_lines(&read_live_at(root, pid_alive)));
        if let Ok(reg) = resolve_portfolio_file(root, ".", "portfolio.json").and_then(|p| read_portfolio_json(&p)) {
            let mut lines = Vec::new();
            for e in arr(&reg, "entities") {
                let Some(rel) = e.get("path").and_then(|v| v.as_str()) else { continue };
                if let Ok(st) = resolve_portfolio_file(root, rel, "status.json").and_then(|p| read_portfolio_json(&p)) {
                    lines.extend(entity_lines(&st));
                }
            }
            section("Businesses and projects (from each lead's status report)", lines);
        }
    }
    if s.chars().count() > SNAPSHOT_MAX {
        s = format!("{}\n…(cut)", s.chars().take(SNAPSHOT_MAX).collect::<String>());
    }
    s
}

pub(crate) fn system_prompt(snapshot: &str, history: &[(String, String)], now: chrono::DateTime<chrono::Local>) -> String {
    let mut p = format!(
        "You are Roo, the owner's assistant, answering in Roo's quick lane (voice and the listening panel).\n\
         It is {}.\n\n\
         You have NO tools. You cannot read files, browse, check email, send, draft, schedule or change anything. \
         All you know is the snapshot below (read from the owner's files a moment ago), the recent exchange, and general knowledge.\n\n\
         Rules:\n\
         - Questions about the owner's list, tasks, what's next, the calendar, what's waiting, the Outbox, decisions, \
         or how a business or project is doing ARE answerable: the snapshot is current, so answer from it.\n\
         - Only if the request asks you to do something (draft, send, change, add, look something up, research) or needs facts \
         that are not in the snapshot or the recent exchange, reply with exactly {} and nothing else. Full Roo, with tools, takes it from there.\n\
         - Otherwise answer directly, out loud: at most two short sentences. Lead with the answer. \
         For a list, name the top three at most and say how many more. More only if the owner asks for detail. \
         No headings, bullets, tables or markdown.\n\
         - Never say or imply you did, started, checked, drafted or scheduled anything, and never promise to.\n\
         - Small talk (hi, thanks) gets one short friendly line.\n",
        now.format("%A %B %-d, %Y, %-I:%M %p"),
        HANDOFF
    );
    if !history.is_empty() {
        p.push_str("\n## Recent exchange\n");
        for (q, a) in history {
            p.push_str(&format!("Owner: {}\nRoo: {}\n", clip(q, 300), clip(a, 500)));
        }
    }
    p.push_str("\n# Snapshot\n");
    p.push_str(snapshot);
    p
}

pub(crate) fn quick_args(system: &str) -> Vec<String> {
    [
        "-p", "--model", QUICK_MODEL, "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands",
        "--no-session-persistence", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--system-prompt",
    ]
    .iter()
    .map(|s| s.to_string())
    .chain(std::iter::once(system.to_string()))
    .collect()
}

fn claude_bin() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    [home.join(".local/bin/claude"), PathBuf::from("/opt/homebrew/bin/claude"), PathBuf::from("/usr/local/bin/claude")]
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| "claude is not installed".to_string())
}

// ------------------------------------------
// Streaming: sentences, and the HANDOFF check on the first words
// ------------------------------------------

// Cuts streamed text into finished sentences: ., ! or ? followed by a space, or a line break.
#[derive(Default)]
pub(crate) struct Sentences {
    buf: String,
}

impl Sentences {
    pub fn push(&mut self, text: &str) -> Vec<String> {
        self.buf.push_str(text);
        let mut out = Vec::new();
        loop {
            let chars: Vec<(usize, char)> = self.buf.char_indices().collect();
            let mut cut = None;
            for (k, &(i, c)) in chars.iter().enumerate() {
                let next = chars.get(k + 1).map(|&(_, n)| n);
                if c == '\n' {
                    cut = Some(i + 1);
                    break;
                }
                if matches!(c, '.' | '!' | '?') && next.is_some_and(|n| n.is_whitespace()) {
                    // "e.g. " and "Mr. " are not ends; a single capital ("J. ") isn't either.
                    let before: String = self.buf[..i].chars().rev().take_while(|c| c.is_alphanumeric() || *c == '.').collect();
                    let before: String = before.chars().rev().collect();
                    let short = matches!(before.to_lowercase().as_str(), "e.g" | "i.e" | "mr" | "mrs" | "ms" | "dr" | "vs" | "etc" | "st" | "no")
                        || (before.chars().count() == 1 && before.chars().all(|c| c.is_uppercase()));
                    if !short {
                        cut = Some(i + c.len_utf8());
                        break;
                    }
                }
            }
            let Some(at) = cut else { break };
            let s = self.buf[..at].trim().to_string();
            self.buf = self.buf[at..].to_string();
            if !s.is_empty() {
                out.push(s);
            }
        }
        out
    }

    pub fn flush(&mut self) -> Option<String> {
        let s = std::mem::take(&mut self.buf).trim().to_string();
        (!s.is_empty()).then_some(s)
    }
}

// Holds the first characters back until it's clear they aren't HANDOFF.
#[derive(Default)]
pub(crate) struct Gate {
    held: String,
    open: bool,
}

pub(crate) enum Gated {
    Hold,
    Pass(String),
    Handoff,
}

impl Gate {
    pub fn push(&mut self, text: &str) -> Gated {
        if self.open {
            return Gated::Pass(text.to_string());
        }
        self.held.push_str(text);
        let t = self.held.trim_start();
        if t.starts_with(HANDOFF) {
            return Gated::Handoff;
        }
        if t.is_empty() || HANDOFF.starts_with(t) {
            return Gated::Hold;
        }
        self.open = true;
        Gated::Pass(std::mem::take(&mut self.held).trim_start().to_string())
    }

    // The stream ended: whatever is still held is the (short) answer, unless it's the marker.
    pub fn end(&mut self) -> Gated {
        let t = std::mem::take(&mut self.held);
        if t.trim() == HANDOFF || t.trim().starts_with(HANDOFF) {
            Gated::Handoff
        } else if self.open || t.trim().is_empty() {
            Gated::Hold
        } else {
            self.open = true;
            Gated::Pass(t.trim_start().to_string())
        }
    }
}

// The text in one stream-json line of `--include-partial-messages` output, if any.
pub(crate) fn text_delta(ev: &serde_json::Value) -> Option<&str> {
    if ev.get("type")?.as_str()? != "stream_event" {
        return None;
    }
    let e = ev.get("event")?;
    if e.get("type")?.as_str()? != "content_block_delta" {
        return None;
    }
    let d = e.get("delta")?;
    (d.get("type")?.as_str()? == "text_delta").then(|| d.get("text").and_then(|t| t.as_str())).flatten()
}

fn is_message_stop(ev: &serde_json::Value) -> bool {
    ev.get("type").and_then(|t| t.as_str()) == Some("stream_event")
        && ev.get("event").and_then(|e| e.get("type")).and_then(|t| t.as_str()) == Some("message_stop")
}

// ------------------------------------------
// The quick lane
// ------------------------------------------

fn emit(app: &AppHandle, ev: ReplyEvent) {
    let _ = app.emit(REPLY_EVENT, ev);
}

fn front_door(root: &Path) -> String {
    resolve_portfolio_file(root, ".", "portfolio.json")
        .and_then(|p| read_portfolio_json(&p))
        .ok()
        .and_then(|r| r.get("front_door").and_then(|f| f.get("lead")).and_then(|l| l.as_str()).map(String::from))
        .filter(|l| super::is_slug(l))
        .unwrap_or_else(|| "pulse".to_string())
}

// A quick turn in logs/transcripts, in live.py's format, so it shows in the Roo thread.
pub(crate) fn transcript_lines(run_id: &str, agent: &str, asked: &str, answer: &str, secs: f64, at: &str) -> String {
    let lines = [
        serde_json::json!({"t": "start", "at": at, "run_id": run_id, "kind": "quick", "entity": null, "agent": agent,
                           "doing": clip(asked, 120), "prompt": asked, "source": "voice"}),
        serde_json::json!({"t": "user", "at": at, "text": asked}),
        serde_json::json!({"t": "text", "at": at, "text": answer}),
        serde_json::json!({"t": "result", "at": at, "ok": true, "result": answer, "cost_usd": null,
                           "secs": (secs * 10.0).round() / 10.0, "turns": 1, "models": [QUICK_MODEL]}),
    ];
    lines.iter().map(|l| format!("{}\n", l)).collect()
}

fn write_transcript(asked: &str, answer: &str, secs: f64) -> Option<String> {
    let root = get_portfolio_dir().ok()?;
    let dir = root.join("logs/transcripts");
    if !dir.is_dir() {
        return None;
    }
    let agent = front_door(&root);
    let mut rnd = [0u8; 2];
    getrandom::getrandom(&mut rnd).ok()?;
    let run_id = format!("{}-{}-quick-{}", chrono::Local::now().format("%Y%m%d-%H%M%S"), agent, hex::encode(rnd));
    if !is_run_id(&run_id) {
        return None;
    }
    let at = chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false);
    let mut f = std::fs::OpenOptions::new().create_new(true).write(true).open(dir.join(format!("{}.jsonl", run_id))).ok()?;
    f.write_all(transcript_lines(&run_id, &agent, asked, answer, secs, &at).as_bytes()).ok()?;
    Some(run_id)
}

fn recent_history(state: &Replies) -> Vec<(String, String)> {
    let mut h = state.history.lock().unwrap();
    h.retain(|(at, _, _)| at.elapsed() < HISTORY_FRESH);
    h.iter().rev().take(HISTORY_TURNS).rev().map(|(_, q, a)| (q.clone(), a.clone())).collect()
}

fn remember(state: &Replies, asked: &str, answer: &str) {
    let mut h = state.history.lock().unwrap();
    h.push((Instant::now(), asked.to_string(), answer.to_string()));
    let n = h.len();
    if n > HISTORY_TURNS * 2 {
        h.drain(..n - HISTORY_TURNS * 2);
    }
}

fn register(state: &Replies, id: &str, child: Option<Arc<Mutex<Child>>>) -> Arc<AtomicBool> {
    let cancel = Arc::new(AtomicBool::new(false));
    let mut turns = state.turns.lock().unwrap();
    if let Some(old) = turns.insert(id.to_string(), Turn { cancel: cancel.clone(), child }) {
        stop_turn(old);
    }
    cancel
}

fn stop_turn(t: Turn) {
    t.cancel.store(true, Ordering::SeqCst);
    if let Some(c) = t.child {
        let mut c = c.lock().unwrap();
        let _ = c.kill();
        let _ = c.wait();
    }
}

fn finish_turn(app: &AppHandle, id: &str, cancel: &Arc<AtomicBool>) {
    let state = app.state::<Replies>();
    let mut turns = state.turns.lock().unwrap();
    if turns.get(id).is_some_and(|t| Arc::ptr_eq(&t.cancel, cancel)) {
        turns.remove(id);
    }
}

// "fast": the quick lane took it and its events follow; "full": send it to Roo (ask_lead).
#[tauri::command]
pub(crate) async fn ask_quick(app: AppHandle, id: String, message: String) -> Result<&'static str, String> {
    if !is_turn_id(&id) {
        return Err("invalid id".to_string());
    }
    let message: String = message.chars().filter(|c| *c != '\0').collect::<String>().trim().to_string();
    if message.chars().count() > MESSAGE_MAX || needs_full(&message) {
        return Ok("full");
    }
    let claude = match claude_bin() {
        Ok(c) => c,
        Err(_) => return Ok("full"),
    };
    let history = recent_history(&app.state::<Replies>());
    let now = chrono::Local::now();
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        let portfolio = get_portfolio_dir().ok();
        let tracker = get_tracker_dir().ok();
        build_snapshot(portfolio.as_deref(), tracker.as_deref(), now)
    })
    .await
    .map_err(|e| e.to_string())?;
    let system = system_prompt(&snapshot, &history, now);

    // A neutral working directory: no project CLAUDE.md is read into the quick lane.
    let cwd = std::env::temp_dir().join("pulse-quick");
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let mut cmd = Command::new(&claude);
    cmd.args(quick_args(&system)).current_dir(&cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    for k in BILLING_ENV {
        cmd.env_remove(k);
    }
    cmd.env("PATH", format!("{}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", home.display()));
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return Ok("full"),
    };
    let stdout = child.stdout.take().ok_or("no output from claude")?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(message.as_bytes()); // dropped here: EOF ends the prompt
    }
    let child = Arc::new(Mutex::new(child));
    let cancel = register(&app.state::<Replies>(), &id, Some(child.clone()));
    emit(&app, event(&id, "fast", "start", None));

    let started = Instant::now();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let id = id.as_str();
        // The timeout: kill claude so the read loop ends.
        let (killer_cancel, killer_child) = (cancel.clone(), child.clone());
        std::thread::spawn(move || {
            let until = Instant::now() + QUICK_TIMEOUT;
            while Instant::now() < until {
                if killer_cancel.load(Ordering::SeqCst) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            let _ = killer_child.lock().unwrap().kill();
        });
        let mut gate = Gate::default();
        let mut sentences = Sentences::default();
        let mut answer = String::new();
        let mut handoff = false;
        let mut done = false;
        let pass = |text: String, answer: &mut String, sentences: &mut Sentences| {
            answer.push_str(&text);
            emit(&app2, event(id, "fast", "delta", Some(text.clone())));
            for s in sentences.push(&text) {
                emit(&app2, event(id, "fast", "sentence", Some(s)));
            }
        };
        for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let Ok(ev) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            if let Some(t) = text_delta(&ev) {
                match gate.push(t) {
                    Gated::Hold => {}
                    Gated::Pass(t) => pass(t, &mut answer, &mut sentences),
                    Gated::Handoff => {
                        handoff = true;
                        break;
                    }
                }
            } else if is_message_stop(&ev) || ev.get("type").and_then(|t| t.as_str()) == Some("result") {
                match gate.end() {
                    Gated::Handoff => handoff = true,
                    Gated::Pass(t) => pass(t, &mut answer, &mut sentences),
                    Gated::Hold => {}
                }
                done = true;
                break; // the reply is complete; don't wait for claude to wind down
            }
        }
        cancel.store(true, Ordering::SeqCst); // stops the timeout thread
        {
            let mut c = child.lock().unwrap();
            let _ = c.kill();
            let _ = c.wait();
        }
        let cancelled = !app2.state::<Replies>().turns.lock().unwrap().get(id).is_some_and(|t| Arc::ptr_eq(&t.cancel, &cancel));
        if cancelled {
            return; // Esc, or a newer turn with the same id
        }
        let answer = answer.trim().to_string();
        if handoff {
            emit(&app2, event(id, "fast", "handoff", None));
        } else if !done || answer.is_empty() {
            emit(&app2, event(id, "fast", "error", Some("The quick lane didn't answer.".to_string())));
        } else {
            if let Some(s) = sentences.flush() {
                emit(&app2, event(id, "fast", "sentence", Some(s)));
            }
            remember(&app2.state::<Replies>(), &message, &answer);
            let run_id = write_transcript(&message, &answer, started.elapsed().as_secs_f64());
            emit(&app2, ReplyEvent { ok: Some(true), run_id, ..event(id, "fast", "done", Some(answer)) });
        }
        finish_turn(&app2, id, &cancel);
    });
    Ok("fast")
}

// ------------------------------------------
// Full Roo: push its reply instead of polling
// ------------------------------------------

// What changed in a run since the last look: new transcript lines (from `offset`) and the
// live file's state and step.
pub(crate) fn transcript_events(chunk: &str) -> (Vec<String>, Option<(bool, String)>) {
    let mut texts = Vec::new();
    let mut result = None;
    for line in chunk.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if v.get("sub").is_some() {
            continue; // a subagent's words, not Roo's reply
        }
        match str_of(&v, "t") {
            "text" => texts.push(str_of(&v, "text").to_string()),
            "result" => result = Some((v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false), str_of(&v, "result").to_string())),
            _ => {}
        }
    }
    (texts, result)
}

fn emit_done_full(app: &AppHandle, id: &str, run_id: &str, ok: bool, text: String) {
    let mut s = Sentences::default();
    for sentence in s.push(&text).into_iter().chain(s.flush()) {
        emit(app, event(id, "full", "sentence", Some(sentence)));
    }
    emit(app, ReplyEvent { ok: Some(ok), run_id: Some(run_id.to_string()), ..event(id, "full", "done", Some(text)) });
}

// Follows a run that ask_lead started and pushes its reply on `pulse://roo-reply`. It checks the
// two files every 120 ms (a stat each; a read only when they grew).
#[tauri::command]
pub(crate) fn watch_reply(app: AppHandle, id: String, run_id: String) -> Result<(), String> {
    if !is_turn_id(&id) || !is_run_id(&run_id) {
        return Err("invalid id".to_string());
    }
    let root = get_portfolio_dir()?;
    let cancel = register(&app.state::<Replies>(), &id, None);
    emit(&app, ReplyEvent { run_id: Some(run_id.clone()), ..event(&id, "full", "start", None) });
    std::thread::spawn(move || {
        let started = Instant::now();
        let transcript = root.join("logs/transcripts").join(format!("{}.jsonl", run_id));
        let live = root.join("logs/live").join(format!("{}.json", run_id));
        let (mut offset, mut partial, mut step, mut ended_at) = (0u64, String::new(), String::new(), None::<Instant>);
        while !cancel.load(Ordering::SeqCst) && started.elapsed() < WATCH_MAX {
            // New transcript lines (live.py appends whole lines; a torn last line waits).
            if let Ok(mut f) = std::fs::File::open(&transcript) {
                let len = f.metadata().map(|m| m.len()).unwrap_or(0);
                if len > offset && f.seek(SeekFrom::Start(offset)).is_ok() {
                    let mut buf = String::new();
                    if f.take(len - offset).read_to_string(&mut buf).is_ok() {
                        offset = len;
                        partial.push_str(&buf);
                        let cut = partial.rfind('\n').map(|i| i + 1).unwrap_or(0);
                        let whole: String = partial.drain(..cut).collect();
                        let (texts, result) = transcript_events(&whole);
                        for t in texts.into_iter().filter(|t| !t.trim().is_empty()) {
                            emit(&app, event(&id, "full", "delta", Some(t)));
                        }
                        if let Some((ok, text)) = result {
                            emit_done_full(&app, &id, &run_id, ok, text);
                            break;
                        }
                    }
                }
            }
            if let Ok(v) = std::fs::read_to_string(&live).map(|t| serde_json::from_str::<serde_json::Value>(&t).unwrap_or_default()) {
                let s = str_of(&v, "step");
                if !s.is_empty() && s != step {
                    step = s.to_string();
                    emit(&app, event(&id, "full", "step", Some(step.clone())));
                }
                // Ended without a result line yet: give the transcript a moment, then use the live file.
                if matches!(str_of(&v, "state"), "finished" | "failed") {
                    let t = *ended_at.get_or_insert_with(Instant::now);
                    if t.elapsed() > Duration::from_secs(2) {
                        emit_done_full(&app, &id, &run_id, str_of(&v, "state") == "finished", str_of(&v, "result").to_string());
                        break;
                    }
                }
            }
            std::thread::sleep(WATCH_EVERY);
        }
        finish_turn(&app, &id, &cancel);
    });
    Ok(())
}

// Esc, or the panel closing: stop the quick lane's claude and any watch for this turn.
#[tauri::command]
pub(crate) fn cancel_reply(app: AppHandle, id: String) {
    if let Some(t) = app.state::<Replies>().turns.lock().unwrap().remove(&id) {
        stop_turn(t);
    }
}

pub(crate) fn close_all(state: &Replies) {
    for (_, t) in state.turns.lock().unwrap().drain() {
        stop_turn(t);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_goes_straight_to_full_roo() {
        for m in [
            "Draft a reply to the landlord",
            "can you please check my inbox",
            "Roo, merge the PR",
            "send it",
            "What's in my email from the bank?",
            "Fix the build on the site",
            "remind me to call mom at 5",
            "go",
        ] {
            assert!(needs_full(m), "{}", m);
        }
        assert!(needs_full(&"x".repeat(300)));
        assert!(needs_full("two\nlines"));
    }

    #[test]
    fn questions_try_the_quick_lane() {
        for m in ["hi", "Thanks!", "what's on my list today?", "What's next?", "Anything waiting on me?", "how's Acme doing", "when is my next meeting", "Good morning Roo"] {
            assert!(!needs_full(m), "{}", m);
        }
    }

    #[test]
    fn sentences_cut_on_ends_not_abbreviations() {
        let mut s = Sentences::default();
        assert!(s.push("You have three tasks").is_empty());
        assert_eq!(s.push(". The first is e.g. the deck. Then"), vec!["You have three tasks.", "The first is e.g. the deck."]);
        assert_eq!(s.push(" lunch at 1.30!\nOk"), vec!["Then lunch at 1.30!"]);
        assert_eq!(s.flush().as_deref(), Some("Ok"));
        assert_eq!(s.flush(), None);
        let mut s = Sentences::default();
        assert_eq!(s.push("Ask J. Smith first. Done "), vec!["Ask J. Smith first."]);
    }

    #[test]
    fn gate_catches_handoff_split_across_tokens() {
        let mut g = Gate::default();
        assert!(matches!(g.push("HAND"), Gated::Hold));
        assert!(matches!(g.push("OFF"), Gated::Handoff));
        let mut g = Gate::default();
        assert!(matches!(g.push("H"), Gated::Hold));
        assert!(matches!(g.push("i there"), Gated::Pass(t) if t == "Hi there"));
        assert!(matches!(g.push("!"), Gated::Pass(t) if t == "!"));
        let mut g = Gate::default();
        assert!(matches!(g.push("Hand"), Gated::Pass(_)), "case matters: only the marker");
        let mut g = Gate::default();
        assert!(matches!(g.push("HAN"), Gated::Hold));
        assert!(matches!(g.end(), Gated::Pass(t) if t == "HAN"));
        let mut g = Gate::default();
        assert!(matches!(g.push("HANDOFF"), Gated::Handoff));
    }

    #[test]
    fn deltas_come_from_partial_messages_only() {
        let d: serde_json::Value = serde_json::json!({"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}});
        assert_eq!(text_delta(&d), Some("Hi"));
        let a: serde_json::Value = serde_json::json!({"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}});
        assert_eq!(text_delta(&a), None);
        assert!(is_message_stop(&serde_json::json!({"type":"stream_event","event":{"type":"message_stop"}})));
    }

    #[test]
    fn quick_lane_has_no_tools_and_no_session() {
        let a = quick_args("sys");
        let pos = a.iter().position(|x| x == "--tools").unwrap();
        assert_eq!(a[pos + 1], "");
        for f in ["--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands", "--include-partial-messages"] {
            assert!(a.iter().any(|x| x == f), "{}", f);
        }
        assert!(!a.iter().any(|x| x.contains("agent") || x.contains("allowedTools") || x.contains("resume")));
        assert_eq!(a.last().unwrap(), "sys");
    }

    #[test]
    fn snapshot_reads_status_tasks_outbox_and_calendar() {
        let base = std::env::temp_dir().join(format!("pulse-quick-test-{}", std::process::id()));
        let org = base.join("org");
        let tracker = base.join("tracker");
        std::fs::create_dir_all(org.join("companies/acme")).unwrap();
        std::fs::create_dir_all(org.join("watch")).unwrap();
        std::fs::create_dir_all(org.join("outbox")).unwrap();
        std::fs::create_dir_all(&tracker).unwrap();
        let org = org.canonicalize().unwrap();
        let tracker = tracker.canonicalize().unwrap();
        std::fs::write(org.join("portfolio.json"), r#"{"entities":[{"id":"acme","path":"companies/acme"}]}"#).unwrap();
        std::fs::write(
            org.join("companies/acme/status.json"),
            r#"{"entity":"acme","name":"Acme","health":"yellow","stage":"active","headline":"Two demos booked.",
                "decisions":[{"ask":"Pick the launch offer","recommend":"Bundle A"}],"jay_actions":[{"what":"Sign the lease"}],
                "waiting_on":[{"who":"Sam","what":"the logo"}],"risks":[{"what":"low risk","severity":"low"}],"next":["Ship the site"]}"#,
        )
        .unwrap();
        let now = chrono::Local::now();
        let soon = (now + chrono::Duration::hours(2)).to_rfc3339();
        let later = (now + chrono::Duration::hours(3)).to_rfc3339();
        let past = (now - chrono::Duration::hours(5)).to_rfc3339();
        std::fs::write(
            org.join("watch/calendar.json"),
            serde_json::json!({"fetched_at": 0, "events": [
                {"summary": "Design review", "start": soon, "end": later},
                {"summary": "Old standup", "start": past, "end": past}
            ]})
            .to_string(),
        )
        .unwrap();
        std::fs::write(
            tracker.join("todos.json"),
            r#"{"todos":[{"title":"Call the bank","urgency":"now"},{"title":"Someday thing","urgency":"whenever"},
                         {"title":"Finished","urgency":"now","done":true},{"title":"Later","urgency":"soon","show_from":"2999-01-01"}]}"#,
        )
        .unwrap();
        let snap = build_snapshot(Some(&org), Some(&tracker), now);
        assert!(snap.contains("Design review"), "{}", snap);
        assert!(!snap.contains("Old standup"));
        assert!(snap.contains("Call the bank"));
        assert!(!snap.contains("Someday thing") && !snap.contains("Finished") && !snap.contains("Later"));
        assert!(snap.contains("### Acme (yellow, active)"));
        assert!(snap.contains("Pick the launch offer (recommended: Bundle A)"));
        assert!(snap.contains("Owner to do: Sign the lease"));
        assert!(snap.contains("Waiting on Sam: the logo"));
        assert!(!snap.contains("low risk"));
        assert!(snap.len() < SNAPSHOT_MAX + 20);
        let sys = system_prompt(&snap, &[("hi".into(), "Hey.".into())], now);
        assert!(sys.contains("HANDOFF") && sys.contains("Owner: hi") && sys.contains("NO tools"));
        assert!(sys.contains("at most two short sentences"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn outbox_lists_pending_only() {
        let items = vec![
            serde_json::json!({"status":"pending","kind":"email","entity":"acme","to":["a@b.co"],"subject":"Quote"}),
            serde_json::json!({"status":"sent","kind":"email","entity":"acme","subject":"Old"}),
            serde_json::json!({"status":"pending","kind":"post","entity":"acme","title":"Launch post"}),
        ];
        let l = outbox_lines(&items);
        assert_eq!(l, vec!["- email (acme) to a@b.co: Quote", "- post (acme): Launch post"]);
    }

    #[test]
    fn transcript_reads_like_live_py() {
        let t = transcript_lines("20261105-120000-pulse-quick-ab12", "pulse", "hi", "Hey.", 1.234, "2026-11-05T12:00:00-05:00");
        let lines: Vec<serde_json::Value> = t.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines[0]["t"], "start");
        assert_eq!(lines[0]["kind"], "quick");
        assert_eq!(lines[3]["t"], "result");
        assert_eq!(lines[3]["result"], "Hey.");
        assert_eq!(lines[3]["secs"], 1.2);
        assert!(is_run_id("20261105-120000-pulse-quick-ab12"));
    }

    #[test]
    fn full_runs_report_text_and_result_but_not_subagents() {
        let chunk = [
            r#"{"t":"start","run_id":"x"}"#,
            r#"{"t":"text","text":"Looking."}"#,
            r#"{"t":"text","text":"sub words","sub":"a1"}"#,
            r#"{"t":"tool","name":"Read"}"#,
            r#"{"t":"result","ok":true,"result":"Three things."}"#,
        ]
        .join("\n");
        let (texts, result) = transcript_events(&chunk);
        assert_eq!(texts, vec!["Looking."]);
        assert_eq!(result, Some((true, "Three things.".to_string())));
    }

    // The quick lane against this Mac's real files and claude, timed. Not run by default:
    // cargo test --lib quick_lane_timing -- --ignored --nocapture
    #[test]
    #[ignore]
    fn quick_lane_timing() {
        let now = chrono::Local::now();
        let t0 = Instant::now();
        let snap = build_snapshot(get_portfolio_dir().ok().as_deref(), get_tracker_dir().ok().as_deref(), now);
        println!("snapshot: {} chars in {:?}", snap.len(), t0.elapsed());
        if let Ok(path) = std::env::var("PULSE_QUICK_DUMP") {
            std::fs::write(path, system_prompt(&snap, &[], now)).unwrap();
            return;
        }
        for msg in ["hi", "what's on my list today?", "what did the landlord say yesterday?", "Draft a reply to the last email from the bank"] {
            if needs_full(msg) {
                println!("{:?}: routed to full Roo without trying", msg);
                continue;
            }
            let t0 = Instant::now();
            let mut child = Command::new(claude_bin().unwrap())
                .args(quick_args(&system_prompt(&snap, &[], now)))
                .current_dir(std::env::temp_dir())
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap();
            child.stdin.take().unwrap().write_all(msg.as_bytes()).unwrap();
            let (mut first, mut gate, mut out) = (None, Gate::default(), String::new());
            for line in std::io::BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
                let ev: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
                if let Some(t) = text_delta(&ev) {
                    match gate.push(t) {
                        Gated::Pass(t) => {
                            first.get_or_insert(t0.elapsed());
                            out.push_str(&t);
                        }
                        Gated::Handoff => {
                            out = "HANDOFF".into();
                            break;
                        }
                        Gated::Hold => {}
                    }
                } else if is_message_stop(&ev) {
                    break;
                }
            }
            let _ = child.kill();
            println!("{:?}: first text {:?}, full reply {:?}, {} chars", msg, first, t0.elapsed(), out.len());
        }
    }

    #[test]
    fn turn_ids_are_slugs() {
        assert!(is_turn_id("t-1730822400-ab"));
        assert!(!is_turn_id("../x"));
        assert!(!is_turn_id(""));
    }
}
