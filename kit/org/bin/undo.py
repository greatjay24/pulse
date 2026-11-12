#!/usr/bin/env python3
"""Reverse something an agent did on its own (a row in watch/autonomous.jsonl).

    undo.py <action id> [--dry-run]
    undo.py --list [--date YYYY-MM-DD]

By the row's undo kind:
  outbox     skips the Outbox item if it's still pending (outbox.py skip). Sent mail can't be unsent.
  pr         an open PR is closed with a comment (the branch stays). A merged PR gets a revert PR
             (gh pr revert), which is opened, never merged here.
  calendar   removes the calendar hold the agent created: a scoped claude call that may only read
             and delete that one event, and only if its title starts with "Hold:".
  invite     an invite the watcher auto-accepted: sets the owner's answer back to Maybe (tentative),
             with no email to anyone. A scoped claude call that may only call respond_to_event.
  run        stops a lead run that is still working (ask.py --stop).
  followup   drops the follow-up (status dropped).
  none       nothing safe to reverse automatically; says so.
It never deletes owner data, mail, drafts or branches. Each undo appends a row
{"type": "undo", "ref": <action id>, "ok", "result"} to autonomous.jsonl. Prints one JSON line.
calendar and invite need Claude Code signed in with a Google Calendar connector; without one
they say so and change nothing. PULSE_CLAUDE overrides the claude binary (tests only).
"""
import argparse, json, os, pathlib, shutil, subprocess, sys

BIN = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(BIN))
import watch_store as ws  # noqa: E402

HOME = pathlib.Path.home()
EXTRA_PATH = [str(HOME / ".local" / "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
CLAUDE = os.environ.get("PULSE_CLAUDE") or shutil.which("claude", path=":".join(EXTRA_PATH)) or str(HOME / ".local" / "bin" / "claude")
# Variables that would bill an API key instead of the claude CLI's own sign-in.
BILLING_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK",
               "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY")


class Refused(Exception):
    pass


def run_claude(cmd, prompt, timeout=180, extra_env=None):
    """One scoped `claude -p` call (its tools limited by cmd); the prompt goes in on stdin.
    Returns the reply text."""
    if not os.path.exists(cmd[0]):
        raise Refused("this needs Claude Code (claude) signed in with a Google Calendar connector")
    env = {k: v for k, v in os.environ.items() if k not in BILLING_ENV}
    env["PATH"] = ":".join(EXTRA_PATH)
    env.update(extra_env or {})
    p = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout, env=env, cwd=str(HOME))
    try:
        out = json.loads(p.stdout or "{}")
    except json.JSONDecodeError:
        raise Refused(f"claude said: {(p.stderr or p.stdout).strip()[-160:]}")
    if out.get("is_error"):
        raise Refused(f"claude: {str(out.get('result'))[:160]}")
    return out.get("result") or ""


def gh(args, timeout=60):
    env = dict(os.environ)
    env["PATH"] = ":".join(EXTRA_PATH)
    p = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=timeout, env=env)
    if p.returncode != 0:
        raise Refused(f"gh {args[0]} {args[1]}: {p.stderr.strip()[-200:]}")
    return p.stdout.strip()


def undo_outbox(ref, dry):
    import outbox
    item = outbox.load(ref)
    if item.get("status") != "pending":
        raise Refused(f"the Outbox item is {item.get('status')}; only a pending item can be skipped")
    if dry:
        return "would skip the Outbox item"
    outbox.skip(ref, "Undone by the owner (undo.py)")
    return "skipped the Outbox item (the Gmail draft stays in Drafts)"


def undo_pr(ref, dry):
    repo, _, num = ref.partition("#")
    st = json.loads(gh(["pr", "view", num, "-R", repo, "--json", "state,url"]))
    if st["state"] == "OPEN":
        if dry:
            return f"would close {st['url']}"
        gh(["pr", "close", num, "-R", repo, "--comment", "Closed by undo.py: the owner reversed this autonomous change."])
        return f"closed {st['url']} (branch kept)"
    if st["state"] == "MERGED":
        if dry:
            return f"would open a revert PR for {st['url']}"
        out = gh(["pr", "revert", num, "-R", repo, "--body",
                  "Reverts an autonomous change; the owner asked for it with undo.py."], timeout=120)
        return f"opened a revert PR: {out.splitlines()[-1] if out else st['url']} (not merged)"
    raise Refused(f"{st['url']} is {st['state'].lower()}; nothing to undo")


CAL_UNDO = """Remove one calendar hold that an agent created. Event id: {event}{cal}.
1. Get that event with the Google Calendar tools.
2. Only if its title starts with "Hold:" and I am its organizer, delete that one event.
3. Otherwise delete nothing.
Reply with ONLY one JSON object: {{"deleted": true|false, "title": "<event title>", "why": "<short>"}}"""


def undo_calendar(ref, dry):
    event, _, cal = ref.partition("@")
    if dry:
        return f"would delete calendar hold {event} if its title starts with 'Hold:'"
    cmd = [CLAUDE, "-p", "--model", "haiku", "--output-format", "json", "--max-turns", "4",
           "--no-session-persistence", "--tools", "",
           "--allowedTools", "mcp__claude_ai_Google_Calendar__get_event", "mcp__claude_ai_Google_Calendar__delete_event"]
    text = run_claude(cmd, CAL_UNDO.format(event=event, cal=f" on calendar {cal}" if cal else ""), timeout=180,
                      extra_env={"MCP_CONNECTION_NONBLOCKING": "false"})
    start, end = text.find("{"), text.rfind("}")
    try:
        res = json.loads(text[start:end + 1])
    except (ValueError, json.JSONDecodeError):
        raise Refused(f"couldn't confirm the delete: {text[:160]}")
    if not res.get("deleted"):
        raise Refused(f"not deleted: {res.get('why')} ({res.get('title')})")
    return f"removed the hold \"{res.get('title')}\""


INVITE_UNDO = """Change my answer to one calendar invitation. Event id: {event}. Calendar: {cal}.
Call respond_to_event with eventId "{event}", calendarId "{cal}", responseStatus "tentative",
notificationLevel "NONE". Do nothing else.
Reply with ONLY one JSON object: {{"changed": true|false, "why": "<short, only if false>"}}"""


def undo_invite(ref, dry):
    event, _, cal = ref.partition("@")
    cal = cal or "primary"
    if dry:
        return f"would set your answer to {event} back to Maybe (no email sent)"
    cmd = [CLAUDE, "-p", "--model", "haiku", "--output-format", "json", "--max-turns", "3",
           "--no-session-persistence", "--tools", "", "--allowedTools", "mcp__claude_ai_Google_Calendar__respond_to_event"]
    text = run_claude(cmd, INVITE_UNDO.format(event=event, cal=cal), timeout=180,
                      extra_env={"MCP_CONNECTION_NONBLOCKING": "false"})
    start, end = text.find("{"), text.rfind("}")
    try:
        res = json.loads(text[start:end + 1])
    except (ValueError, json.JSONDecodeError):
        raise Refused(f"couldn't confirm the change: {text[:160]}")
    if not res.get("changed"):
        raise Refused(f"not changed: {res.get('why')}")
    return "set your answer back to Maybe (no email sent)"


def undo_run(ref, dry):
    import ask
    if dry:
        return f"would stop run {ref} if it's still working"
    res = ask.stop(ref)
    return "stopped the run" if res.get("stopped") else f"nothing to stop: {res.get('reason')}"


def undo_followup(ref, dry):
    if ref not in ws.followups():
        raise Refused(f"no follow-up {ref}")
    if dry:
        return "would cancel the follow-up"
    ws.update_followup(ref, status="dropped", resolved_at=ws.iso(), how="undone by the owner")
    return "dropped the follow-up"


HANDLERS = {"outbox": undo_outbox, "pr": undo_pr, "calendar": undo_calendar, "invite": undo_invite, "run": undo_run, "followup": undo_followup}


def undo(action_id, dry=False):
    acts = {a["id"]: a for a in ws.actions()}
    a = acts.get(action_id)
    if not a:
        raise Refused(f"no action {action_id}")
    if a.get("undone"):
        raise Refused(f"already undone at {a['undone'].get('at')}")
    u = a.get("undo") or {}
    kind = u.get("kind")
    if kind not in HANDLERS:
        raise Refused("this action has nothing that can be reversed automatically")
    try:
        result, ok = HANDLERS[kind](u.get("ref"), dry), True
    except Exception as e:
        result, ok = f"{type(e).__name__}: {e}"[:300], False
    if not dry:
        ws.append("autonomous", {"id": ws.new_id("u"), "type": "undo", "ref": action_id, "at": ws.iso(),
                                 "ok": ok, "kind": kind, "result": result})
    return {"ok": ok, "id": action_id, "kind": kind, "dry_run": dry, "result": result}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("id", nargs="?")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--date", default=None)
    a = ap.parse_args(argv)
    if a.list:
        day = a.date or ws.now().date().isoformat()
        rows = [{"id": r["id"], "at": r["at"], "entity": r.get("entity"), "what": r.get("what"),
                 "undo": (r.get("undo") or {}).get("kind"), "undone": bool(r.get("undone"))}
                for r in ws.actions() if (r.get("at") or "").startswith(day)]
        print(json.dumps({"ok": True, "actions": rows}, ensure_ascii=False))
        return 0
    if not a.id:
        ap.error("give an action id (undo.py --list shows today's)")
    try:
        res = undo(a.id, a.dry_run)
    except Refused as e:
        print(json.dumps({"ok": False, "id": a.id, "error": str(e)}))
        return 2
    print(json.dumps(res, ensure_ascii=False))
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
