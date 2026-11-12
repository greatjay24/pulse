#!/usr/bin/env python3
"""Talk to a lead from Roo: the command box and the composer under every conversation.

    ask.py <entity|lead> --message "..." [--session <id> | --new] [--model <m>] [--dry-run]
    ask.py --stop <run_id>

<entity|lead> is an entity id from portfolio.json, that entity's lead (acme-lead), pulse / org
for the front door (portfolio.json "front_door": the one assistant the owner talks to, which
hands work to the leads with pulse.py), or chief-of-staff / cos for the chief of staff.
Without a front door, org still means the chief of staff.

1. Validates the target against portfolio.json and the message (8000 chars, no NULs).
2. Starts a background worker and prints one JSON line at once:
   {"ok", "run_id", "agent", "entity", "queued"}. Roo opens logs/live/<run_id>.json.
3. The worker runs the lead headlessly on the org's runner (portfolio.json "runner", or the
   entity's own: claude-code, codex or opencode; see runners.py), with the same guardrails as
   the night shift (policy.py: no sending, no deletes, no merges or production deploys),
   streamed through live.py as kind "chat".

Claude Code (the main path): the message goes in on stdin, so it can never read as a flag.
Each run's session id (from the stream) is kept in the live file and in
logs/chat_sessions.json (latest per lead). By default a message continues that lead's latest
conversation with `--resume`; --new starts fresh; --session picks one. If the session can't
be resumed, the worker starts fresh and says so in the transcript. Billing: the child runs on
the claude CLI's own sign-in (the owner's subscription); ANTHROPIC_API_KEY and the other
variables that would switch it to API billing or another provider are removed from its
environment.

codex and opencode: the message is the prompt argument (guarded so it can't read as a flag),
with the chat guardrails in front of it. Each message starts a fresh run; the lead keeps
context through the org's files (BRIEF.md, status.json), not a resumed session.

One chat per lead at a time: a message sent while one is running waits its turn (its live
file says "queued") and then continues the same conversation.

--stop kills a run's process group (its agent CLI and everything it started), or cancels a
queued message. The run ends as "Stopped by you".

PORTFOLIO_ROOT overrides the org folder (default: the parent of this bin/). PULSE_CLAUDE
overrides the claude binary (tests only).
"""
import argparse, contextlib, fcntl, json, os, pathlib, re, signal, subprocess, sys, tempfile, threading, time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import live as livemod  # noqa: E402
from live import HOME, ORG, LiveRun, clip, new_run_id, now_iso, redact, short_path, write_json_atomic  # noqa: E402
import runners  # noqa: E402

LOGS = ORG / "logs"
LIVE = LOGS / "live"
SESSIONS = LOGS / "chat_sessions.json"
CLAUDE = os.environ.get("PULSE_CLAUDE") or ""
BINARIES = {}                # runner name -> binary, for tests (a fake CLI)

KIND = "chat"
MESSAGE_MAX = 8000
MAX_TURNS, TIMEOUT = 200, 7200
CHAT_MODEL = "sonnet"        # the tier hint for chat when neither the call nor portfolio.json names one
SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,99}$")
SESSION_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
MODEL = re.compile(r"^[a-z0-9][a-z0-9._\[\]-]{0,63}$")
ORG_ALIASES = {"org", "chief-of-staff", "chief", "cos"}
FRONT_DOOR_ALIASES = {"roo", "pulse", "org", "front-door"}
# Internal fields a run can carry (pulse.py sets them; never from the command line):
#   parent_run  the front-door run that handed this one off    group  its hand-off group
#   trigger     report | brief | followup                      report_for  the run a report answers
#   source      pulse | voice | schedule                       display  the owner-side line to show
EXTRA_RUN_IDS = ("parent_run", "report_for")
EXTRA_SLUGS = ("group", "trigger", "source")
# Variables that would bill an API key or route to another provider instead of the
# subscription the claude CLI is signed in with. Only stripped for Claude Code: opencode may
# need a provider key from the environment.
BILLING_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_BEDROCK_BASE_URL",
               "ANTHROPIC_VERTEX_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
               "CLAUDE_CODE_USE_FOUNDRY")
STOPPABLE = {"chat", "act", "nightly", "weekly", "check"}
AGENT_CLIS = ("claude", "codex", "opencode")


def guardrails():
    return (
        "You are talking with the owner through Roo (their dashboard). Answer them directly: short, "
        "plain sentences, lead with the answer. If they ask for work, do it now, end to end within the "
        "guardrails, and say what you did with links (PR, preview, draft, Outbox item, file). Hard limits: "
        "never send email or messages yourself (queue them in the Outbox with "
        f"`python3 {ORG}/bin/outbox_add.py`; the owner sends with one click); never submit a form for the "
        "owner; never pay or buy; never type passwords, card/bank numbers or government IDs; never delete "
        "data; merges into main and production deploys need the owner's yes. If a step needs one of "
        "those, do everything up to it, then say exactly what the owner must click. Read "
        f"{ORG}/OPERATING.md and your entity's BRIEF.md and status.json when you need context."
    )


class Invalid(ValueError):
    pass


class Stopped(Exception):
    pass


# --------------------------------------------------------------------------
# Validation: everything is checked against portfolio.json, nothing is trusted
# --------------------------------------------------------------------------

def registry():
    return json.loads((ORG / "portfolio.json").read_text())


def target_for(target):
    """(agent, entity id or None, model or None) for an entity id, a lead, or the chief of staff."""
    if not SLUG.match(target or ""):
        raise Invalid("bad target")
    reg = registry()
    fd = reg.get("front_door") or {}
    if target in FRONT_DOOR_ALIASES or (fd.get("lead") and target == fd.get("lead")):
        if SLUG.match(fd.get("lead") or ""):
            return fd["lead"], None, fd.get("model")
        if target != "org":
            raise Invalid("no front door in portfolio.json")
    if target in ORG_ALIASES or target == (reg.get("chief_of_staff") or {}).get("lead"):
        cos = reg.get("chief_of_staff") or {}
        if not SLUG.match(cos.get("lead") or ""):
            raise Invalid("no chief of staff in portfolio.json")
        return cos["lead"], None, cos.get("model")
    for e in reg.get("entities", []):
        if target in (e.get("id"), e.get("lead")):
            if not SLUG.match(e.get("lead") or ""):
                raise Invalid(f"{e.get('id')}: no lead in portfolio.json")
            return e["lead"], e["id"], e.get("model")
    raise Invalid(f"unknown entity or lead: {target}")


def clean_message(text):
    text = (text or "").replace("\r\n", "\n")
    text = "".join(ch for ch in text if ch in "\n\t" or ch.isprintable()).strip()
    if not text:
        raise Invalid("message is empty")
    if len(text) > MESSAGE_MAX:
        raise Invalid(f"message is longer than {MESSAGE_MAX} characters")
    return text


def check_session(session):
    if session is not None and not SESSION_ID.match(session):
        raise Invalid("bad session id")
    return session


def check_extra(extra):
    """The internal fields, checked like everything else: ids are run ids, the rest slugs."""
    out = {}
    for k, v in (extra or {}).items():
        if v is None:
            continue
        if k in EXTRA_RUN_IDS and isinstance(v, str) and livemod.RUN_ID.match(v):
            out[k] = v
        elif k in EXTRA_SLUGS and isinstance(v, str) and SLUG.match(v):
            out[k] = v
        elif k == "display" and isinstance(v, str):
            out[k] = clip(" ".join(v.split()), 400)
        else:
            raise Invalid(f"bad {k}")
    return out


def front_door():
    """The front door's agent name, or None when portfolio.json has none."""
    lead = (registry().get("front_door") or {}).get("lead")
    return lead if SLUG.match(lead or "") else None


def check_model(model):
    if model is not None and not MODEL.match(model):
        raise Invalid("bad model")
    return model


def child_env(base=None, claude=True):
    """The agent CLI's environment: the owner's, on a PATH that finds the CLIs launchd and Roo
    don't put on it. For Claude Code, minus anything that switches billing."""
    src = base if base is not None else os.environ
    env = {k: v for k, v in src.items() if not (claude and k in BILLING_ENV)}
    env["PATH"] = ":".join(runners.EXTRA_PATH + [src.get("PATH") or "/usr/bin:/bin"])
    if claude:
        # Headless claude -p otherwise starts before the claude.ai connectors are up.
        env.setdefault("MCP_CONNECTION_NONBLOCKING", "false")
    return env


# --------------------------------------------------------------------------
# Sessions: the latest conversation per lead (Claude Code)
# --------------------------------------------------------------------------

@contextlib.contextmanager
def locked(name):
    locks = ORG / ".cache" / "locks"
    locks.mkdir(parents=True, exist_ok=True)
    with open(locks / f"{name}.lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        yield


def read_sessions():
    try:
        d = json.loads(SESSIONS.read_text())
        return d if isinstance(d, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def latest_session(agent):
    s = read_sessions().get(agent)
    sid = s.get("session_id") if isinstance(s, dict) else None
    return sid if isinstance(sid, str) and SESSION_ID.match(sid) else None


def remember_session(agent, session_id, run_id):
    with locked("chat_sessions"):
        d = read_sessions()
        d[agent] = {"session_id": session_id, "run_id": run_id, "at": now_iso()}
        write_json_atomic(SESSIONS, d)


# --------------------------------------------------------------------------
# The runner: which CLI, and its command for one chat turn
# --------------------------------------------------------------------------

def adapter_for(entity, reg=None):
    reg = registry() if reg is None else reg
    return runners.get(runners.resolve(reg, entity))


def binary_for(adapter):
    if adapter.name == "claude-code":
        return CLAUDE or BINARIES.get(adapter.name) or adapter.find() or str(HOME / ".local" / "bin" / "claude")
    return BINARIES.get(adapter.name) or adapter.find()


def model_for(adapter, model):
    """Claude Code takes the call's or portfolio.json's model (aliases like sonnet/opus); the
    other runners use their own configured model, since those names belong to Claude."""
    if adapter.name == "claude-code":
        return model or adapter.model(CHAT_MODEL)
    return adapter.model(CHAT_MODEL)


def flag_safe(text):
    """A prompt argument that can't be read as a flag."""
    return " " + text if text.startswith("-") else text


def run_cmd(agent, entity, model, resume, message="", reg=None):
    """(adapter, binary, cmd, stdin text or None, cwd, extra env) for one chat turn."""
    reg = registry() if reg is None else reg
    adapter = adapter_for(entity, reg)
    binary = binary_for(adapter)
    dirs = runners.work_dirs(reg, entity)
    model = model_for(adapter, model)
    if adapter.name == "claude-code":
        # Built by the adapter (the fenced reads, the allow and deny lists), with the prompt
        # moved to stdin and the chat's own options in front of --allowedTools, which takes
        # every argument after it.
        sentinel = "\x00prompt\x00"
        cmd = adapter.command(binary, agent, sentinel, model, MAX_TURNS, dirs)
        cmd.remove(sentinel)
        at = cmd.index("--allowedTools") if "--allowedTools" in cmd else len(cmd)
        own = ["--append-system-prompt", guardrails()] + (["--resume", resume] if resume else [])
        cmd[at:at] = own
        return adapter, binary, cmd, message, adapter.cwd(dirs), {}
    prompt = flag_safe(f"(Chat from Roo. {guardrails()})\n\n{message}" + adapter.solo_note())
    cmd = adapter.command(binary or adapter.binary, agent, prompt, model, MAX_TURNS, dirs)
    return adapter, binary, cmd, None, adapter.cwd(dirs), adapter.env(agent, dirs)


# --------------------------------------------------------------------------
# Foreground: validate, launch, answer at once
# --------------------------------------------------------------------------

def run_lock(agent):
    return LOGS / f".ask-{agent}.run.lock"


def busy(agent):
    """True while a worker holds this lead's chat lock."""
    lk = run_lock(agent)
    if not lk.exists():
        return False
    with open(lk, "a") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(f, fcntl.LOCK_UN)
    return False


def ask(target, message, session=None, new=False, model=None, dry_run=False, extra=None):
    if session and new:
        raise Invalid("--session and --new can't be used together")
    agent, entity, reg_model = target_for(target)
    message = clean_message(message)
    check_session(session)
    model = check_model(model) or check_model(reg_model)
    extra = check_extra(extra)
    run_id = new_run_id(agent)
    spec = {"run_id": run_id, "agent": agent, "entity": entity, "message": message,
            "session": session, "new": bool(new), "model": model, "extra": extra}
    queued = busy(agent)
    if dry_run:
        adapter = adapter_for(entity)
        resume = None if new or adapter.name != "claude-code" else (session or latest_session(agent))
        _, binary, cmd, _, cwd, _ = run_cmd(agent, entity, model, resume, message)
        return {"ok": True, "dry_run": True, "run_id": run_id, "agent": agent, "entity": entity, "queued": queued,
                "runner": adapter.name, "installed": bool(binary and os.path.exists(binary)),
                "resume": resume, "cwd": cwd, "command": cmd}
    launch_worker(spec)
    return {"ok": True, "run_id": run_id, "agent": agent, "entity": entity, "queued": queued}


def launch_worker(spec):
    """The worker reads its job from a private temp file, so the message is never on a command line."""
    LOGS.mkdir(parents=True, exist_ok=True)
    jobs = ORG / ".cache" / "ask"
    jobs.mkdir(parents=True, exist_ok=True)
    fd, path = tempfile.mkstemp(prefix=f"{spec['run_id']}-", suffix=".json", dir=jobs)
    with os.fdopen(fd, "w") as f:
        json.dump(spec, f)
    subprocess.Popen([sys.executable, str(pathlib.Path(__file__).resolve()), "--worker", path],
                     cwd=str(HOME), start_new_session=True, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=child_env(claude=False))


# --------------------------------------------------------------------------
# Background: one chat run
# --------------------------------------------------------------------------

class ChatRun(LiveRun):
    """A LiveRun that keeps the session id the stream reports, and the internal fields
    (parent_run, group, trigger...) in its live file and start line."""
    session_id = None
    extra = {}

    def start_line(self):
        return {**super().start_line(), **{k: v for k, v in self.extra.items() if k != "display"}}

    def saw(self, ev):
        sid = ev.get("session_id") if isinstance(ev, dict) else None
        if isinstance(sid, str) and SESSION_ID.match(sid) and sid != self.session_id:
            self.session_id = sid
            self.set(session_id=sid)


def stop_marker(run_id):
    return LIVE / f".stop-{run_id}"


def stream(cmd, stdin_text, env, live, session, cwd, timeout=TIMEOUT):
    """Runs the agent CLI, feeding each JSON line through its runner's translator into `live`.
    Returns the stderr tail."""
    with tempfile.TemporaryFile(mode="w+") as err:
        p = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.PIPE if stdin_text is not None else subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=err, text=True, bufsize=1, start_new_session=True)
        live.set(child_pid=p.pid)
        timer = threading.Timer(timeout, lambda: kill_group(p.pid))
        timer.start()
        try:
            if stdin_text is not None:
                with contextlib.suppress(BrokenPipeError):
                    p.stdin.write(stdin_text)
                    p.stdin.close()
            for line in p.stdout:
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(ev, dict):
                    continue
                try:
                    live.saw(ev)
                    live.add(session.feed(ev))
                except Exception as e:
                    live.note_error(e, ev)
            p.wait()
        finally:
            timer.cancel()
            if p.poll() is None:
                kill_group(p.pid)
                p.wait()
            p.stdout.close()
        err.seek(0)
        return redact(err.read()[-800:]), p.returncode


def kill_group(pgid, grace=2.0):
    with contextlib.suppress(OSError):
        os.killpg(pgid, signal.SIGTERM)
    end = time.time() + grace
    while time.time() < end:
        try:
            os.killpg(pgid, 0)
        except OSError:
            return
        time.sleep(0.1)
    with contextlib.suppress(OSError):
        os.killpg(pgid, signal.SIGKILL)


def no_session(stderr, summary):
    text = (stderr or "") + " " + ((summary or {}).get("result") or "")
    return bool(re.search(r"no conversation found|session.*not found|could not (find|resume)", text, re.I))


def one_turn(agent, entity, model, resume, message, live):
    """Runs one turn on the entity's runner. Returns (summary or None, stderr tail, adapter)."""
    reg = registry()
    adapter, binary, cmd, stdin_text, cwd, extra_env = run_cmd(agent, entity, model, resume, message, reg)
    if not binary or not os.path.exists(binary):
        raise RuntimeError(f"{adapter.label} is not installed. {adapter.install_hint}")
    notes = [{"t": "tool", "at": now_iso(), "name": "Write", "summary": f"Installed agent file {short_path(p)}"}
             for p in adapter.ensure_agents([agent])]
    notes += [{"t": "error", "at": now_iso(), "text": w} for w in adapter.warnings()]
    if notes:
        live.add(notes)
    if adapter.name != "claude-code":
        live.set(runner=adapter.name)
    env = child_env(claude=adapter.name == "claude-code")
    env.update(extra_env)
    env["PORTFOLIO_RUN_ID"] = live.run_id      # session_hook.py leaves runner sessions alone
    session = adapter.session()
    err, code = stream(cmd, stdin_text, env, live, session, cwd)
    return session.summary(code), err, adapter


def worker(spec_path):
    spec_path = pathlib.Path(spec_path)
    spec = json.loads(spec_path.read_text())
    spec_path.unlink(missing_ok=True)
    agent, entity, message, run_id = spec["agent"], spec["entity"], spec["message"], spec["run_id"]
    if not livemod.RUN_ID.match(run_id) or not SLUG.match(agent):
        raise Invalid("bad job")

    def on_term(*_):
        raise Stopped()
    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, on_term)

    extra = check_extra(spec.get("extra"))
    shown = extra.get("display") or message
    doing = clip(" ".join(shown.split()), 120)
    live = ChatRun(KIND, agent, entity=entity, doing=doing, prompt=message, run_id=run_id)
    live.extra = extra
    live.state.update({k: v for k, v in extra.items() if k != "display"})
    queued = busy(agent)
    live.open(state="queued" if queued else "running",
              step="Queued: waiting for the current reply" if queued else "Starting")
    if extra.get("trigger") == "report":
        # The leads' results, as Roo reads them; the owner sees one folded line.
        live.append([{"t": "report", "at": now_iso(), "text": redact(clip(shown, 400)), "detail": redact(clip(message))}])
    else:
        live.append([{"t": "user", "at": now_iso(), "text": redact(clip(shown))}])
    t0 = time.time()
    try:
        with open(run_lock(agent), "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            if stop_marker(run_id).exists():
                raise Stopped()
            claude = adapter_for(entity).name == "claude-code"
            # Resolved now, not at launch: a queued message continues the reply it waited for.
            resume = None if spec.get("new") or not claude else (spec.get("session") or latest_session(agent))
            live.set(state="running", step="Starting", resumed=resume)
            summary, err, adapter = one_turn(agent, entity, spec.get("model"), resume, message, live)
            if resume and not live.session_id and no_session(err, summary) and not stop_marker(run_id).exists():
                live.append([{"t": "error", "at": now_iso(), "text": "Couldn't continue the last conversation; started a new one."}])
                live.set(resumed=None)
                summary, err, adapter = one_turn(agent, entity, spec.get("model"), None, message, live)
            if stop_marker(run_id).exists():
                raise Stopped()
            if live.session_id and claude:
                remember_session(agent, live.session_id, run_id)
        secs = int(time.time() - t0)
        if summary is None:
            live.finish(False, err or f"no answer from {adapter.label}", secs=secs, append_result=True)
        else:
            result = redact((summary.get("result") or "")[-1500:])
            if not summary["ok"] and not result:
                result = err or f"{adapter.label} stopped without an answer"
            native = bool(summary.get("native_result")) or adapter.name == "claude-code"
            live.finish(summary["ok"], result, summary.get("cost_usd"), secs, append_result=not native,
                        tokens=summary.get("tokens"),
                        extra=None if adapter.name == "claude-code" else {"runner": adapter.name})
    except Stopped:
        if live.session_id:
            remember_session(agent, live.session_id, run_id)
        live.finish(False, "Stopped by you", secs=int(time.time() - t0), append_result=True)
    except BaseException as ex:
        live.finish(False, redact(f"{type(ex).__name__}: {ex}"), secs=int(time.time() - t0), append_result=True)
        if not isinstance(ex, Exception):
            raise
    finally:
        stop_marker(run_id).unlink(missing_ok=True)
        if extra.get("group"):
            # A hand-off from the front door: the last one to finish reports back to it.
            try:
                import pulse
                pulse.child_finished(run_id)
            except Exception as e:
                live.note_error(e)


# --------------------------------------------------------------------------
# Stop
# --------------------------------------------------------------------------

def proc_command(pid):
    try:
        out = subprocess.run(["ps", "-o", "pgid=,command=", "-p", str(int(pid))], capture_output=True, text=True, timeout=5)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None, ""
    parts = out.stdout.strip().split(None, 1)
    if not parts or not parts[0].isdigit():
        return None, ""
    return int(parts[0]), parts[1] if len(parts) > 1 else ""


def stop(run_id):
    if not livemod.RUN_ID.match(run_id or ""):
        raise Invalid("bad run id")
    try:
        state = json.loads((LIVE / f"{run_id}.json").read_text())
    except (OSError, json.JSONDecodeError):
        raise Invalid("no such run")
    if state.get("kind") not in STOPPABLE:
        raise Invalid("only headless runs can be stopped here")
    if state.get("state") not in ("running", "queued"):
        return {"ok": True, "stopped": False, "reason": f"already {state.get('state')}"}
    stop_marker(run_id).touch()
    child, worker_pid = state.get("child_pid"), state.get("pid")
    # Only a process that is still its own group's leader and is an agent CLI: never a reused pid.
    pgid, cmd = proc_command(child) if child else (None, "")
    if child and pgid == int(child) and any(c in cmd for c in AGENT_CLIS):
        kill_group(int(child))
        return {"ok": True, "stopped": True}
    if state.get("kind") == KIND and worker_pid and livemod.pid_alive(worker_pid):
        _, wcmd = proc_command(worker_pid)
        if "ask.py" in wcmd and "--worker" in wcmd:
            os.kill(int(worker_pid), signal.SIGTERM)       # queued: the worker ends as "Stopped by you"
            return {"ok": True, "stopped": True}
    return {"ok": True, "stopped": False, "reason": "its process is already gone"}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", nargs="?")
    ap.add_argument("--message", default=None)
    ap.add_argument("--session", default=None)
    ap.add_argument("--new", action="store_true")
    ap.add_argument("--model", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--stop", metavar="RUN_ID", default=None)
    ap.add_argument("--worker", metavar="JOB", default=None, help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    try:
        if a.worker:
            worker(a.worker)
            return 0
        if a.stop:
            res = stop(a.stop)
        else:
            if not a.target or a.message is None:
                raise Invalid("usage: ask.py <entity|lead> --message \"...\"")
            res = ask(a.target, a.message, a.session, a.new, a.model, a.dry_run)
    except Invalid as ex:
        print(json.dumps({"ok": False, "error": str(ex)}))
        return 2
    except (OSError, json.JSONDecodeError) as ex:
        print(json.dumps({"ok": False, "error": f"{ORG}/portfolio.json: {type(ex).__name__}"}))
        return 2
    print(json.dumps(res, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
