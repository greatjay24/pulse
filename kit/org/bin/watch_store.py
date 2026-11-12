"""Shared files for the leads, a watcher (an optional bin/watch.py) and Roo. Stdlib only, Python 3.9.

    watch/events.jsonl        every event a watcher saw and what it decided
    watch/notify.jsonl        notifications Roo shows (tell-owner / urgent)
    watch/notify-queue.jsonl  notifications held during quiet hours, flushed at the end of them
    watch/autonomous.jsonl    "Done without you": every autonomous action, with undo info
    watch/digest-<date>.md    the 6pm digest
    watch/state.json          a watcher's own memory (seen keys, pending, budget); nobody else writes it
    followups.jsonl           things waiting on someone (bin/pulse.py's file; see "Follow-ups" below)

Every .jsonl under watch/ is append-only; writers take an flock on .cache/locks/<name>.lock while
appending. followups.jsonl is the exception: one row per id, rewritten whole under its lock.
The kit ships no watcher; agents log what they did on their own with log_action(), and Roo's
Activity shows it ("Done without you") with an Undo button (bin/undo.py).

PORTFOLIO_ROOT overrides the org folder (default: the parent of this bin/).
"""
import contextlib, datetime, fcntl, json, os, pathlib, re, secrets, time

HOME = pathlib.Path.home()


def org():
    return pathlib.Path(os.environ.get("PORTFOLIO_ROOT") or pathlib.Path(__file__).resolve().parent.parent)


def watch_dir():
    d = org() / "watch"
    d.mkdir(parents=True, exist_ok=True)
    return d


def path(name):
    return org() / "followups.jsonl" if name == "followups" else watch_dir() / f"{name}.jsonl"


def now():
    return datetime.datetime.now().astimezone()


def iso(dt=None):
    return (dt or now()).isoformat(timespec="seconds")


def parse_time(v):
    """ISO 8601 (with or without offset) or YYYY-MM-DD -> aware datetime, or None."""
    if not v or not isinstance(v, str):
        return None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            dt = datetime.datetime.strptime(v, "%Y-%m-%d")
        else:
            dt = datetime.datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.astimezone()


def new_id(prefix):
    return f"{prefix}-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"


@contextlib.contextmanager
def locked(name):
    locks = org() / ".cache" / "locks"
    locks.mkdir(parents=True, exist_ok=True)
    with open(locks / f"{name}.lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        yield


def append(name, row):
    with locked(name):
        with open(path(name), "a") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row


def read(name):
    p = path(name)
    if not p.exists():
        return []
    out = []
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def write_json_atomic(p, obj):
    p = pathlib.Path(p)
    tmp = p.with_suffix(p.suffix + f".tmp{os.getpid()}")
    tmp.write_text(json.dumps(obj, indent=1, ensure_ascii=False))
    os.replace(tmp, p)


# --------------------------------------------------------------------------
# Config: portfolio.json "watch", over these defaults
# --------------------------------------------------------------------------

DEFAULTS = {
    "enabled": True,
    "quiet_hours": {"start": "22:00", "end": "07:00", "urgent_breaks_quiet": False},
    "budget": {"per_hour": 6, "per_day": 40},
    "triage_model": "haiku",
    "lead_model": None,                    # None = each lead's default
    "first_run_lookback_hours": 2,
    "pending_max_hours": 12,
    "email": {"accounts": [], "days": 1, "limit": 40},     # email account ids (portfolio.json email_accounts)
    "account_entity": {},                  # email account id -> entity id
    "vercel_scopes": {},                   # Vercel team slug -> entity id
    "repo_entities": {},                   # "owner/repo" -> entity id
    "default_entity": None,
    "invoice_grace_days": 2,
    "calendar": {"source": "auto", "connector_every_min": 60, "window_hours": 36,
                 "domains": {}},                    # email domain -> entity id
    "calendar_accept": {"enabled": False, "allowlist": [], "file": "memory/auto-accept.txt", "lookahead_days": 14},
    "invoice_chaser": {"enabled": False, "entities": [], "grace_days": 2, "every_days": 7,
                       "max_nudges": 3, "accounts": {}, "skip_customers": []},
    "deploy_fix": {"enabled": False, "owners": [], "previews": True, "per_day": 4, "per_branch_hours": 12},
    "draft_replies": {"enabled": True},
    "deadlines": {"goal_days": 7, "item_days": 2},
    "followups": {"nudge_every_days": 3, "max_nudges": 2},
    "digest_hour": 18,
}


def _merge(base, over):
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = _merge(base[k], v) if isinstance(base.get(k), dict) and isinstance(v, dict) else v
    return out


def registry():
    try:
        return json.loads((org() / "portfolio.json").read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def config(reg=None):
    reg = reg if reg is not None else registry()
    return _merge(DEFAULTS, reg.get("watch") or {})


def entity_ids(reg=None):
    reg = reg if reg is not None else registry()
    return [e["id"] for e in reg.get("entities", []) if e.get("id")]


# --------------------------------------------------------------------------
# Quiet hours and notifications
# --------------------------------------------------------------------------

def _hm(s):
    h, m = (s or "0:0").split(":")
    return int(h) * 60 + int(m)


def is_quiet(cfg, at=None):
    q = cfg.get("quiet_hours") or {}
    if not q.get("start") or not q.get("end"):
        return False
    at = at or now()
    t, start, end = at.hour * 60 + at.minute, _hm(q["start"]), _hm(q["end"])
    if start == end:
        return False
    return start <= t < end if start < end else (t >= start or t < end)


def notify(cfg, level, entity, title, body="", link=None, source=None, event_key=None, at=None):
    """Roo shows notify.jsonl. In quiet hours the row waits in notify-queue.jsonl (urgent too,
    unless quiet_hours.urgent_breaks_quiet). Returns (row, queued)."""
    at = at or now()
    row = {"id": new_id("n"), "at": iso(at), "level": "urgent" if level == "urgent" else "info",
           "entity": entity, "title": (title or "")[:200], "body": (body or "")[:1000], "link": link,
           "source": source, "event_key": event_key}
    breaks = level == "urgent" and (cfg.get("quiet_hours") or {}).get("urgent_breaks_quiet")
    if is_quiet(cfg, at) and not breaks:
        row["queued_at"] = row["at"]
        append("notify-queue", row)
        return row, True
    append("notify", row)
    return row, False


def flush_queue(cfg, at=None):
    """Outside quiet hours: move held notifications into notify.jsonl. Returns how many moved."""
    if is_quiet(cfg, at):
        return 0
    q = path("notify-queue")
    with locked("notify-queue"):
        rows = read("notify-queue")
        if not rows:
            return 0
        stamp = iso(at)
        with locked("notify"):
            with open(path("notify"), "a") as f:
                for r in rows:
                    r["delivered_at"] = stamp
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
        q.write_text("")
    return len(rows)


# --------------------------------------------------------------------------
# "Done without you" (autonomous.jsonl)
# --------------------------------------------------------------------------

UNDO_KINDS = ("outbox", "pr", "calendar", "invite", "run", "followup", "none")
UNDO_RE = {
    "outbox": re.compile(r"^[A-Za-z0-9._-]{1,160}$"),
    "pr": re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#\d{1,7}$"),
    "calendar": re.compile(r"^[A-Za-z0-9_@.=-]{1,300}$"),
    "invite": re.compile(r"^[A-Za-z0-9_.=-]{1,200}(@[A-Za-z0-9_.@=-]{1,200})?$"),
    "run": re.compile(r"^[a-z0-9][a-z0-9_-]{0,119}$"),
    "followup": re.compile(r"^[A-Za-z0-9._-]{1,120}$"),
}


def parse_undo(spec):
    """'outbox:<id>' | 'pr:owner/repo#12' | 'calendar:<event id>' | 'invite:<event id>@<calendar>' | 'run:<run_id>' |
    'followup:<id>' | 'none' -> {"kind","ref"}."""
    spec = (spec or "none").strip()
    if spec == "none":
        return {"kind": "none", "ref": None}
    kind, _, ref = spec.partition(":")
    if kind not in UNDO_RE or not UNDO_RE[kind].match(ref):
        raise ValueError(f"bad undo spec {spec!r}: use outbox:<id>, pr:owner/repo#n, calendar:<event id>, "
                         f"run:<run_id>, followup:<id> or none")
    return {"kind": kind, "ref": ref}


def log_action(entity, what, why, links=(), undo="none", by=None, event_key=None, run_id=None, at=None):
    u = undo if isinstance(undo, dict) else parse_undo(undo)
    row = {"id": new_id("a"), "type": "action", "at": iso(at), "entity": entity, "what": (what or "")[:300],
           "why": (why or "")[:500], "links": [l for l in links if l][:8], "undo": u, "by": by,
           "event_key": event_key, "run_id": run_id}
    return append("autonomous", row)


def actions():
    """Action rows, each with `undone` (the undo row) when it was reversed."""
    rows = read("autonomous")
    undos = {r.get("ref"): r for r in rows if r.get("type") == "undo" and r.get("ok")}
    out = []
    for r in rows:
        if r.get("type", "action") == "action":
            r = dict(r)
            if r.get("id") in undos:
                r["undone"] = undos[r["id"]]
            out.append(r)
    return out


# --------------------------------------------------------------------------
# Follow-ups (followups.jsonl): the same file and row shape as bin/pulse.py, which owns it
# --------------------------------------------------------------------------
# pulse.py rewrites the file whole under the "followups" lock (same lock file as ours), one row
# per id: {"id": "fu-<hex>", "what", "who", "check_at", "status": "open|done|dropped", "created",
# "run", "note", "last_checked"}. We write the same way and add optional fields pulse.py
# ignores: created_by, check {...}, links [..], nudges, max_nudges, nudge_every_days,
# resolved_at, how, escalated_at. `who` is an entity id, a lead name, or "owner"/"pulse"
# (those belong to the front door: a watcher leaves them to pulse.py tick).

FOLLOWUP_STATUS = ("open", "done", "dropped")
FU_ID = re.compile(r"^fu-[a-z0-9]{4,40}$")
CHECK_KINDS = ("reply_from", "invoice_paid", "pr_merged", "outbox_sent", "email_sent_to")


def _read_followups():
    p = path("followups")
    rows = []
    try:
        lines = p.read_text().splitlines()
    except OSError:
        return rows
    for line in lines:
        try:
            x = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(x, dict) and FU_ID.match(x.get("id") or ""):
            rows.append(x)
    return rows


def _write_followups(rows):
    p = path("followups")
    tmp = p.with_name(f".{p.name}.{os.getpid()}.tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    os.replace(tmp, p)


def followups():
    return {r["id"]: r for r in _read_followups()}


def add_followup(what, who, check_at, created_by, check=None, links=(), note=None, **extra):
    what = " ".join((what or "").split())
    if not what or not who:
        raise ValueError("what and who are required")
    when = parse_time(check_at)
    if not when:
        raise ValueError("check_at must be ISO 8601 or YYYY-MM-DD")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", check_at.strip()):
        when = when.replace(hour=9)                  # pulse.py reads a bare date as 9:00 that day
    if check is not None:
        if not isinstance(check, dict) or not any(k in check for k in CHECK_KINDS):
            raise ValueError(f"check needs one of {CHECK_KINDS}")
    row = {"id": f"fu-{secrets.token_hex(4)}", "what": what[:300], "who": who,
           "check_at": when.isoformat(timespec="minutes"), "status": "open", "created": iso(),
           "run": os.environ.get("PORTFOLIO_RUN_ID") or None, "note": (note or "")[:300] or None,
           "last_checked": None, "created_by": created_by, "links": [l for l in links if l][:8]}
    if check:
        row["check"] = check
    row.update({k: v for k, v in extra.items() if v is not None})
    with locked("followups"):
        _write_followups(_read_followups() + [row])
    return row


def update_followup(fid, **fields):
    if fields.get("status") and fields["status"] not in FOLLOWUP_STATUS:
        raise ValueError(f"status must be one of {FOLLOWUP_STATUS}")
    with locked("followups"):
        rows = _read_followups()
        hit = next((r for r in rows if r["id"] == fid), None)
        if not hit:
            raise ValueError(f"no follow-up {fid}")
        hit.update(fields)
        hit["updated"] = iso()
        _write_followups(rows)
    return hit
