#!/usr/bin/env python3
"""The front door's tools: Roo (agent `pulse`, portfolio.json "front_door") is the one assistant
the owner talks to, from the Roo app. It answers, or hands work to the leads through these
commands, and reports back in its own conversation.

    pulse.py status                                   what is running, hand-offs waiting, follow-ups due
    pulse.py delegate --to <entity|lead> --message "..." [--to ... --message ...] [--continue]
    pulse.py followup add --what "..." --who <owner|pulse|entity> --check-at <YYYY-MM-DD[THH:MM]> [--note "..."]
    pulse.py followup list [--due | --all]
    pulse.py followup set <id> --status open|done|dropped [--check-at ...] [--note "..."]
    pulse.py tick                                     one front-door run for follow-ups that are due
    pulse.py brief morning|evening [--wait] [--source schedule]
    pulse.py digest morning|evening                   the facts a brief is written from (no run)
    pulse.py wait <run_id> [--timeout 600]            waits for a run, prints its final reply

Hand-offs. `delegate` starts each lead as its own background chat run (ask.py), so a lead can
deploy its own team. The runs share a group (.cache/pulse/groups/<group>.json) and carry
parent_run, the front-door run that handed them off (PORTFOLIO_RUN_ID, which ask.py sets). Roo
nests them under that run. When the last one finishes, ask.py calls child_finished(), which starts
one more front-door run (trigger "report") with every lead's result, so the summary lands in the
same conversation as the request.

Follow-ups: <org>/followups.jsonl, one row per id, rewritten whole under the "followups" lock
(the same file and lock as watch_store.py):
    {"id","what","who","check_at","status":"open|done|dropped","created","created_by","run","note",
     "last_checked", optional "check" {...}, "links", "nudges", ...}
If an id appears more than once (an append-style writer), the last row wins.
Who checks: `tick` (run it on a schedule, e.g. every 30 minutes) takes every due row when
check_at has passed and it wasn't checked in the last CHECK_GAP_HOURS, and asks the front door to
check on them. If the org also runs a watcher (bin/watch.py), rows whose `who` is an entity or
its lead are left to it.

PORTFOLIO_ROOT overrides the org folder (default: the parent of this bin/).
"""
import argparse, datetime, json, os, pathlib, re, secrets, sys, time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ask  # noqa: E402
import live as livemod  # noqa: E402
from live import clip, now_iso, write_json_atomic  # noqa: E402

ORG = ask.ORG
GROUPS = ORG / ".cache" / "pulse" / "groups"
FOLLOWUPS = ORG / "followups.jsonl"
STATUSES = ("open", "done", "dropped")
CHECK_GAP_HOURS = 20
TICK_HOURS = (8, 21)            # tick only starts runs between 8:00 and 21:00
RESULT_MAX = 1500               # one lead's result in a report-back
DIGEST_MAX = 6500
FU_ID = re.compile(r"^fu-[a-z0-9]{4,40}$")
HANDOFF_NOTE = (
    "\n\n(Handed to you by Roo, the owner's front door. Do the work now, end to end, under "
    f"{ORG}/OPERATING.md. Finish with a short report: first line what happened, then links. "
    "Roo reads it back to the owner.)"
)
WATCHER = pathlib.Path(__file__).resolve().parent / "watch.py"   # optional; the kit doesn't ship one


class Invalid(ValueError):
    pass


def out(obj):
    print(json.dumps(obj, ensure_ascii=False))


def parse_when(s):
    """An aware datetime from YYYY-MM-DD (9:00 that day) or an ISO time."""
    s = (s or "").strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            d = datetime.datetime.fromisoformat(s + "T09:00")
        else:
            d = datetime.datetime.fromisoformat(s)
    except ValueError:
        raise Invalid(f"bad time: {s!r} (use YYYY-MM-DD or YYYY-MM-DDTHH:MM)")
    return d if d.tzinfo else d.astimezone()


def now():
    return datetime.datetime.now().astimezone()


def read_json(path, default=None):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except (OSError, json.JSONDecodeError):
        return default


def live_state(run_id):
    return read_json(livemod.LIVE / f"{run_id}.json", {}) if livemod.RUN_ID.match(run_id or "") else {}


def final_reply(run_id):
    """The run's closing reply: its transcript's result line (fuller than the live file's)."""
    try:
        lines = (livemod.TRANSCRIPTS / f"{run_id}.jsonl").read_text().splitlines()
    except OSError:
        return live_state(run_id).get("result") or ""
    for line in reversed(lines):
        try:
            x = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(x, dict) and x.get("t") == "result":
            return x.get("result") or ""
    return live_state(run_id).get("result") or ""


def original_request(run_id):
    """What the owner asked in a front-door run: its owner-side line, else its prompt."""
    try:
        lines = (livemod.TRANSCRIPTS / f"{run_id}.jsonl").read_text().splitlines()[:3]
    except OSError:
        return ""
    for line in lines:
        x = read_line(line)
        if x.get("t") == "user":
            return x.get("text") or ""
    return read_line(lines[0]).get("prompt", "") if lines else ""


def read_line(line):
    try:
        x = json.loads(line)
        return x if isinstance(x, dict) else {}
    except json.JSONDecodeError:
        return {}


# --------------------------------------------------------------------------
# Hand-offs
# --------------------------------------------------------------------------

def group_path(gid):
    if not ask.SLUG.match(gid or ""):
        raise Invalid("bad group")
    return GROUPS / f"{gid}.json"


def delegate(tasks, fresh=True, origin=None):
    """Starts one lead run per (target, message), as one group. Returns the group and runs."""
    if not tasks:
        raise Invalid("nothing to hand off: give --to and --message")
    door = ask.front_door()
    origin = origin or os.environ.get("PORTFOLIO_RUN_ID")
    origin = origin if origin and livemod.RUN_ID.match(origin) else None
    source = live_state(origin).get("source") if origin else None
    checked = []
    for target, message in tasks:
        agent, entity, _ = ask.target_for(target)
        if agent == door:
            raise Invalid("the front door can't hand work to itself")
        checked.append((target, agent, entity, ask.clean_message(message)))
    gid = f"{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}"
    runs = []
    with ask.locked(f"group-{gid}"):
        for target, agent, entity, message in checked:
            r = ask.ask(target, ask.clip(message + HANDOFF_NOTE, ask.MESSAGE_MAX), new=fresh,
                        extra={"parent_run": origin, "group": gid, "source": "pulse", "display": message})
            runs.append({"run_id": r["run_id"], "agent": r["agent"], "entity": r["entity"], "queued": r["queued"],
                         "status": "running"})
        write_json_atomic(group_path(gid), {
            "group": gid, "origin_run": origin, "source": source, "created": now_iso(),
            "request": clip(original_request(origin), 600) if origin else "",
            "children": runs, "reported": False, "report_run": None})
    return {"ok": True, "group": gid, "runs": runs,
            "next": "Tell the owner who is on it in one line and end your turn. Their reports come back to you here."}


def child_finished(run_id):
    """Called by ask.py when a hand-off run ends. The last one in its group starts the report."""
    st = live_state(run_id)
    gid = st.get("group")
    if not gid:
        return None
    with ask.locked(f"group-{gid}"):
        g = read_json(group_path(gid))
        if not isinstance(g, dict):
            return None
        for c in g.get("children", []):
            if c.get("run_id") == run_id:
                c.update(status="finished" if st.get("ok") else "failed", secs=st.get("secs"),
                         result=clip(final_reply(run_id), RESULT_MAX))
        pending = [c for c in g["children"] if c.get("status") == "running" and still_working(c["run_id"])]
        if pending or g.get("reported"):
            write_json_atomic(group_path(gid), g)
            return None
        g["reported"] = True
        write_json_atomic(group_path(gid), g)
    return report_back(g)


def still_working(run_id):
    """True until a run ends. A run whose worker hasn't written its live file yet is still to come;
    one whose process is gone has ended."""
    st = live_state(run_id)
    if not st:
        return True
    return st.get("state") in ("running", "queued", "idle") and livemod.pid_alive(st.get("pid"))


def report_message(g):
    lines = ["[Report-back] The leads you handed off to have finished."]
    if g.get("request"):
        lines.append(f"The owner asked: \"{g['request']}\"")
    for c in g.get("children", []):
        st = live_state(c["run_id"])
        state = c.get("status") if c.get("status") != "running" else (st.get("state") or "unknown")
        mins = f" in {round((c.get('secs') or 0) / 60)}m" if c.get("secs") else ""
        result = c.get("result") or clip(final_reply(c["run_id"]), RESULT_MAX) or "(no reply)"
        lines.append(f"\n- {c.get('agent')} ({c.get('entity') or 'org'}) {state}{mins}, run {c['run_id']}:\n{result}")
    lines.append(
        "\nReply to the owner in this conversation. First line: one plain sentence that sums it up "
        "(it is read aloud). Then up to 5 short lines with the links. If a lead promised something "
        "for later or is waiting on someone, add a follow-up with pulse.py followup add.")
    return "\n".join(lines)


def report_back(g):
    names = ", ".join(dict.fromkeys(c.get("agent") or "?" for c in g.get("children", [])))
    r = ask.ask("pulse", ask.clip(report_message(g), ask.MESSAGE_MAX),
                extra={"trigger": "report", "group": None, "report_for": g.get("origin_run"),
                       "source": g.get("source"), "display": f"Report back from {names}"})
    with ask.locked(f"group-{g['group']}"):
        cur = read_json(group_path(g["group"]), g)
        cur["report_run"] = r["run_id"]
        write_json_atomic(group_path(g["group"]), cur)
    return r


def open_groups():
    out_ = []
    for f in sorted(GROUPS.glob("*.json")) if GROUPS.is_dir() else []:
        g = read_json(f)
        if isinstance(g, dict) and not g.get("reported"):
            out_.append(g)
    return out_


# --------------------------------------------------------------------------
# Follow-ups
# --------------------------------------------------------------------------

def read_followups():
    """One row per id, in first-seen order; a later row for the same id replaces the earlier."""
    rows = {}
    try:
        for line in FOLLOWUPS.read_text().splitlines():
            x = read_line(line)
            if FU_ID.match(x.get("id") or ""):
                rows[x["id"]] = x
    except OSError:
        pass
    return list(rows.values())


def lead_owned(who, reg=None):
    """True when a watcher (bin/watch.py) checks this follow-up: the org runs one and its `who`
    is an entity id or a lead. Without a watcher, tick checks every follow-up."""
    if not WATCHER.exists():
        return False
    reg = reg or ask.registry()
    return any(who in (e.get("id"), e.get("lead")) for e in reg.get("entities", []) if who)


def write_followups(rows):
    FOLLOWUPS.parent.mkdir(parents=True, exist_ok=True)
    tmp = FOLLOWUPS.with_name(f".{FOLLOWUPS.name}.{os.getpid()}.tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    os.replace(tmp, FOLLOWUPS)


def followup_add(what, who, check_at, note=None, created_by="pulse"):
    what = " ".join((what or "").split())
    if not what:
        raise Invalid("say what to follow up on")
    if not ask.SLUG.match(who or ""):
        raise Invalid("who: owner, pulse, or an entity id")
    if not ask.SLUG.match(created_by or ""):
        raise Invalid("bad created_by")
    row = {"id": f"fu-{secrets.token_hex(4)}", "what": clip(what, 300), "who": who,
           "check_at": parse_when(check_at).isoformat(timespec="minutes"), "status": "open",
           "created": now_iso(), "run": os.environ.get("PORTFOLIO_RUN_ID") or None,
           "note": clip(note or "", 300) or None, "last_checked": None, "created_by": created_by, "links": []}
    with ask.locked("followups"):
        write_followups(read_followups() + [row])
    return row


def followup_set(fid, status=None, check_at=None, note=None):
    if not FU_ID.match(fid or ""):
        raise Invalid("bad follow-up id")
    if status and status not in STATUSES:
        raise Invalid(f"status: one of {', '.join(STATUSES)}")
    with ask.locked("followups"):
        rows = read_followups()
        hit = next((r for r in rows if r["id"] == fid), None)
        if not hit:
            raise Invalid(f"no follow-up {fid}")
        if status:
            hit["status"] = status
        if check_at:
            hit["check_at"] = parse_when(check_at).isoformat(timespec="minutes")
        if note:
            hit["note"] = clip(note, 300)
        hit["updated"] = now_iso()
        write_followups(rows)
    return hit


def is_due(r, at=None):
    at = at or now()
    try:
        return r.get("status") == "open" and parse_when(r["check_at"]) <= at
    except (Invalid, KeyError):
        return False


def tick(at=None):
    """Starts one front-door run for the follow-ups that are due, at most once per CHECK_GAP_HOURS each."""
    at = at or now()
    if not (TICK_HOURS[0] <= at.hour < TICK_HOURS[1]):
        return {"ok": True, "started": False, "reason": "outside working hours"}
    reg = ask.registry()
    with ask.locked("followups"):
        rows = read_followups()
        due = []
        for r in rows:
            if lead_owned(r.get("who"), reg):
                continue                    # the watcher checks, nudges and escalates these
            last = r.get("last_checked")
            fresh = last and (at - parse_when(last)).total_seconds() < CHECK_GAP_HOURS * 3600
            if is_due(r, at) and not fresh:
                due.append(r)
        if not due:
            return {"ok": True, "started": False, "reason": "nothing due"}
        for r in due:
            r["last_checked"] = at.isoformat(timespec="minutes")
        write_followups(rows)
    lines = ["[Follow-up check] These follow-ups you promised are due. Check each one now (read the files, "
             "the outbox, or hand it to its lead with pulse.py delegate). Then mark it with "
             "pulse.py followup set <id> --status done, or move --check-at if it's still waiting. "
             "Reply to the owner only with what changed or what needs them: first line one plain sentence."]
    for r in due:
        lines.append(f"- {r['id']} ({r['who']}, due {r['check_at']}): {r['what']}" + (f" [note: {r['note']}]" if r.get("note") else ""))
    run = ask.ask("pulse", "\n".join(lines), extra={"trigger": "followup", "source": "schedule",
                                                   "display": f"Follow-up check: {len(due)} due"})
    return {"ok": True, "started": True, "run_id": run["run_id"], "due": [r["id"] for r in due]}


# --------------------------------------------------------------------------
# Status and briefings
# --------------------------------------------------------------------------

def live_runs():
    runs = []
    for f in livemod.LIVE.glob("*.json") if livemod.LIVE.is_dir() else []:
        st = read_json(f)
        if isinstance(st, dict) and st.get("run_id"):
            runs.append(st)
    return sorted(runs, key=lambda r: r.get("started") or "")


def running_now():
    out_ = []
    for r in live_runs():
        if r.get("state") in ("running", "queued", "idle") and livemod.pid_alive(r.get("pid")):
            out_.append({"run_id": r["run_id"], "agent": r.get("agent"), "entity": r.get("entity"),
                         "kind": r.get("kind"), "state": r.get("state"), "doing": r.get("doing"),
                         "step": r.get("step"), "started": r.get("started"), "parent_run": r.get("parent_run")})
    return out_


def status():
    fus = read_followups()
    return {"ok": True, "at": now_iso(), "running": running_now(),
            "handoffs_waiting": [{"group": g["group"], "children": [{"agent": c.get("agent"), "status": c.get("status")} for c in g.get("children", [])]}
                                 for g in open_groups()],
            "followups_due": [r for r in fus if is_due(r)],
            "followups_open": sum(1 for r in fus if r.get("status") == "open")}


def section(md, title_re, limit=1200):
    """One '## ' section of a markdown file whose heading matches title_re."""
    m = re.search(rf"^##\s+[^\n]*{title_re}[^\n]*\n(.*?)(?=^##\s|\Z)", md or "", re.S | re.M | re.I)
    return clip(m.group(1).strip(), limit) if m else ""


def entity_lines():
    reg = ask.registry()
    lines = []
    for e in reg.get("entities", []):
        st = read_json(ORG / e.get("path", "") / "status.json", {}) or {}
        if not isinstance(st, dict):
            continue
        open_dec = [d for d in st.get("decisions") or [] if isinstance(d, dict) and d.get("status", "open") == "open"]
        risk = (st.get("risks") or [None])[0]
        nxt = (st.get("next") or [None])[0]
        bits = [f"{e.get('name')}: {st.get('health') or '?'}", clip(st.get("headline") or "", 220)]
        if open_dec:
            bits.append(f"{len(open_dec)} decision(s) open")
        if risk:
            bits.append("risk: " + clip(risk if isinstance(risk, str) else (risk.get("what") or risk.get("risk") or json.dumps(risk)), 140))
        if nxt:
            bits.append("next: " + clip(nxt if isinstance(nxt, str) else (nxt.get("what") or nxt.get("text") or json.dumps(nxt)), 140))
        lines.append("- " + " · ".join(b for b in bits if b))
        goals = read_json(ORG / e.get("path", "") / "goals.json", {}) or {}
        for g in goals.get("goals", []) if isinstance(goals, dict) else []:
            if isinstance(g, dict) and g.get("at_risk"):
                lines.append(f"  goal at risk: {g.get('title')} ({g.get('current')}/{g.get('target')} {g.get('unit') or ''})")
    return lines


def outbox_lines():
    items = []
    for f in sorted((ORG / "outbox").glob("*.json"), reverse=True) if (ORG / "outbox").is_dir() else []:
        x = read_json(f)
        if isinstance(x, dict) and x.get("status") == "pending":
            items.append(x)
    lines = [f"{len(items)} waiting for your click"]
    for x in items[:6]:
        lines.append(f"- {x.get('kind')} ({x.get('entity')}): {clip(x.get('subject') or x.get('title') or x.get('body') or '', 90)}")
    return lines


def finished_today():
    today = now().date().isoformat()
    rows = [r for r in live_runs() if (r.get("finished") or "").startswith(today) and r.get("kind") != "interactive"]
    return [f"- {r.get('agent')} {'ok' if r.get('ok') else 'failed'}: {clip(r.get('doing') or '', 70)} → {clip(r.get('result') or '', 140)}" for r in rows[-10:]]


def digest(kind):
    if kind not in ("morning", "evening"):
        raise Invalid("kind: morning or evening")
    parts = [f"Now: {now().strftime('%A %Y-%m-%d %H:%M')}"]
    parts += ["\nEntities:"] + entity_lines()
    week = (ORG / "WEEK.md").read_text() if (ORG / "WEEK.md").exists() else ""
    moves = section(week, "three moves")
    if moves:
        parts += ["\nThis week's three moves (WEEK.md):", moves]
    parts += ["\nOutbox:"] + outbox_lines()
    run = running_now()
    parts.append(f"\nRunning now: {len(run)}")
    parts += [f"- {r['agent']}: {clip(r.get('doing') or '', 70)} ({r.get('step')})" for r in run[:8]]
    if kind == "evening":
        done = finished_today()
        parts += [f"\nFinished today: {len(done)}"] + done
    fus = read_followups()
    due = [r for r in fus if is_due(r)]
    upcoming = [r for r in fus if r.get("status") == "open" and not is_due(r)][:5]
    parts.append(f"\nFollow-ups: {len(due)} due, {len(upcoming)} upcoming")
    parts += [f"- due: {r['what']} ({r['who']})" for r in due[:6]]
    parts += [f"- {r['check_at'][:10]}: {r['what']} ({r['who']})" for r in upcoming]
    return clip("\n".join(parts), DIGEST_MAX)


BRIEF_ASK = {
    "morning": ("Morning brief", "the owner's morning brief: what matters today, what's waiting on them, and the one thing to do first"),
    "evening": ("End-of-day recap", "the owner's end-of-day recap: what got done, what's still open, and what's first tomorrow"),
}


def brief(kind, source=None):
    label, what = BRIEF_ASK.get(kind) or (None, None)
    if not label:
        raise Invalid("kind: morning or evening")
    message = (
        f"BRIEF {kind}: write {what}.\n"
        "Format: the first paragraph is 3 to 6 short spoken sentences (it is read aloud: no lists, "
        "links, symbols or numbers in parentheses). Then a line with --- and the text version: up "
        f"to 8 short bullets with links. Use the facts below plus what you read in {ORG}. "
        "Don't hand anything off for a brief.\n\n" + digest(kind))
    return ask.ask("pulse", message, extra={"trigger": "brief", "source": source, "display": label})


def wait(run_id, timeout=600, poll=1.0):
    if not livemod.RUN_ID.match(run_id or ""):
        raise Invalid("bad run id")
    end = time.time() + timeout
    while time.time() < end:
        st = live_state(run_id)
        if st.get("state") in ("finished", "failed"):
            return {"ok": bool(st.get("ok")), "run_id": run_id, "state": st["state"], "reply": final_reply(run_id)}
        if st and st.get("pid") and not livemod.pid_alive(st.get("pid")):
            return {"ok": False, "run_id": run_id, "state": "stopped", "reply": final_reply(run_id)}
        time.sleep(poll)
    return {"ok": False, "run_id": run_id, "state": "timeout", "reply": ""}


# --------------------------------------------------------------------------

def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    d = sub.add_parser("delegate")
    d.add_argument("--to", action="append", default=[])
    d.add_argument("--message", action="append", default=[])
    d.add_argument("--continue", dest="cont", action="store_true", help="continue each lead's latest conversation")
    f = sub.add_parser("followup")
    fs = f.add_subparsers(dest="fcmd", required=True)
    fa = fs.add_parser("add")
    fa.add_argument("--what", required=True)
    fa.add_argument("--who", required=True)
    fa.add_argument("--check-at", required=True)
    fa.add_argument("--note")
    fa.add_argument("--by", default="pulse")
    fl = fs.add_parser("list")
    fl.add_argument("--due", action="store_true")
    fl.add_argument("--all", action="store_true")
    fset = fs.add_parser("set")
    fset.add_argument("id")
    fset.add_argument("--status")
    fset.add_argument("--check-at")
    fset.add_argument("--note")
    sub.add_parser("tick")
    b = sub.add_parser("brief")
    b.add_argument("kind", choices=["morning", "evening"])
    b.add_argument("--wait", action="store_true")
    b.add_argument("--source", default=None)
    dg = sub.add_parser("digest")
    dg.add_argument("kind", choices=["morning", "evening"])
    w = sub.add_parser("wait")
    w.add_argument("run_id")
    w.add_argument("--timeout", type=int, default=600)
    a = ap.parse_args(argv)
    try:
        if a.cmd == "status":
            out(status())
        elif a.cmd == "delegate":
            if len(a.to) != len(a.message):
                raise Invalid("give one --message for each --to")
            out(delegate(list(zip(a.to, a.message)), fresh=not a.cont, origin=os.environ.get("PORTFOLIO_RUN_ID")))
        elif a.cmd == "followup":
            if a.fcmd == "add":
                out({"ok": True, "followup": followup_add(a.what, a.who, a.check_at, a.note, a.by)})
            elif a.fcmd == "list":
                rows = read_followups()
                rows = [r for r in rows if is_due(r)] if a.due else rows if a.all else [r for r in rows if r.get("status") == "open"]
                out({"ok": True, "followups": rows})
            else:
                out({"ok": True, "followup": followup_set(a.id, a.status, a.check_at, a.note)})
        elif a.cmd == "tick":
            out(tick())
        elif a.cmd == "brief":
            r = brief(a.kind, a.source)
            out(wait(r["run_id"]) if a.wait else r)
        elif a.cmd == "digest":
            print(digest(a.kind))
        elif a.cmd == "wait":
            out(wait(a.run_id, a.timeout))
    except (Invalid, ask.Invalid) as ex:
        out({"ok": False, "error": str(ex)})
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
