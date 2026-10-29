#!/usr/bin/env python3
"""Live state and transcripts for every agent run, so Pulse can show who is working now.

    logs/live/<run_id>.json          one per run: what it's doing, its latest step, its state
    logs/transcripts/<run_id>.jsonl  the run's conversation, normalized and redacted

A run is `running` until it finishes (`finished` | `failed`). Interactive sessions (the
hook in session_hook.py) also go `idle` between turns. Pulse treats a running or idle
run whose pid is gone as "stopped unexpectedly".

Transcript lines (one JSON object each, every string redacted):
    {"t":"start","at","run_id","kind","entity","agent","doing","prompt"}
    {"t":"user","at","text"}                    the owner's turn (interactive sessions)
    {"t":"text","at","text","sub"?}             the agent's words
    {"t":"tool","at","name","summary","sub"?}   a tool call, as one line
    {"t":"error","at","text"}                   a tool call that failed
    {"t":"result","at","ok","result","cost_usd","secs","turns","models","tokens"?}
`sub` marks events from a subagent the lead delegated to. Tool outputs are never stored.

PORTFOLIO_ROOT overrides the org folder (default: the parent of this bin/).
"""
import datetime, json, os, pathlib, re, secrets, time

HOME = pathlib.Path.home()
# The org folder: PORTFOLIO_ROOT (tests), else the folder this bin/ lives in.
ORG = pathlib.Path(os.environ.get("PORTFOLIO_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
LOGS = ORG / "logs"
LIVE = LOGS / "live"
TRANSCRIPTS = LOGS / "transcripts"
KEEP_FINISHED_SECS = 2 * 86400      # finished live files are pruned after this
TEXT_MAX = 6000                     # one transcript message, after redaction

RUN_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,119}$")


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def new_run_id(agent):
    slug = re.sub(r"[^a-z0-9-]+", "-", (agent or "run").lower()).strip("-")[:40] or "run"
    return f"{time.strftime('%Y%m%d-%H%M%S')}-{slug}-{secrets.token_hex(2)}"


# --------------------------------------------------------------------------
# Redaction: a transcript or live file never holds a key in plaintext
# --------------------------------------------------------------------------

REDACTED = "[redacted]"
SECRET_PATTERNS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|\Z)", re.S),
    re.compile(r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}"),           # Stripe secret / restricted
    re.compile(r"\bwhsec_[A-Za-z0-9]{16,}"),                            # Stripe webhook secret
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]{16,}"),                         # Anthropic
    re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}"),          # OpenAI style
    re.compile(r"\bre_[A-Za-z0-9_]{16,}"),                              # Resend
    re.compile(r"\bph[xc]_[A-Za-z0-9]{20,}"),                           # PostHog
    re.compile(r"\bsb_secret_[A-Za-z0-9_-]{10,}"),                      # Supabase
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"),                            # Google API key
    re.compile(r"\bya29\.[0-9A-Za-z_-]{20,}"),                          # Google OAuth access token
    re.compile(r"\b1//[0-9A-Za-z_-]{30,}"),                             # Google refresh token
    re.compile(r"\bGOCSPX-[A-Za-z0-9_-]{10,}"),                         # Google client secret
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"),                        # GitHub
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}"),                          # GitLab
    re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}"),                     # Slack
    re.compile(r"\bxapp-[A-Za-z0-9-]{10,}"),
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),                       # AWS access key id
    re.compile(r"\b\d{8,10}:AA[A-Za-z0-9_-]{30,}"),                     # Telegram bot token
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),  # JWT
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/-]{16,}=*"),
    re.compile(r"(?i)(://[^/\s:@]+:)[^@\s/]{4,}(?=@)"),                 # password in a URL
]
# KEY=value / "api_key": "value" where the name says it is a secret.
NAMED_SECRET = re.compile(
    r"(?i)\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Z0-9_]*"
    r"[\"']?\s*[:=]\s*[\"']?)([^\s\"',;]{6,})")


def redact(text):
    if not isinstance(text, str) or not text:
        return text
    for p in SECRET_PATTERNS:
        if p.groups:
            text = p.sub(lambda m: m.group(1) + REDACTED, text)
        else:
            text = p.sub(REDACTED, text)
    return NAMED_SECRET.sub(lambda m: m.group(1) + REDACTED, text)


def redact_obj(v):
    if isinstance(v, str):
        return redact(v)
    if isinstance(v, list):
        return [redact_obj(x) for x in v]
    if isinstance(v, dict):
        return {k: redact_obj(x) for k, x in v.items()}
    return v


def clip(text, n=TEXT_MAX):
    text = text or ""
    return text if len(text) <= n else text[: n - 1] + "…"


# --------------------------------------------------------------------------
# Tool calls as one line: what Pulse shows as a step
# --------------------------------------------------------------------------

def short_path(p):
    p = str(p or "")
    for root, label in ((str(ORG) + "/", ""), (str(HOME) + "/", "~/")):
        if p.startswith(root):
            return label + p[len(root):]
    return p


def bash_summary(cmd):
    cmd = " ".join((cmd or "").split())
    if "draft_email.py" in cmd or "create_draft" in cmd:
        return "Drafting an email"
    if "add_todo.py" in cmd:
        return "Adding a tracker task"
    if "act.py --record" in cmd:
        return "Reporting back to the owner"
    if re.search(r"\bgit\b.*\bcommit\b", cmd):
        return "Committing"
    if re.search(r"\bgh pr create\b", cmd):
        return "Opening a pull request"
    if re.search(r"\bgit\b.*\bpush\b", cmd):
        return "Pushing a branch"
    return "Running: " + clip(cmd, 90)


def tool_summary(name, inp):
    inp = inp if isinstance(inp, dict) else {}
    path = short_path(inp.get("file_path") or inp.get("notebook_path") or inp.get("path") or "")
    if name == "Read":
        return f"Reading {path}"
    if name in ("Edit", "MultiEdit", "NotebookEdit"):
        return f"Editing {path}"
    if name == "Write":
        return f"Writing {path}"
    if name == "Bash":
        return bash_summary(inp.get("command"))
    if name in ("Grep", "Glob"):
        where = f" in {path}" if path else ""
        return f"Searching for {clip(inp.get('pattern') or '', 60)}{where}"
    if name == "WebSearch":
        return f"Searching the web: {clip(inp.get('query') or '', 80)}"
    if name == "WebFetch":
        host = re.sub(r"^https?://", "", inp.get("url") or "").split("/")[0]
        return f"Reading {host or 'a web page'}"
    if name in ("Task", "Agent"):
        who = inp.get("subagent_type") or "an agent"
        return f"Asking {who}: {clip(inp.get('description') or '', 70)}"
    if name in ("TodoWrite", "TaskCreate", "TaskUpdate"):
        return "Planning"
    if name.startswith("mcp__"):
        parts = name.split("__")
        tool = parts[-1]
        if "draft" in tool:
            return "Drafting an email"
        server = parts[1].replace("claude_ai_", "").replace("_", " ") if len(parts) > 2 else ""
        return f"Using {server} {tool.replace('_', ' ')}".strip()
    return f"Using {name}"


def result_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


# --------------------------------------------------------------------------
# Normalizing Claude Code events (stream-json, or a session transcript)
# --------------------------------------------------------------------------

# User-role lines a session transcript holds that the owner never typed.
INJECTED = ("<command-", "<local-command", "<system-reminder", "<bash-", "<user-memory", "<task-notification",
            "Caveat: ", "[Request interrupted")


def owner_text(text):
    text = (text or "").strip()
    return "" if not text or text.startswith(INJECTED) else text


AGENT_TOOLS = ("Agent", "Task")      # the tool a lead uses to deploy a subagent
HAND_BACK = re.compile(r"^\[Subagent hand-back\][^\n]*\n+", re.S)


def first_line(text, n=200):
    return clip(next((l.strip() for l in (text or "").splitlines() if l.strip()), ""), n)


def secs_of(ms):
    return round(ms / 1000) if isinstance(ms, (int, float)) else None


class Normalizer:
    """Turns Claude Code events (stream-json, or session transcript lines) into transcript
    lines. Keeps the subagents a run deployed so their results pair with the deployment:

        {"t":"deploy","at","agents":[{"id","type","description","prompt","background","by"}]}
        {"t":"agent_done","at","id","status","summary","secs","tools"}
    """

    def __init__(self):
        self.agents = {}          # tool_use_id -> {"background": bool, "done": bool}

    def _done(self, at, tid, status, summary="", secs=None, tools=None):
        a = self.agents.get(tid)
        if not a or a["done"]:
            return []
        a["done"] = True
        return [{"t": "agent_done", "at": at, "id": tid, "status": status,
                 "summary": clip(HAND_BACK.sub("", summary or "").strip(), 600), "secs": secs, "tools": tools}]

    def feed(self, event):
        t = event.get("type")
        at = event.get("timestamp") or now_iso()
        parent = event.get("parent_tool_use_id")
        sub = bool(parent) or bool(event.get("isSidechain"))
        extra = {"sub": True} if sub else {}
        out = []
        msg = event.get("message") or {}
        content = msg.get("content")
        if t == "assistant" and isinstance(content, list):
            team = []
            for c in content:
                if c.get("type") == "text" and (c.get("text") or "").strip():
                    out.append({"t": "text", "at": at, "text": clip(c["text"].strip()), **extra})
                elif c.get("type") == "tool_use" and c.get("name") in AGENT_TOOLS:
                    inp = c.get("input") if isinstance(c.get("input"), dict) else {}
                    tid = c.get("id") or f"agent-{len(self.agents)}"
                    self.agents[tid] = {"background": bool(inp.get("run_in_background")), "done": False}
                    team.append({"id": tid, "type": inp.get("subagent_type") or "agent",
                                 "description": clip(inp.get("description") or "", 120),
                                 "prompt": first_line(inp.get("prompt")),
                                 "background": bool(inp.get("run_in_background")), "by": parent})
                elif c.get("type") == "tool_use":
                    out.append({"t": "tool", "at": at, "name": c.get("name") or "",
                                "summary": tool_summary(c.get("name") or "", c.get("input")), **extra})
            if team:
                out.append({"t": "deploy", "at": at, "agents": team, **extra})
        elif t == "user":
            if isinstance(content, str) and not sub and owner_text(content) and not event.get("isMeta"):
                out.append({"t": "user", "at": at, "text": clip(owner_text(content))})
            elif isinstance(content, list):
                meta = event.get("tool_use_result") or event.get("toolUseResult")
                meta = meta if isinstance(meta, dict) else {}
                for c in content:
                    tid = c.get("tool_use_id")
                    if c.get("type") == "tool_result" and tid in self.agents:
                        # An async agent's tool result only says it launched (Claude Code may
                        # run one async even when not asked); its end comes as a task notification.
                        text = result_text(c.get("content"))
                        launched = str(meta.get("status") or "").startswith("async") or text.lstrip().startswith("Async agent launched")
                        if (self.agents[tid]["background"] or launched) and not c.get("is_error"):
                            self.agents[tid]["background"] = True
                            continue
                        status = "failed" if c.get("is_error") else ("failed" if meta.get("status") == "failed" else "completed")
                        out += self._done(at, tid, status, result_text(meta.get("content") or c.get("content")),
                                          secs_of(meta.get("totalDurationMs")), meta.get("totalToolUseCount"))
                    elif sub:
                        continue
                    elif c.get("type") == "tool_result" and c.get("is_error"):
                        out.append({"t": "error", "at": at, "text": clip(result_text(c.get("content")), 400)})
                    elif c.get("type") == "text" and owner_text(c.get("text")) and not event.get("isMeta"):
                        out.append({"t": "user", "at": at, "text": clip(owner_text(c["text"]))})
        elif t == "system" and event.get("subtype") == "task_notification":
            usage = event.get("usage") or {}
            status = event.get("status") or "completed"
            out += self._done(at, event.get("tool_use_id"), "completed" if status == "completed" else status,
                              event.get("summary") or "", secs_of(usage.get("duration_ms")), usage.get("tool_uses"))
        elif t == "result":
            stats = event.get("subagent_stats") or {}
            out.append({"t": "result", "at": at, "ok": not event.get("is_error"),
                        "result": clip(event.get("result") or "", 4000),
                        "cost_usd": event.get("total_cost_usd"),
                        "secs": round((event.get("duration_ms") or 0) / 1000),
                        "turns": event.get("num_turns"),
                        "models": list((event.get("modelUsage") or {}).keys()),
                        "agents": max(stats.get("spawned") or 0, len(self.agents))})
        return [redact_obj(x) for x in out]


def normalize(event):
    """Transcript lines for one event, with no memory of earlier ones."""
    return Normalizer().feed(event)


def step_of(lines):
    """The live step for a batch of transcript lines: the last tool call or message."""
    step = None
    for x in lines:
        if x["t"] == "tool":
            step = x["summary"]
        elif x["t"] == "text":
            step = "Writing: " + clip(" ".join(x["text"].split()), 90)
        elif x["t"] == "deploy":
            step = deploy_label(x["agents"])
    return step


def deploy_label(agents):
    n = len(agents)
    types = ", ".join(dict.fromkeys(a["type"] for a in agents))
    return f"Deployed {n} agent{'s' if n != 1 else ''}: {types}"


# --------------------------------------------------------------------------
# Live files
# --------------------------------------------------------------------------

def write_json_atomic(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False))
    os.replace(tmp, path)


def pid_alive(pid):
    try:
        os.kill(int(pid), 0)
    except (ProcessLookupError, ValueError, TypeError):
        return False
    except PermissionError:
        return True
    return int(pid) > 0


def prune(now=None):
    """Drop live files older than KEEP_FINISHED_SECS that are finished, or that say they
    are working but whose process is gone (Pulse shows those as stopped until then)."""
    now = now or time.time()
    if not LIVE.is_dir():
        return
    for f in LIVE.glob("*.json"):
        try:
            d = json.loads(f.read_text())
            if now - f.stat().st_mtime <= KEEP_FINISHED_SECS:
                continue
            if d.get("state") in ("finished", "failed") or not pid_alive(d.get("pid")):
                f.unlink()
        except (OSError, json.JSONDecodeError):
            continue


BATCH_SECS = 5


def age_secs(iso):
    try:
        return (datetime.datetime.now().astimezone() - datetime.datetime.fromisoformat(iso)).total_seconds()
    except (TypeError, ValueError):
        return 1e9


class LiveRun:
    """One run's live file and transcript. Use as a context manager so the live file is
    finalized even when the run raises: `with LiveRun(...) as live: ...; live.finish(...)`."""

    def __init__(self, kind, agent, entity=None, doing="", prompt="", run_id=None, pid=None):
        self.run_id = run_id or new_run_id(agent)
        if not RUN_ID.match(self.run_id):
            raise ValueError(f"bad run id: {self.run_id}")
        self.path = LIVE / f"{self.run_id}.json"
        self.transcript = TRANSCRIPTS / f"{self.run_id}.jsonl"
        self.state = {
            "run_id": self.run_id, "kind": kind, "entity": entity, "agent": agent,
            "doing": redact(clip(doing, 200)), "started": now_iso(), "pid": pid or os.getpid(),
            "transcript": f"logs/transcripts/{self.run_id}.jsonl",
            "state": "running", "step": "Starting", "step_at": now_iso(), "updated": now_iso(),
        }
        self._prompt = prompt
        self._done = False
        self.normalizer = Normalizer()
        self.stderr_tail = ""

    def start_line(self):
        return {"t": "start", "at": self.state["started"], "run_id": self.run_id,
                "kind": self.state["kind"], "entity": self.state["entity"], "agent": self.state["agent"],
                "doing": self.state["doing"], "prompt": redact(clip(self._prompt))}

    def open(self, state="running", step="Starting"):
        """Writes the live file and the transcript's start line."""
        prune()
        TRANSCRIPTS.mkdir(parents=True, exist_ok=True)
        self.append([self.start_line()])
        self.state.update(state=state, step=step)
        self._write()
        return self

    @classmethod
    def load(cls, run_id):
        """The run behind an existing live file (a later hook call for the same session)."""
        if not RUN_ID.match(run_id or ""):
            raise ValueError(f"bad run id: {run_id}")
        state = json.loads((LIVE / f"{run_id}.json").read_text())
        live = cls(state.get("kind") or "run", state.get("agent") or "", run_id=run_id)
        live.state = state
        return live

    def __enter__(self):
        return self.open()

    def __exit__(self, exc_type, exc, tb):
        if not self._done:
            why = f"{exc_type.__name__}: {exc}" if exc_type else "ended without a result"
            self.finish(False, why)
        return False

    def _write(self):
        self.state["updated"] = now_iso()
        write_json_atomic(self.path, self.state)

    def append(self, lines):
        if not lines:
            return
        with self.transcript.open("a") as f:
            for x in lines:
                f.write(json.dumps(x, ensure_ascii=False) + "\n")

    def step(self, text):
        # Every step is written: they come one per model message, and a skipped one could
        # stay on screen through a long tool call.
        if not text:
            return
        self.state["step"] = redact(clip(text, 160))
        self.state["step_at"] = now_iso()
        self._write()

    def event(self, ev):
        """Feed one Claude Code event: append it to the transcript, track the team, move the step."""
        return self.add(self.normalizer.feed(ev))

    def add(self, lines):
        """Transcript lines from any runner (runners.py): append them, track the team, move the step."""
        self.append(lines)
        for x in lines:
            if x["t"] == "deploy":
                self.deploy(x["agents"], x["at"], write=False)
            elif x["t"] == "agent_done":
                self.agent_done(x["id"], x["status"], x.get("summary"), x.get("secs"), write=False)
        self.step(step_of(lines))
        return lines

    # The team: subagents this run deployed, in batches (one batch per deploying message).
    def team(self):
        return self.state.setdefault("team", [])

    def deploy(self, agents, at=None, write=True):
        """Adds agents to the team. Agents deployed within BATCH_SECS of the last one join
        its batch: a lead often launches a team over a few consecutive messages."""
        team = self.team()
        if team and age_secs(team[-1].get("started")) < BATCH_SECS:
            batch = team[-1]["batch"]
        else:
            batch = self.state.get("deployments", 0)
            self.state["deployments"] = batch + 1
        for a in agents:
            self.team().append(redact_obj({**a, "batch": batch, "started": at or now_iso(), "status": "running"}))
        if write:
            self._write()

    def agent_done(self, aid, status, summary=None, secs=None, write=True):
        for a in self.team():
            if a.get("id") == aid and a.get("status") == "running":
                a.update(status=status, finished=now_iso(), summary=redact(clip(" ".join((summary or "").split()), 300)), secs=secs)
                if write:
                    self._write()
                return True
        return False

    def set(self, **fields):
        self.state.update(redact_obj(fields))
        self._write()

    def finish(self, ok, result="", cost_usd=None, secs=None, append_result=False, tokens=None, extra=None):
        if self._done:
            return
        self._done = True
        # Agents still marked running when the lead stops never reported back.
        for a in self.team():
            if a.get("status") == "running":
                a.update(status="unfinished", finished=now_iso())
        line = " ".join((result or "").split())
        self.state.update(state="finished" if ok else "failed", finished=now_iso(), ok=bool(ok),
                          result=redact(clip(line, 300)), cost_usd=cost_usd, secs=secs)
        # Runners that report tokens but not cost (codex) show tokens; nothing is estimated.
        if tokens:
            self.state["tokens"] = tokens
        if append_result:
            row = {"t": "result", "at": now_iso(), "ok": bool(ok), "result": clip(result or "", 4000),
                   "cost_usd": cost_usd, "secs": secs}
            if tokens:
                row["tokens"] = tokens
            row.update(extra or {})
            self.append([redact_obj(row)])
        self._write()
