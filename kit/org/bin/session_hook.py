#!/usr/bin/env python3
"""Claude Code hook: registers the owner's interactive sessions with the org's agents in logs/live,
so Pulse shows `claude --agent acme-lead` the same way it shows a nightly run.

Wired in ~/.claude/settings.json for SessionStart, UserPromptSubmit, Stop, SessionEnd,
PreToolUse (matcher Agent|Task), SubagentStart and SubagentStop, all running
`python3 <org>/bin/session_hook.py` (setup.py prints the snippet). Reads the hook's JSON on stdin:

    SessionStart       live file in state idle (waiting for the owner), transcript start line
    UserPromptSubmit   state running, "doing" = the first line of what the owner asked
    Stop               state idle, transcript re-copied (redacted) from the session's own
    SessionEnd         state finished, transcript re-copied
    PreToolUse         (matcher Agent|Task) the lead deploys a subagent: added to the team
    SubagentStart      pairs the subagent's agent_id with that team entry
    SubagentStop       marks it completed, with its last message as the summary

Subagent events carry the subagent's own agent_type, so they are recorded only for a
session that is already registered.

Only sessions whose `agent_type` is one of the org's agents (portfolio.json leads, the
chief of staff, managers) are recorded. Sessions a runner started (nightly.py / act.py set
PORTFOLIO_RUN_ID) are skipped: the runner already writes their live file.

Never prints (SessionStart and UserPromptSubmit stdout would land in the session's
context) and always exits 0, so a problem here can never block a session.
"""
import contextlib, fcntl, json, os, pathlib, subprocess, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import live  # noqa: E402
from live import AGENT_TOOLS, LiveRun, Normalizer, clip, first_line, redact, write_json_atomic  # noqa: E402

CLAUDE_PROJECTS = pathlib.Path.home() / ".claude" / "projects"
SESSION_MAX_BYTES = 40 * 1024 * 1024
SHELLS = {"sh", "bash", "zsh", "dash", "fish"}
SUBAGENT_EVENTS = {"PreToolUse", "SubagentStart", "SubagentStop"}


def org_agents():
    """{agent name: entity id or None} for every agent the org runs."""
    reg = json.loads((live.ORG / "portfolio.json").read_text())
    agents = {e["lead"]: e["id"] for e in reg.get("entities", []) if e.get("lead")}
    cos = (reg.get("chief_of_staff") or {}).get("lead")
    if cos:
        agents[cos] = None
    for m in reg.get("managers") or []:
        agents.setdefault(m, None)
    return agents


def session_pid(start=None):
    """The Claude Code process that ran this hook: the first ancestor that isn't a shell."""
    pid = start or os.getppid()
    for _ in range(4):
        try:
            out = subprocess.run(["ps", "-o", "ppid=,comm=", "-p", str(pid)],
                                 capture_output=True, text=True, timeout=2).stdout.strip()
        except Exception:
            return pid
        if not out:
            return pid
        ppid, comm = out.split(None, 1)
        if os.path.basename(comm.strip()).lstrip("-") not in SHELLS:
            return pid
        pid = int(ppid)
    return pid


def session_lines(transcript_path):
    """The session's transcript, normalized and redacted. Only reads under ~/.claude/projects."""
    p = pathlib.Path(transcript_path or "").expanduser()
    try:
        p = p.resolve(strict=True)
    except OSError:
        return []
    if not p.is_relative_to(CLAUDE_PROJECTS.resolve()) or p.suffix != ".jsonl" or not p.is_file():
        return []
    with p.open("rb") as f:
        size = p.stat().st_size
        if size > SESSION_MAX_BYTES:
            f.seek(size - SESSION_MAX_BYTES)
            f.readline()                      # drop the partial first line
        raw = f.read().decode("utf-8", "replace")
    out, norm = [], Normalizer()
    for line in raw.splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(ev, dict):
            out.extend(norm.feed(ev))
    return out


def copy_transcript(run, transcript_path):
    """Rewrites logs/transcripts/<run_id>.jsonl from the session: start line + every turn."""
    lines = [run.start_line()] + session_lines(transcript_path)
    tmp = run.transcript.with_name(f".{run.transcript.name}.{os.getpid()}.tmp")
    run.transcript.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in lines))
    os.replace(tmp, run.transcript)
    return lines


@contextlib.contextmanager
def session_lock(run_id):
    """Hook calls for one session can overlap (parallel subagents); one at a time."""
    locks = live.ORG / ".cache" / "locks"
    locks.mkdir(parents=True, exist_ok=True)
    with open(locks / f"{run_id}.lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        yield


def team_event(run, event, hook):
    team = run.team()
    if event == "PreToolUse":
        if hook.get("tool_name") not in AGENT_TOOLS:
            return
        inp = hook.get("tool_input") if isinstance(hook.get("tool_input"), dict) else {}
        member = {"id": hook.get("tool_use_id") or f"agent-{len(team)}", "type": inp.get("subagent_type") or "agent",
                  "description": clip(inp.get("description") or "", 120), "prompt": first_line(inp.get("prompt")),
                  "background": bool(inp.get("run_in_background")), "by": hook.get("agent_id")}
        run.deploy([member])
        run.step(live.deploy_label([m for m in run.team() if m["batch"] == run.team()[-1]["batch"]]))
    elif event == "SubagentStart":
        aid, kind = hook.get("agent_id"), hook.get("agent_type")
        waiting = [m for m in team if not m.get("agent_id") and m.get("status") == "running"]
        match = next((m for m in waiting if m.get("type") == kind), waiting[0] if waiting else None)
        if match:
            match["agent_id"] = aid
            run._write()
        else:   # deployed without a PreToolUse record (hook not wired for it)
            run.deploy([{"id": aid, "agent_id": aid, "type": kind or "agent", "description": "", "prompt": "",
                         "background": False, "by": None}])
    elif event == "SubagentStop":
        aid = hook.get("agent_id")
        for m in team:
            if m.get("agent_id") == aid:
                run.agent_done(m["id"], "completed", hook.get("last_assistant_message"))
                break


def handle(hook, env=os.environ):
    if env.get("PORTFOLIO_RUN_ID"):
        return None
    sid = (hook.get("session_id") or "").lower()
    run_id = f"session-{sid}"
    if not live.RUN_ID.match(run_id):
        return None
    with session_lock(run_id):
        return _handle(hook, run_id)


def _handle(hook, run_id):
    event = hook.get("hook_event_name")
    path = live.LIVE / f"{run_id}.json"
    if event in SUBAGENT_EVENTS:
        if not path.exists():
            return None
        run = LiveRun.load(run_id)
        team_event(run, event, hook)
        return run.state

    agent = hook.get("agent_type") or ""
    agents = org_agents()
    if agent not in agents:
        return None

    if event == "SessionStart" or not path.exists():
        run = LiveRun("interactive", agent, entity=agents[agent], doing="Session with the owner",
                      run_id=run_id, pid=session_pid())
        run.state["cwd"] = hook.get("cwd")
        run.open(state="idle", step="Waiting for you")
        if event == "SessionStart":
            copy_transcript(run, hook.get("transcript_path"))   # a resumed session has history
            return run.state
    else:
        run = LiveRun.load(run_id)

    if event == "UserPromptSubmit":
        first = next((l for l in (hook.get("prompt") or "").splitlines() if l.strip()), "")
        run.set(state="running", doing=clip(first.strip(), 160) or "Session with the owner",
                step="Reading your message", step_at=live.now_iso())
    elif event == "Stop":
        lines = copy_transcript(run, hook.get("transcript_path"))
        said = hook.get("last_assistant_message") or next((x["text"] for x in reversed(lines) if x["t"] == "text"), "")
        run.set(state="idle", step="Waiting for you", step_at=live.now_iso(),
                last=redact(clip(" ".join(said.split()), 300)))
    elif event == "SessionEnd":
        copy_transcript(run, hook.get("transcript_path"))
        run.state.pop("last", None)
        run.finish(True, f"Session ended ({hook.get('reason') or 'exit'})")
    return run.state


def main():
    try:
        hook = json.loads(sys.stdin.read() or "{}")
        if isinstance(hook, dict):
            handle(hook)
    except Exception as ex:   # never block the owner's session; leave a trace for debugging
        try:
            write_json_atomic(live.LOGS / ".session_hook_error.json", {"at": live.now_iso(), "error": f"{type(ex).__name__}: {ex}"})
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
