#!/usr/bin/env python3
"""Carry out the owner's answer to a decision from Pulse.

    act.py <entity_id> <decision_id> approve|reject|discuss [--note "..."] [--dry-run]
    act.py --record <entity_id> <decision_id> done|reply --note "..."     (leads)

1. Validates the entity against portfolio.json and the decision against that
   entity's current status.json (by `id`, or for older reports a slug of `ask`).
2. Appends {"id","action","note","at"} to <entity path>/decisions.jsonl under a lock.
3. Starts a background worker that runs the entity's lead headlessly
   (`claude -p --agent <lead>`, nightly.py's allow/deny lists, sonnet, 40 turns)
   to act on it now, writes logs/act-<ts>-<entity>.json, and for approvals
   closes the matching "Decide: ..." task in the optional tracker (skipped when
   there is no tracker; see TRACKER below). While it runs, nightly.run keeps
   logs/live/<run_id>.json current and streams logs/transcripts/<run_id>.jsonl (live.py).

Prints one JSON line and returns at once; the lead run happens in the background.

Safe to repeat: approve or reject on an id that is already done or rejected does
nothing, and a second approve while the first is pending appends nothing (it only
relaunches the lead if no run for that entity is in progress).

--record is how a lead reports back (done | reply). It only appends, never launches.
--dry-run validates and prints what would be appended and run, and writes nothing.
PORTFOLIO_ROOT overrides the org folder (default: the parent of this bin/).
PULSE_TRACKER_DIR points at an optional task tracker with todos.json and add_todo.py
(default ~/project-tracker); without one, gate items live only in status.json and Pulse.
"""
import argparse, contextlib, datetime, fcntl, json, os, pathlib, re, subprocess, sys, time

HOME = pathlib.Path.home()
ORG = pathlib.Path(os.environ.get("PORTFOLIO_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
LOGS = ORG / "logs"
TRACKER = pathlib.Path(os.environ.get("PULSE_TRACKER_DIR") or HOME / "project-tracker")

ACTIONS = {"approve", "reject", "discuss"}       # the owner, from Pulse
LEAD_ACTIONS = {"done", "reply"}                 # the lead, via --record
SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,99}$")
NOTE_MAX = 2000
MODEL, MAX_TURNS, TIMEOUT = "sonnet", 40, 1500


class Invalid(ValueError):
    pass


def slug(text):
    """Fallback id for decisions written before ids existed. Pulse derives the same."""
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:60].rstrip("-")


def decision_id(d):
    return d.get("id") or slug(d.get("ask"))


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def clean_note(note):
    note = (note or "").replace("\r\n", "\n")
    note = "".join(ch for ch in note if ch in "\n\t" or ch.isprintable()).strip()
    if len(note) > NOTE_MAX:
        raise Invalid(f"note is longer than {NOTE_MAX} characters")
    return note


# --------------------------------------------------------------------------
# Lookups: everything is checked against the files, nothing is trusted
# --------------------------------------------------------------------------

def entity_for(entity_id):
    if not SLUG.match(entity_id or ""):
        raise Invalid("bad entity id")
    reg = json.loads((ORG / "portfolio.json").read_text())
    for e in reg.get("entities", []):
        if e.get("id") == entity_id:
            path = pathlib.Path(e.get("path") or "")
            if path.is_absolute() or ".." in path.parts or not e.get("lead"):
                raise Invalid(f"{entity_id}: bad path or no lead in portfolio.json")
            return e
    raise Invalid(f"unknown entity: {entity_id}")


def entity_dir(e):
    d = (ORG / e["path"]).resolve()
    if not d.is_relative_to(ORG.resolve()) or not d.is_dir():
        raise Invalid(f"{e['id']}: folder missing")
    return d


def current_decision(e, did):
    if not SLUG.match(did or ""):
        raise Invalid("bad decision id")
    try:
        status = json.loads((entity_dir(e) / "status.json").read_text())
    except (OSError, json.JSONDecodeError) as ex:
        raise Invalid(f"{e['id']}: status.json unreadable ({type(ex).__name__})")
    for d in status.get("decisions") or []:
        if isinstance(d, dict) and decision_id(d) == did:
            return d
    raise Invalid(f"{e['id']} has no open decision {did}")


@contextlib.contextmanager
def locked(path):
    """Exclusive lock for one decisions.jsonl. Lock files live in .cache/, not the entity folder."""
    locks = ORG / ".cache" / "locks"
    locks.mkdir(parents=True, exist_ok=True)
    name = str(path.resolve().relative_to(ORG.resolve())).replace("/", "__")
    with open(locks / f"{name}.lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        yield


def read_log(path):
    out = []
    if path.exists():
        for line in path.read_text().splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                out.append(row)
    return out


def state_of(rows, did):
    """approve | reject | done | None: where this id stands. Discuss/reply don't move it."""
    state = None
    for r in rows:
        if r.get("id") != did:
            continue
        a = r.get("action")
        if a == "done":
            state = "done"
        elif a in ("approve", "reject") and state != "done":
            state = a
    return state


def run_in_progress(entity_id):
    """True while a worker holds this entity's run lock."""
    lk = LOGS / f".act-{entity_id}.run.lock"
    if not lk.exists():
        return False
    with open(lk, "a") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(f, fcntl.LOCK_UN)
    return False


# --------------------------------------------------------------------------
# The owner's answer
# --------------------------------------------------------------------------

def answer(entity_id, did, action, note="", dry_run=False):
    if action not in ACTIONS:
        raise Invalid(f"action must be one of {sorted(ACTIONS)}")
    note = clean_note(note)
    if action == "discuss" and not note:
        raise Invalid("discuss needs a note")
    e = entity_for(entity_id)
    log = entity_dir(e) / "decisions.jsonl"
    row = {"id": did, "action": action, "note": note, "at": now_iso()}

    with locked(log):
        rows = read_log(log)
        state = state_of(rows, did)
        if action != "discuss" and state in ("done", "reject"):
            return {"ok": True, "changed": False, "launched": False,
                    "reason": f"already {'done' if state == 'done' else 'rejected'}"}
        # Must still be an open decision (done/rejected ones are gone from status.json).
        d = current_decision(e, did)
        row.update(ask=d.get("ask"), recommend=d.get("recommend"))
        duplicate = action == "approve" and state == "approve"
        if dry_run:
            return {"ok": True, "dry_run": True, "would_append": None if duplicate else row,
                    "would_launch": worker_cmd(entity_id, did, action),
                    "would_close_task": tracker_match(e, d) if action == "approve" else None}
        if not duplicate:
            with log.open("a") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

    if duplicate and run_in_progress(entity_id):
        return {"ok": True, "changed": False, "launched": False, "reason": "already approved; the lead is running"}
    launch_worker(entity_id, did, action)
    return {"ok": True, "changed": not duplicate, "launched": True,
            "reason": "relaunched the lead" if duplicate else "recorded"}


def record(entity_id, did, action, note):
    """A lead reports back. Appends only."""
    if action not in LEAD_ACTIONS:
        raise Invalid(f"--record action must be one of {sorted(LEAD_ACTIONS)}")
    if not SLUG.match(did or ""):
        raise Invalid("bad decision id")
    note = clean_note(note)
    if not note:
        raise Invalid("--record needs a note")
    log = entity_dir(entity_for(entity_id)) / "decisions.jsonl"
    with locked(log):
        if action == "done" and state_of(read_log(log), did) == "done":
            return {"ok": True, "changed": False, "reason": "already done"}
        with log.open("a") as f:
            f.write(json.dumps({"id": did, "action": action, "note": note, "at": now_iso()},
                               ensure_ascii=False) + "\n")
    return {"ok": True, "changed": True}


# --------------------------------------------------------------------------
# Background: run the lead, log it, close the tracker task
# --------------------------------------------------------------------------

def worker_cmd(entity_id, did, action):
    return [sys.executable, str(pathlib.Path(__file__).resolve()), "--worker", entity_id, did, action]


def launch_worker(entity_id, did, action):
    LOGS.mkdir(exist_ok=True)
    subprocess.Popen(worker_cmd(entity_id, did, action), cwd=str(HOME), start_new_session=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     env=dict(os.environ))


def prompt_for(e, did, action, note):
    said = f' with this note: "{note}"' if note else ""
    reply = (f"python3 {ORG}/bin/act.py --record {e['id']} {did} "
             f"{'reply' if action == 'discuss' else 'done'} --note \"<...>\"")
    todo = {
        "approve": "Carry it out now (its on_approve line says what you promised), within the guardrails.",
        "reject": "Drop the decision from status.json and record why in BRIEF.md if a note was given. Don't re-ask it.",
        "discuss": "Answer the owner's note: short, with your recommendation. Don't carry the decision out yet.",
    }[action]
    return (
        f"DECISION run for {e['name']} ({e['path']}). It is {time.strftime('%A %Y-%m-%d %H:%M')}. "
        f"The owner just answered decision `{did}` in Pulse: {action.upper()}{said}.\n"
        f"Read {ORG}/OPERATING.md, {ORG}/STATUS_SCHEMA.md ('Decisions the owner acts on in Pulse'), "
        f"{ORG}/{e['path']}/BRIEF.md, status.json and decisions.jsonl. {todo}\n"
        "Hard limits, no exceptions: draft, never send (email goes to Gmail Drafts; no texts, DMs, invites, "
        "forms); never pay or buy; no merges to main/master/develop and no production deploys (open a PR or "
        "preview instead); never delete data. If carrying it out needs one of those, do every step up to it, "
        "then say exactly what the owner must click.\n"
        f"Report back with one line (it appends to decisions.jsonl under a lock; never edit that file by hand):\n"
        f"  {reply}\n"
        "with what you did and a link (PR, draft, file). Then update status.json per STATUS_SCHEMA.md "
        f"(remove a done or rejected decision, add what you did to `done`) and commit {ORG}: "
        f"git -C {ORG} add -A && git -C {ORG} commit -m \"{e['id']}: decision {did} {action}\". "
        "End with a 3-line summary."
    )


DECIDE_STOP = {"decide", "the", "a", "an", "and", "or", "to", "of", "for", "on", "in", "your", "with", "then", "what", "goes", "under"}


def _words(s):
    return {w for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if w not in DECIDE_STOP and len(w) > 1}


def has_tracker():
    return (TRACKER / "todos.json").is_file() and (TRACKER / "add_todo.py").is_file()


def tracker_match(e, d):
    """The open "Decide: ..." task for this decision, if one clearly matches. Title or None.
    None when there is no tracker."""
    try:
        todos = json.loads((TRACKER / "todos.json").read_text()).get("todos", [])
    except (OSError, json.JSONDecodeError):
        return None
    ask = _words(d.get("ask"))
    if not ask:
        return None
    projects = set(e.get("tracker_projects") or [])
    best, best_score = None, 0.0
    for t in todos:
        title = t.get("title") or ""
        if t.get("done") or not title.lower().startswith("decide") or (projects and t.get("project") not in projects):
            continue
        tw = _words(title)
        if not tw:
            continue
        score = len(ask & tw) / min(len(ask), len(tw))
        if score > best_score:
            best, best_score = title, score
    return best if best_score >= 0.6 else None


def close_tracker_task(title):
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    try:
        p = subprocess.run([sys.executable, str(TRACKER / "add_todo.py"), "--title", title,
                            "--done-when", json.dumps({"date_passed": yesterday})],
                           capture_output=True, text=True, timeout=90)
        return (p.stdout or p.stderr).strip()[-300:]
    except Exception as ex:
        return f"{type(ex).__name__}: {ex}"


def worker(entity_id, did, action):
    e = entity_for(entity_id)
    log = entity_dir(e) / "decisions.jsonl"
    rows = [r for r in read_log(log) if r.get("id") == did and r.get("action") == action]
    note = rows[-1].get("note", "") if rows else ""
    ask = (rows[-1].get("ask") if rows else None) or did
    stamp = time.strftime("%Y-%m-%d_%H%M%S")
    out = LOGS / f"act-{stamp}-{entity_id}.json"
    base = {"kind": "act", "entity": entity_id, "decision": did, "action": action,
            "agent": e["lead"], "started": now_iso()}
    out.write_text(json.dumps({**base, "running": True}, indent=2))

    # Whatever happens below, the log ends with running: false, so Pulse never shows
    # a run that died as still working.
    res, tracker = {"agent": e["lead"], "ok": False, "result": "the worker stopped before the lead ran"}, None
    try:
        if action == "approve" and not has_tracker():
            tracker = {"title": None, "result": "skipped: no tracker"}
        elif action == "approve":
            try:
                title = tracker_match(e, current_decision(e, did))
            except Invalid:
                title = None
            tracker = {"title": title, "result": close_tracker_task(title) if title else "no matching Decide: task"}

        # One lead run per entity at a time; a second answer waits its turn.
        with open(LOGS / f".act-{entity_id}.run.lock", "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
            from nightly import run  # noqa: E402  (same CLI flags and allow/deny lists as the night shift)
            res = run(e["lead"], prompt_for(e, did, action, note), MODEL, max_turns=MAX_TURNS, timeout=TIMEOUT,
                      kind="act", entity=entity_id, doing=f"{action.capitalize()}: {ask}")
    except Exception as ex:
        res = {**res, "result": f"{type(ex).__name__}: {ex}"}
        raise
    finally:
        out.write_text(json.dumps({**base, **res, "running": False, "finished": now_iso(), "tracker": tracker}, indent=2))


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entity")
    ap.add_argument("decision")
    ap.add_argument("action")
    ap.add_argument("--note", default="")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    try:
        if a.worker:
            worker(a.entity, a.decision, a.action)
            return 0
        res = record(a.entity, a.decision, a.action, a.note) if a.record else \
            answer(a.entity, a.decision, a.action, a.note, a.dry_run)
    except Invalid as ex:
        print(json.dumps({"ok": False, "error": str(ex)}))
        return 2
    print(json.dumps(res, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
