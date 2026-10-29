#!/usr/bin/env python3
"""Runners: the agent CLIs a lead can run on, behind one interface.

portfolio.json picks one for the whole org, and an entity can override it:

    "runner": "codex"                                         the whole org, defaults for the rest
    "runner": {"name": "claude-code", "model": "sonnet", "plan_model": "opus", "max_turns": 60}
    entities[i]["runner"]: same shapes, for one entity

Fields: name (claude-code | codex | opencode), model (the night shift and decision runs),
plan_model (the weekly review), max_turns (claude-code only), network (codex: let commands
reach the network inside its sandbox; default true, leads push branches and open PRs),
read_also (codex: files outside the work dirs commands may read; default git and gh config),
temp (codex: commands may use the temp folders; default true).

Where a lead may work: the org folder, plus "dirs" (a list of folders, such as the repos a
business owns) at the top of portfolio.json and on each entity. Every run starts in the org
folder and its reads are confined to those dirs as far as the CLI allows:

    claude-code  working directories (--add-dir) + permissions.blockReadsOutsideWorkingDirectories;
                 the read-only shell commands (ls, cat, grep...) are not pre-approved, so a read
                 outside prompts, which an unattended run refuses. Other programs it runs
                 (git, node, python) are not fenced by Claude Code.
    codex        an OS-level permission profile: every command reads and writes only the work
                 dirs, read_also and the system paths tools need (codex's ":minimal"), plus temp.
    opencode     external_directory: deny except the dirs (file tools), and shell read commands
                 allowed only with a path under a work dir. A command rule matches text, not
                 paths, so it is best-effort; other programs it runs are not fenced.
Switching runners is that one field. A runner whose agent files are missing gets them
from <org>/agents on its first run (never overwriting).

Each adapter turns its CLI's JSON event stream into the transcript lines live.py writes
(text, tool, error, deploy, agent_done) and sums up the run: ok, result, cost when the CLI
reports it (never estimated), tokens when it reports those, and the model.

    claude-code  claude -p --agent <lead> --output-format stream-json      subagents: yes
    codex        codex exec --json (sandbox workspace-write, approvals never,
                 the lead's instructions as developer_instructions)       subagents: no
    opencode     opencode run --format json --agent <lead>                subagents: yes

Verified against: Claude Code's stream-json (this org's own runs); codex-cli 0.165.0
(`codex exec --help`, a real signed-out run, codex-rs/exec/src/exec_events.rs, execpolicy
check); opencode 1.19.5 (`opencode run --help` and real runs with a free model, including
a subagent and a denied command).
"""
import json, os, pathlib, re, shutil, subprocess

from live import HOME, ORG, clip, first_line, tool_summary, now_iso
import policy

EXTRA_PATH = [str(HOME / ".local" / "bin"), str(HOME / ".opencode" / "bin"), "/opt/homebrew/bin", "/usr/local/bin"]
DEFAULT = "claude-code"
MANAGERS = ("sales-manager", "marketing-manager", "delivery-manager", "finance-manager", "admin-manager")
AGENTS_DIR = ORG / "agents"            # the model-neutral agent files setup.py renders


def search_path():
    return ":".join(EXTRA_PATH + [os.environ.get("PATH", "")])


# --------------------------------------------------------------------------
# Agent files: neutral frontmatter (name, description, role, tier) + markdown
# --------------------------------------------------------------------------

def split_agent(text):
    """({key: value}, body) for a markdown file with simple `key: value` frontmatter."""
    meta, body = {}, text
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end != -1:
            for line in text[4:end].splitlines():
                if ":" in line and not line.startswith((" ", "\t")):
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip()
            body = text[end + 4:].lstrip("\n")
    return meta, body


CLAUDE_MODEL = {"deep": "opus", "fast": "sonnet"}


def for_claude(meta, body):
    lines = [f"name: {meta.get('name', '')}", f"description: {meta.get('description', '')}"]
    model = CLAUDE_MODEL.get(meta.get("tier", ""))
    if model:
        lines.append(f"model: {model}")
    return "---\n" + "\n".join(lines) + "\n---\n\n" + body


def _bash_pattern(rule):
    return rule[len("Bash("):-1] if rule.startswith("Bash(") and rule.endswith(")") else None


def is_read_shell(rule):
    p = _bash_pattern(rule)
    return bool(p) and p.split(" ", 1)[0] in policy.READ_SHELL


def opencode_rules(role, dirs=()):
    """The policy as an opencode permission object. Bash: last match wins, so deny-everything
    first, then the allowed prefixes, the read commands for paths under the work dirs only, and
    last the never and ask-first lists. external_directory: anything outside the run's folder
    (the org) is refused, not asked about (an "ask" in an unattended run is auto-rejected and
    ends the whole run), except the extra dirs."""
    bash = {"*": "deny"}
    for rule in policy.ALLOWED:
        p = _bash_pattern(rule)
        if p and not is_read_shell(rule):
            bash[p] = "allow"
    bash["ls"] = "allow"                        # the run's folder itself
    for d in dirs:
        for cmd in policy.READ_SHELL:
            bash[f"{cmd} {d}*"] = "allow"
            bash[f"{cmd} -* {d}*"] = "allow"
    for rule in policy.NEVER + policy.NEEDS_YES:
        p = _bash_pattern(rule)
        if p:
            bash[p] = "deny"
    external = {"*": "deny"}
    for d in list(dirs)[1:]:
        external[f"{d}/**"] = "allow"
    return {"edit": "allow", "read": {"*": "allow", "*.env": "deny", "*.env.*": "deny"}, "webfetch": "allow",
            "external_directory": external, "task": "deny" if role == "manager" else "allow", "bash": bash}


def _yaml(obj, indent=0):
    out = []
    for k, v in obj.items():
        key = k if re.match(r"^[a-z_]+$", k) else json.dumps(k)
        if isinstance(v, dict):
            out.append(" " * indent + f"{key}:")
            out += _yaml(v, indent + 2)
        else:
            out.append(" " * indent + f"{key}: {v}")
    return out


def for_opencode(meta, body):
    """The static agent file: the policy with no extra dirs, so the agent alone can't leave the
    org folder. Each run passes the entity's dirs on top (OpenCode.env)."""
    mode = "subagent" if meta.get("role") == "manager" else "primary"
    head = [f"description: {json.dumps(meta.get('description', ''), ensure_ascii=False)}", f"mode: {mode}",
            "permission:"] + _yaml(opencode_rules(meta.get("role")), 2)
    return "---\n" + "\n".join(head) + "\n---\n\n" + body


def codex_rules():
    """The policy as codex execpolicy rules: commands it must never run."""
    out = ["# Pulse org guardrails for codex (generated from bin/policy.py). Commands matching these",
           "# prefixes are blocked without asking. Edit policy.py, not this file.", ""]
    for pattern, why in policy.SHELL_FORBIDDEN:
        out.append(f"prefix_rule(\n    pattern = {json.dumps(pattern)},\n    decision = \"forbidden\",\n"
                   f"    justification = {json.dumps(why)},\n)\n")
    return "\n".join(out)


def _toml_table(d):
    """An inline TOML table; JSON strings are valid TOML basic strings."""
    def val(v):
        return "true" if v is True else "false" if v is False else json.dumps(v, ensure_ascii=False)
    return "{" + ",".join(f"{json.dumps(k, ensure_ascii=False)}={val(v)}" for k, v in d.items()) + "}"


def agent_text(agent):
    """The neutral agent file for `agent`, or None. Falls back to a Claude Code agent file
    for orgs set up before agents/ existed."""
    for p in (AGENTS_DIR / f"{agent}.md", HOME / ".claude" / "agents" / f"{agent}.md"):
        if p.is_file():
            return p.read_text()
    return None


def install_missing(path, content):
    """Writes `content` to `path` only if nothing is there. True when it wrote."""
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(content)
    os.replace(tmp, path)
    return True


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

def resolve(registry, entity_id=None):
    """The runner config for an entity (or the org): {"name", "model", "plan_model", ...}.
    An entity naming a different runner starts from that runner's defaults, not the org's
    model names, which belong to another CLI."""
    def as_dict(v):
        return {"name": v} if isinstance(v, str) else dict(v) if isinstance(v, dict) else {}
    org = as_dict((registry or {}).get("runner"))
    org.setdefault("name", DEFAULT)
    ent = next((e for e in (registry or {}).get("entities", []) if e.get("id") == entity_id), None)
    own = as_dict((ent or {}).get("runner"))
    if own.get("name") and own["name"] != org["name"]:
        cfg = own
    else:
        cfg = {**org, **own}
    if cfg["name"] not in ADAPTERS:
        raise ValueError(f"unknown runner {cfg['name']!r}: use one of {sorted(ADAPTERS)}")
    return cfg


def get(cfg):
    return ADAPTERS[cfg["name"]](cfg)


def work_dirs(registry, entity_id=None):
    """Where a lead may work: the org folder first, then the registry's and the entity's
    "dirs", absolute, without duplicates. A dir that doesn't exist is still listed (a repo
    may be cloned later) but never the filesystem root or the home folder itself."""
    ent = next((e for e in (registry or {}).get("entities", []) if e.get("id") == entity_id), None) or {}
    out = [str(ORG.resolve())]
    for d in list((registry or {}).get("dirs") or []) + list(ent.get("dirs") or []):
        if not isinstance(d, str) or not d.strip():
            continue
        p = pathlib.Path(os.path.expanduser(d.strip()))
        if not p.is_absolute():
            p = ORG / p
        p = p.resolve()
        if p in (pathlib.Path("/"), HOME.resolve()) or str(p) in out:
            continue
        out.append(str(p))
    return out


# --------------------------------------------------------------------------
# Adapters
# --------------------------------------------------------------------------

class Adapter:
    name = ""
    label = ""
    binary = ""
    subagents = False
    install_hint = ""

    def __init__(self, cfg=None):
        self.cfg = cfg or {"name": self.name}

    def find(self):
        return shutil.which(self.binary, path=search_path())

    def model(self, tier_model):
        """The model for a run. Callers pass Claude-style tiers ("sonnet" for the night shift,
        "opus" for planning); other runners use their configured model or the CLI's default."""
        plan = tier_model == "opus"
        return self.cfg.get("plan_model" if plan else "model") or self.cfg.get("model") or None

    def solo_note(self):
        return ("" if self.subagents else
                "\n\nThis runner can't deploy agents. Do the managers' work yourself, one function at a "
                "time (sales, marketing, delivery, finance, admin), and keep each step small.")

    def ensure_agents(self, agents):
        return []

    def cwd(self, dirs):
        return dirs[0]

    def env(self, agent, dirs):
        return {}

    def signed_in(self, binary):
        """(True | False | None, detail). None = couldn't tell."""
        return None, ""


class ClaudeCode(Adapter):
    name, label, binary = "claude-code", "Claude Code", "claude"
    subagents = True
    install_hint = "Install Claude Code, then run `claude` once to sign in."

    def model(self, tier_model):
        plan = tier_model == "opus"
        return self.cfg.get("plan_model" if plan else "model") or tier_model

    def command(self, binary, agent, prompt, model, max_turns, dirs=None):
        # stream-json (needs --verbose under -p) emits each message as it happens; the last
        # event is the same `result` object --output-format json used to print.
        # The run starts in the org folder (cwd); --add-dir adds the entity's other dirs and the
        # settings make the file tools refuse anything outside them. The read-only shell
        # commands are left out of the allow list: inside the dirs Claude Code runs them
        # without asking, outside they need a yes nobody is there to give.
        # --allowedTools / --disallowedTools take every argument after them, so they come last.
        dirs = dirs or [str(ORG)]
        settings = json.dumps({"permissions": {"blockReadsOutsideWorkingDirectories": True}})
        extra = ["--add-dir", *dirs[1:]] if len(dirs) > 1 else []
        return [binary, "-p", prompt, "--agent", agent, "--model", model,
                "--output-format", "stream-json", "--verbose", "--max-turns", str(self.cfg.get("max_turns") or max_turns),
                "--permission-mode", "acceptEdits", "--settings", settings, *extra,
                "--allowedTools", *[r for r in policy.ALLOWED if not is_read_shell(r)],
                "--disallowedTools", *(policy.NEVER + policy.NEEDS_YES)]

    def ensure_agents(self, agents):
        out = []
        for a in agents:
            text = agent_text(a)
            if text and install_missing(HOME / ".claude" / "agents" / f"{a}.md", for_claude(*split_agent(text))):
                out.append(a)
        return out

    def session(self):
        return ClaudeSession()

    def signed_in(self, binary):
        try:
            p = subprocess.run([binary, "auth", "status", "--json"], capture_output=True, text=True, timeout=20)
        except Exception as ex:
            return None, f"{type(ex).__name__}"
        if p.returncode == 0:
            try:
                return bool(json.loads(p.stdout or "{}").get("loggedIn", True)), ""
            except json.JSONDecodeError:
                return True, ""
        return False, "run `claude` once and sign in"


class Codex(Adapter):
    name, label, binary = "codex", "Codex (ChatGPT)", "codex"
    subagents = False
    install_hint = "Install the Codex CLI (`npm i -g @openai/codex` or `brew install codex`), then `codex login` with your ChatGPT account."
    RULES = HOME / ".codex" / "rules" / "pulse-org.rules"

    def instructions(self, agent):
        text = agent_text(agent)
        return split_agent(text)[1] if text else ""

    PROFILE = "pulse-org"
    READ_ALSO = ["~/.gitconfig", "~/.config/git", "~/.config/gh"]

    def profile(self, dirs):
        """-c overrides for a permission profile (codex 0.138+; verified with `codex sandbox`):
        every command reads and writes only the work dirs (workspace roots), reads read_also
        and the system paths tools need, and nothing else on disk. Profiles replace the older
        --sandbox flag, which must not be passed with them."""
        p = f"permissions.{self.PROFILE}"
        files = {":root": "deny", ":minimal": "read"}
        if not self.cfg.get("temp", True):          # temp folders stay usable unless turned off
            files.update({":tmpdir": "deny", ":slash_tmp": "deny"})
        for f in self.cfg.get("read_also", self.READ_ALSO):
            files[f] = "read"
        net = "true" if self.cfg.get("network", True) else "false"
        out = ["-c", f'default_permissions="{self.PROFILE}"', "-c", f'{p}.extends=":workspace"',
               "-c", f"{p}.filesystem=" + _toml_table(files), "-c", f"{p}.network.enabled={net}"]
        if len(dirs) > 1:
            out += ["-c", f"{p}.workspace_roots=" + _toml_table({d: True for d in dirs[1:]})]
        return out

    def command(self, binary, agent, prompt, model, max_turns, dirs=None):
        # No --agent in codex: the lead's file goes in as developer instructions. The run starts
        # in the org folder (-C), which is the main workspace root; the permission profile fences
        # every command to the work dirs. Approvals are never asked for in an unattended run, so
        # anything the profile or the rules block simply fails. Network stays on unless the
        # config turns it off: leads push branches.
        dirs = dirs or [str(ORG)]
        cmd = [binary, "exec", "--json", "--skip-git-repo-check", "-C", dirs[0],
               "-c", 'approval_policy="never"', *self.profile(dirs)]
        instr = self.instructions(agent)
        if instr:
            cmd += ["-c", "developer_instructions=" + json.dumps(instr, ensure_ascii=False)]
        if model:
            cmd += ["-m", model]
        return cmd + [prompt]

    def ensure_agents(self, agents):
        return ["execpolicy rules"] if install_missing(self.RULES, codex_rules()) else []

    def session(self):
        return CodexSession()

    def signed_in(self, binary):
        try:
            p = subprocess.run([binary, "login", "status"], capture_output=True, text=True, timeout=20)
        except Exception as ex:
            return None, f"{type(ex).__name__}"
        return (True, "") if p.returncode == 0 else (False, "run `codex login` and sign in with ChatGPT")


class OpenCode(Adapter):
    name, label, binary = "opencode", "opencode (any provider)", "opencode"
    subagents = True
    install_hint = "Install opencode (`npm i -g opencode-ai` or `brew install opencode`), then `opencode auth login` for your provider."
    AGENTS = HOME / ".config" / "opencode" / "agents"

    def env(self, agent, dirs):
        """This run's permissions for the lead and every manager it can call: the agent files'
        policy plus the entity's dirs. Passed as inline config, so the files never go stale
        (verified with `opencode debug agent`: it takes precedence over the file)."""
        names = [agent] + list(MANAGERS)
        cfg = {"agent": {a: {"permission": opencode_rules("manager" if a in MANAGERS else "lead", dirs)} for a in names}}
        return {"OPENCODE_CONFIG_CONTENT": json.dumps(cfg)}

    def command(self, binary, agent, prompt, model, max_turns, dirs=None):
        dirs = dirs or [str(ORG)]
        cmd = [binary, "run", "--format", "json", "--agent", agent, "--dir", dirs[0]]
        if model:
            cmd += ["-m", model]
        return cmd + [prompt]

    def ensure_agents(self, agents):
        out = []
        for a in list(agents) + list(MANAGERS):
            text = agent_text(a)
            if text and install_missing(self.AGENTS / f"{a}.md", for_opencode(*split_agent(text))):
                out.append(a)
        return out

    def session(self):
        return OpenCodeSession()

    def signed_in(self, binary):
        if any(os.environ.get(k) for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY")):
            return True, "provider key in the environment"
        auth = HOME / ".local" / "share" / "opencode" / "auth.json"
        try:
            if json.loads(auth.read_text()):
                return True, ""
        except (OSError, json.JSONDecodeError):
            pass
        return False, "run `opencode auth login` (opencode's free models work without it)"


ADAPTERS = {a.name: a for a in (ClaudeCode, Codex, OpenCode)}


def detect():
    """Installed runners, in preference order: [(name, path)]."""
    return [(n, p) for n, p in ((n, ADAPTERS[n]().find()) for n in ADAPTERS) if p]


# --------------------------------------------------------------------------
# Sessions: one run's events -> transcript lines, and the run's summary
# --------------------------------------------------------------------------

class ClaudeSession:
    """Claude Code's stream-json is what live.Normalizer was written for; nothing to translate."""
    def __init__(self):
        from live import Normalizer
        self.norm = Normalizer()
        self.final = None

    def feed(self, ev):
        if ev.get("type") == "result":
            self.final = ev
        return self.norm.feed(ev)

    def summary(self, returncode):
        f = self.final
        if f is None:
            return None
        return {"ok": not f.get("is_error"), "result": f.get("result") or "", "cost_usd": f.get("total_cost_usd"),
                "models": list((f.get("modelUsage") or {}).keys()), "native_result": True}


def _tool(at, name, inp, sub=False):
    return {"t": "tool", "at": at, "name": name, "summary": tool_summary(name, inp), **({"sub": True} if sub else {})}


class CodexSession:
    """codex exec --json: thread.started, turn.started/completed/failed, item.started/
    updated/completed (agent_message, reasoning, command_execution, file_change,
    mcp_tool_call, web_search, todo_list, collab_tool_call, error) and error."""
    def __init__(self):
        self.seen = set()
        self.last_text = ""
        self.failed = None
        self.completed = False
        self.tokens = {"input": 0, "output": 0}
        self.spawned = {}          # receiver thread id -> spawn item id
        self.done = set()
        self.deployed = 0

    def feed(self, ev):
        at, t = now_iso(), ev.get("type")
        if t == "turn.completed":
            self.completed = True
            u = ev.get("usage") or {}
            self.tokens["input"] += int(u.get("input_tokens") or 0)
            self.tokens["output"] += int(u.get("output_tokens") or 0) + int(u.get("reasoning_output_tokens") or 0)
            return []
        if t == "turn.failed":
            self.failed = ((ev.get("error") or {}).get("message") or "the turn failed")
            return [{"t": "error", "at": at, "text": clip(self.failed, 400)}]
        if t == "error":
            msg = ev.get("message") or ""
            # Transport retries ("Reconnecting... 2/5") are noise; the final failure follows.
            return [] if msg.startswith("Reconnecting") else [{"t": "error", "at": at, "text": clip(msg, 400)}]
        if t not in ("item.started", "item.updated", "item.completed"):
            return []
        item = ev.get("item") or {}
        kind, iid, status = item.get("type"), item.get("id"), item.get("status")
        out = []
        first = iid not in self.seen
        self.seen.add(iid)
        if kind == "agent_message" and t == "item.completed" and (item.get("text") or "").strip():
            self.last_text = item["text"].strip()
            out.append({"t": "text", "at": at, "text": clip(self.last_text)})
        elif kind == "command_execution":
            cmd = re.sub(r"^(?:/bin/)?(?:ba|z)?sh -l?c\s+", "", item.get("command") or "").strip("'\"")
            if first:
                out.append(_tool(at, "Bash", {"command": cmd}))
            if t == "item.completed" and status in ("failed", "declined"):
                why = "declined by the sandbox or rules" if status == "declined" else f"exit {item.get('exit_code')}"
                out.append({"t": "error", "at": at, "text": clip(f"{cmd}: {why}", 400)})
        elif kind == "file_change" and t == "item.completed":
            for c in (item.get("changes") or [])[:5]:
                name = {"add": "Write", "delete": "Edit"}.get(c.get("kind"), "Edit")
                out.append(_tool(at, name, {"file_path": c.get("path")}))
        elif kind == "mcp_tool_call":
            name = f"mcp__{item.get('server') or 'mcp'}__{item.get('tool') or 'tool'}"
            if first:
                out.append(_tool(at, name, item.get("arguments")))
            if t == "item.completed" and (item.get("error") or status == "failed"):
                out.append({"t": "error", "at": at, "text": clip(((item.get("error") or {}).get("message") or f"{name} failed"), 400)})
        elif kind == "web_search" and first:
            out.append(_tool(at, "WebSearch", {"query": item.get("query")}))
        elif kind == "todo_list" and first:
            out.append(_tool(at, "TodoWrite", {}))
        elif kind == "error" and item.get("message"):
            out.append({"t": "error", "at": at, "text": clip(item["message"], 400)})
        elif kind == "collab_tool_call":
            out += self._collab(at, t, item)
        return out

    def _collab(self, at, t, item):
        """Codex's own subagents: spawn_agent is a deployment; an agent state of completed /
        errored / shutdown is its end."""
        out = []
        iid = item.get("id")
        if item.get("tool") == "spawn_agent" and iid not in self.done and t == "item.started":
            prompt = item.get("prompt") or ""
            out.append({"t": "deploy", "at": at, "agents": [{"id": iid, "type": "agent", "description": clip(first_line(prompt, 120), 120),
                                                           "prompt": first_line(prompt), "background": True, "by": None}]})
            self.deployed += 1
            self.done.add(iid)
        if item.get("tool") == "spawn_agent":
            for rid in item.get("receiver_thread_ids") or []:
                self.spawned.setdefault(rid, iid)
        for rid, state in (item.get("agents_states") or {}).items():
            sid = self.spawned.get(rid)
            st = (state or {}).get("status")
            if sid and st in ("completed", "errored", "shutdown", "interrupted") and ("end", sid) not in self.done:
                self.done.add(("end", sid))
                out.append({"t": "agent_done", "at": at, "id": sid, "status": "completed" if st == "completed" else "failed",
                            "summary": clip((state or {}).get("message") or "", 600), "secs": None, "tools": None})
        return out

    def summary(self, returncode):
        ok = self.completed and not self.failed and returncode == 0
        result = self.last_text if ok or not self.failed else self.failed
        return {"ok": ok, "result": result or ("" if ok else "codex stopped without an answer"),
                "cost_usd": None, "tokens": self.tokens if any(self.tokens.values()) else None}


OPENCODE_TOOLS = {"read": "Read", "write": "Write", "edit": "Edit", "patch": "Edit", "bash": "Bash", "grep": "Grep",
                  "glob": "Glob", "list": "Glob", "webfetch": "WebFetch", "websearch": "WebSearch", "todowrite": "TodoWrite",
                  "todoread": "TodoWrite"}
TASK_RESULT = re.compile(r"</?task[^>]*>|</?task_result>")


class OpenCodeSession:
    """opencode run --format json: step_start, text, tool_use (one event when a tool call
    ends, status completed | error), step_finish (tokens and cost per step), error."""
    def __init__(self):
        self.last_text = ""
        self.error = None
        self.tokens = {"input": 0, "output": 0}
        self.cost = None
        self.models = []
        self.last_reason = None    # a run that finished on its own ends with a "stop" step

    def feed(self, ev):
        t, part = ev.get("type"), ev.get("part") or {}
        at = now_iso()
        if t == "text" and (part.get("text") or "").strip():
            self.last_text = part["text"].strip()
            return [{"t": "text", "at": at, "text": clip(self.last_text)}]
        if t == "step_finish":
            self.last_reason = part.get("reason")
            tok = part.get("tokens") or {}
            self.tokens["input"] += int(tok.get("input") or 0) + int((tok.get("cache") or {}).get("read") or 0)
            self.tokens["output"] += int(tok.get("output") or 0) + int(tok.get("reasoning") or 0)
            if isinstance(part.get("cost"), (int, float)):
                self.cost = (self.cost or 0) + part["cost"]
            return []
        if t == "error":
            err = ev.get("error") or {}
            msg = (err.get("data") or {}).get("message") or err.get("message") or err.get("name") or "opencode error"
            self.error = msg
            return [{"t": "error", "at": at, "text": clip(str(msg), 400)}]
        if t != "tool_use":
            return []
        tool = part.get("tool") or ""
        state = part.get("state") or {}
        inp = state.get("input") if isinstance(state.get("input"), dict) else {}
        if tool == "task":
            tid = part.get("callID") or part.get("id") or "task"
            times = state.get("time") or {}
            secs = round((times["end"] - times["start"]) / 1000) if times.get("end") and times.get("start") else None
            summary = TASK_RESULT.sub("", state.get("output") or state.get("error") or "").strip()
            return [{"t": "deploy", "at": at, "agents": [{"id": tid, "type": inp.get("subagent_type") or "agent",
                                                          "description": clip(inp.get("description") or "", 120),
                                                          "prompt": first_line(inp.get("prompt")), "background": False, "by": None}]},
                    {"t": "agent_done", "at": at, "id": tid, "status": "failed" if state.get("status") == "error" else "completed",
                     "summary": clip(summary, 600), "secs": secs, "tools": None}]
        name = OPENCODE_TOOLS.get(tool, tool)
        args = {"file_path": inp.get("filePath") or inp.get("path"), "command": inp.get("command"),
                "pattern": inp.get("pattern"), "url": inp.get("url"), "query": inp.get("query")}
        out = [_tool(at, name, {k: v for k, v in args.items() if v})]
        if state.get("status") == "error":
            out.append({"t": "error", "at": at, "text": clip(state.get("error") or f"{tool} failed", 400)})
        return out

    def summary(self, returncode):
        # opencode exits 0 even when a permission prompt is auto-rejected and the run stops
        # mid-task, so only a last step that ended with "stop" counts as finished.
        stopped_early = self.last_reason not in (None, "stop")
        ok = returncode == 0 and not self.error and not stopped_early
        why = self.error or (f"stopped before finishing (last step: {self.last_reason})" if stopped_early else "")
        return {"ok": ok, "result": self.last_text if ok else (why or self.last_text or "opencode stopped without an answer"),
                "cost_usd": self.cost, "tokens": self.tokens if any(self.tokens.values()) else None}
