#!/usr/bin/env python3
"""Roo's shared memory: one store every surface reads and writes (the Roo app, the agents' headless
runs, the owner's own Claude Code sessions).

    memory.py context --entity acme              what an agent reads at session start (markdown)
    memory.py search "sign-off" --entity acme [--type lesson] [--limit 10] [--json]
    memory.py list [--entity acme] [--type fact] [--status active|superseded|disabled|all] [--json]
    memory.py get <id> [--entity acme] [--json]
    memory.py add --entity acme --title "..." --text "..." [--type fact] [--source ...] [--tags a,b]
                  [--by acme-lead] [--replaces <id>]      (--text - reads stdin; --body-file path)
    memory.py set <id> --status active|superseded|disabled   (nothing is ever deleted)
    memory.py index                                          rebuild INDEX.md and index.json

The store is <org>/memory/facts/<id>.md: one fact per file, a small frontmatter block, then the
text. INDEX.md and index.json are generated (titles only, no bodies).

Entity tags. Every fact carries one or more entity ids from portfolio.json, or `general` (true for
the owner everywhere). An agent passes its own entity and sees that entity plus `general`; an entity
also sees its ventures (entities whose "parent" is it, or whose folder is inside its folder).
`--entity all` (the front door, chief-of-staff) sees everything. A fact tagged with one entity
stays out of every other entity's reads.

Types: fact, preference (learned by learn.py or stated by the owner), lesson (distilled from
Outbox decisions), feedback, project, reference.

Text is passed through live.redact before it is stored, so a pasted key never lands here.
PORTFOLIO_ROOT overrides the org folder (default: the parent of this bin/).
"""
import argparse, contextlib, datetime, difflib, fcntl, hashlib, json, os, pathlib, re, sys

HOME = pathlib.Path.home()
# The org folder: PORTFOLIO_ROOT (tests), else the folder this bin/ lives in.
ORG = pathlib.Path(os.environ.get("PORTFOLIO_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
MEMORY = ORG / "memory"
FACTS = MEMORY / "facts"
INDEX_MD = MEMORY / "INDEX.md"
INDEX_JSON = MEMORY / "index.json"
LOCK = MEMORY / ".memory.lock"
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from live import owner_name, redact, short_path  # noqa: E402

GENERAL = "general"
ALL = "all"
ALIASES = {"*": ALL}
TYPES = ("fact", "preference", "lesson", "feedback", "project", "reference")
STATUSES = ("active", "superseded", "disabled")
FIELDS = ("id", "title", "entity", "type", "status", "source", "by", "tags", "created", "updated",
          "superseded_by", "evidence")
ID_RE = re.compile(r"^[a-z]{1,3}-[0-9a-z-]{4,60}$")
DUP_RATIO = 0.88


class Invalid(Exception):
    pass


# --------------------------------------------------------------------------
# Entities and visibility
# --------------------------------------------------------------------------

def registry():
    try:
        reg = json.loads((ORG / "portfolio.json").read_text())
    except (OSError, json.JSONDecodeError):
        return []
    return [e for e in reg.get("entities", []) if isinstance(e, dict) and e.get("id")]


def entity_ids():
    return [e["id"] for e in registry()]


def children(eid):
    """Ventures under an entity: those whose "parent" is it (at any depth), or whose folder is
    inside its folder."""
    reg = registry()
    base = next((e.get("path") for e in reg if e["id"] == eid), None)
    out, todo = [], [eid]
    while todo:
        cur = todo.pop()
        for e in reg:
            if e["id"] not in out and e["id"] != eid and e.get("parent") == cur:
                out.append(e["id"])
                todo.append(e["id"])
    if base:
        out += [e["id"] for e in reg if e["id"] not in out and e["id"] != eid
                and str(e.get("path") or "").startswith(base.rstrip("/") + "/")]
    return out


def norm_entity(e):
    e = (e or "").strip().lower()
    return ALIASES.get(e, e)


def parse_entities(value, allow_all=False):
    raw = value if isinstance(value, list) else str(value or "").split(",")
    out = []
    known = set(entity_ids()) | {GENERAL} | ({ALL} if allow_all else set())
    for e in raw:
        e = norm_entity(e)
        if not e:
            continue
        if e not in known:
            raise Invalid(f"unknown entity {e!r}: use one of {', '.join(sorted(known))}")
        if e not in out:
            out.append(e)
    if not out:
        raise Invalid("every fact needs an entity (an entity id, or general)")
    return out


def readable_by(reader):
    """The entity tags a reader may see. None means everything."""
    reader = norm_entity(reader)
    if not reader or reader == ALL:
        return None
    if reader not in set(entity_ids()) | {GENERAL}:
        raise Invalid(f"unknown entity {reader!r}")
    return {reader, GENERAL, *children(reader)}


def visible(fact, reader):
    allowed = readable_by(reader)
    return allowed is None or bool(set(fact.get("entity") or []) & allowed)


# --------------------------------------------------------------------------
# Files
# --------------------------------------------------------------------------

def today():
    return datetime.date.today().isoformat()


def norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())).strip()


def make_id(prefix, *parts):
    return f"{prefix}-" + hashlib.sha1("\x1f".join(str(p) for p in parts).encode()).hexdigest()[:8]


def one_line(s, n):
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def dump(fact):
    lines = ["---"]
    for k in FIELDS:
        v = fact.get(k)
        if v in (None, "", []):
            continue
        if isinstance(v, list):
            v = ", ".join(str(x) for x in v)
        elif isinstance(v, dict):
            v = json.dumps(v, sort_keys=True)
        lines.append(f"{k}: {one_line(v, 400)}")
    lines += ["---", "", (fact.get("body") or "").strip(), ""]
    return "\n".join(lines)


def parse(text):
    fact = {}
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 4)
    if end < 0:
        return None
    for line in text[4:end].splitlines():
        k, sep, v = line.partition(":")
        k, v = k.strip(), v.strip()
        if not sep or k not in FIELDS:
            continue
        if k in ("entity", "tags"):
            fact[k] = [x.strip() for x in v.split(",") if x.strip()]
        elif k == "evidence":
            try:
                fact[k] = json.loads(v)
            except json.JSONDecodeError:
                fact[k] = {}
        else:
            fact[k] = v
    fact["body"] = text[end + 4:].strip()
    return fact if fact.get("id") else None


def path_for(fid):
    if not ID_RE.match(fid or ""):
        raise Invalid(f"bad id {fid!r}")
    return FACTS / f"{fid}.md"


def load(fid):
    try:
        return parse(path_for(fid).read_text())
    except OSError:
        return None


def all_facts():
    out = []
    for p in sorted(FACTS.glob("*.md")) if FACTS.is_dir() else []:
        try:
            f = parse(p.read_text())
        except OSError:
            continue
        if f:
            out.append(f)
    return out


@contextlib.contextmanager
def locked():
    MEMORY.mkdir(parents=True, exist_ok=True)
    with open(LOCK, "a") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def write_atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


def _save(fact):
    write_atomic(path_for(fact["id"]), dump(fact))


# --------------------------------------------------------------------------
# Writing
# --------------------------------------------------------------------------

def find_duplicate(facts, title, body, ftype, entities):
    nt, nb = norm(title), norm(body)
    for f in facts:
        if f.get("status") != "active" or f.get("type") != ftype or not set(f.get("entity") or []) & set(entities):
            continue
        if nt and nt == norm(f.get("title")):
            return f
        if nb and difflib.SequenceMatcher(a=nb, b=norm(f.get("body")), autojunk=False).ratio() >= DUP_RATIO:
            return f
    return None


def add(title, body, entity, ftype="fact", source="", by="", tags=(), replaces=None, fid=None):
    """Adds a fact, or returns the active near-duplicate instead of writing a second copy."""
    if ftype not in TYPES:
        raise Invalid(f"type must be one of {', '.join(TYPES)}")
    body = redact((body or "").strip())
    title = one_line(redact(title or body.splitlines()[0] if body else ""), 140)
    if not title or not body:
        raise Invalid("a fact needs text")
    entities = parse_entities(entity)
    with locked():
        facts = all_facts()
        if not fid and not replaces:
            dup = find_duplicate(facts, title, body, ftype, entities)
            if dup is not None:
                return {"ok": True, "id": dup["id"], "duplicate": True, "changed": False}
        fid = fid or make_id("m", ftype, norm(title), norm(body)[:400])
        old = load(replaces) if replaces else None
        if replaces and old is None:
            raise Invalid(f"no fact {replaces}")
        fact = {"id": fid, "title": title, "entity": entities, "type": ftype, "status": "active",
                "source": source or None, "by": by or None, "tags": [t for t in tags if t], "created": today(),
                "updated": today(), "body": body}
        _save(fact)
        if old is not None:
            old.update(status="superseded", superseded_by=fid, updated=today())
            _save(old)
        rebuild_index()
    return {"ok": True, "id": fid, "duplicate": False, "changed": True}


def upsert(fid, title, body, entity, ftype, source="", by="", tags=(), status="active", evidence=None):
    """Writes a fact under a fixed id (importers, learn.py). Keeps created; touches updated only on change.
    Returns True when the file changed. The caller rebuilds the index."""
    if ftype not in TYPES or status not in STATUSES:
        raise Invalid("bad type or status")
    entities = parse_entities(entity)
    with locked():
        old = load(fid) or {}
        fact = {"id": fid, "title": one_line(redact(title), 140), "entity": entities, "type": ftype, "status": status,
                "source": source or None, "by": by or None, "tags": [t for t in tags if t],
                "created": old.get("created") or today(), "updated": old.get("updated") or today(),
                "superseded_by": old.get("superseded_by"), "evidence": evidence or None,
                "body": redact((body or "").strip())}
        if old and dump({**old, "updated": ""}) == dump({**fact, "updated": ""}):
            return False
        fact["updated"] = today()
        _save(fact)
        return True


def set_status(fid, status):
    if status not in STATUSES:
        raise Invalid(f"status must be one of {', '.join(STATUSES)}")
    with locked():
        fact = load(fid)
        if fact is None:
            raise Invalid(f"no fact {fid}")
        fact.update(status=status, updated=today())
        _save(fact)
        rebuild_index()
    return {"ok": True, "id": fid, "status": status}


def rebuild_index():
    facts = all_facts()
    meta = [{k: f.get(k) for k in ("id", "title", "entity", "type", "status", "source", "updated")} for f in facts]
    write_atomic(INDEX_JSON, json.dumps({"updated": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
                                         "facts": meta}, indent=1, ensure_ascii=False) + "\n")
    groups = {}
    for f in facts:
        if f.get("status") == "active":
            groups.setdefault(", ".join(f.get("entity") or ["?"]), []).append(f)
    lines = ["# Roo memory index", "",
             "Generated by bin/memory.py. One file per fact in facts/. Agents: don't read this whole; run",
             f"`python3 {short_path(ORG / 'bin' / 'memory.py')} context --entity <your entity>` so you only see your entity",
             "and general facts.", ""]
    for key in sorted(groups, key=lambda k: (k != GENERAL, k)):
        lines.append(f"## {key}")
        for f in sorted(groups[key], key=lambda f: (f.get("type") or "", f.get("title") or "")):
            lines.append(f"- [{f['title']}](facts/{f['id']}.md) {f.get('type')}")
        lines.append("")
    write_atomic(INDEX_MD, "\n".join(lines))
    return len(facts)


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------

def select(reader=None, ftype=None, status="active"):
    out = []
    for f in all_facts():
        if status != "all" and f.get("status") != status:
            continue
        if ftype and f.get("type") != ftype:
            continue
        if visible(f, reader):
            out.append(f)
    return out


def search(query, reader=None, ftype=None, limit=10):
    words = [w for w in norm(query).split() if len(w) > 1]
    if not words:
        raise Invalid("search needs words")
    scored = []
    for f in select(reader, ftype):
        title, body, tags = norm(f.get("title")), norm(f.get("body")), norm(" ".join(f.get("tags") or []))
        hay = f" {title} {body} {tags} "

        def hits(text, w):      # whole words; words of 4+ letters also match as a prefix (draft -> drafts)
            return sum(1 for t in text.split() if t == w or (len(w) >= 4 and t.startswith(w)))
        score = sum(3 * hits(title, w) + hits(body, w) + 2 * hits(tags, w) for w in words)
        tier = 2 if f" {' '.join(words)} " in hay else 1 if all(f" {w} " in hay for w in words) else 0
        if score:
            scored.append((tier, score, f))
    best = max((t for t, _, _ in scored), default=0)
    scored = [(sc, f) for t, sc, f in scored if t == best]    # the exact phrase beats all-words beats some-words
    scored.sort(key=lambda x: (-x[0], x[1]["id"]))
    return [f for _, f in scored[:limit]]


CONTEXT_ORDER = ("preference", "feedback", "lesson", "fact", "reference", "project")
CONTEXT_HEADINGS = {"preference": "How {owner} likes things done", "feedback": "How {owner} wants agents to work",
                    "lesson": "Learned from the Outbox", "fact": "Facts", "reference": "References",
                    "project": "Projects"}


def context(reader, max_chars=8000):
    """Markdown for an agent's session start: its entity plus general, newest evidence first, clipped."""
    facts = select(reader)
    owner = owner_name()
    lines = [f"# Roo memory ({norm_entity(reader) or ALL})", "",
             "Shared across Roo, the agents and the owner's own sessions. `memory.py get <id>` for the full text; "
             f"`memory.py add` when {owner} states something durable.", ""]
    for t in CONTEXT_ORDER:
        group = [f for f in facts if f.get("type") == t]
        if not group:
            continue
        group.sort(key=lambda f: f.get("updated") or "", reverse=True)
        lines.append(f"## {CONTEXT_HEADINGS[t].format(owner=owner)}")
        for f in group:
            scope = "" if f.get("entity") == [GENERAL] else f"[{', '.join(f['entity'])}] "
            body = re.sub(r"[*`]|^#+\s*", "", f["body"], flags=re.M)
            if t == "preference" or norm(body).startswith(norm(f["title"])[:40]):
                text = one_line(body.split("\n\n")[0], 320)     # rules are short: show the whole rule
            elif len(f["title"]) < 60:
                text = f"{f['title']}: {one_line(body, 140)}"
            else:
                text = f["title"]
            lines.append(f"- {scope}{text} `{f['id']}`")
        lines.append("")
    out = "\n".join(lines)
    if len(out) > max_chars:
        out = out[:max_chars].rsplit("\n", 1)[0] + "\n- … (clipped: use `memory.py search` for more)\n"
    return out


def show(f, full=True):
    head = f"{f['id']}  [{', '.join(f.get('entity') or [])}] {f.get('type')} ({f.get('status')}, {f.get('updated')})"
    return head + "\n  " + f.get("title", "") + (("\n\n" + f.get("body", "") + "\n") if full else "")


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("context"); c.add_argument("--entity", required=True); c.add_argument("--max-chars", type=int, default=8000)
    s = sub.add_parser("search"); s.add_argument("query", nargs="+")
    ls = sub.add_parser("list"); ls.add_argument("--status", default="active", choices=("all", *STATUSES))
    g = sub.add_parser("get"); g.add_argument("id")
    for p in (s, ls, g):
        p.add_argument("--entity")
        p.add_argument("--json", action="store_true")
    for p in (s, ls):
        p.add_argument("--type", choices=TYPES)
    s.add_argument("--limit", type=int, default=10)
    a_ = sub.add_parser("add")
    a_.add_argument("--entity", required=True); a_.add_argument("--title", default="")
    a_.add_argument("--text"); a_.add_argument("--body-file")
    a_.add_argument("--type", default="fact", choices=TYPES); a_.add_argument("--source", default="")
    a_.add_argument("--by", default=os.environ.get("PORTFOLIO_AGENT", "")); a_.add_argument("--tags", default="")
    a_.add_argument("--replaces")
    st = sub.add_parser("set"); st.add_argument("id"); st.add_argument("--status", required=True, choices=STATUSES)
    sub.add_parser("index")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "context":
            print(context(a.entity, a.max_chars), end="")
            return 0
        if a.cmd == "add":
            body = a.text
            if body == "-":
                body = sys.stdin.read()
            elif a.body_file:
                body = pathlib.Path(a.body_file).expanduser().read_text()
            res = add(a.title, body, a.entity, a.type, a.source, a.by, [t.strip() for t in a.tags.split(",")], a.replaces)
        elif a.cmd == "set":
            res = set_status(a.id, a.status)
        elif a.cmd == "index":
            res = {"ok": True, "facts": rebuild_index()}
        elif a.cmd == "get":
            f = load(a.id)
            if f is None or not visible(f, a.entity):
                raise Invalid(f"no fact {a.id}" + (f" for {a.entity}" if a.entity else ""))
            print(json.dumps(f, ensure_ascii=False) if a.json else show(f))
            return 0
        else:
            rows = search(" ".join(a.query), a.entity, a.type, a.limit) if a.cmd == "search" else \
                select(a.entity, a.type, a.status)
            if a.json:
                print(json.dumps([{k: v for k, v in f.items() if k != "body" or a.cmd == "search"} for f in rows],
                                 ensure_ascii=False))
            else:
                print("\n".join(show(f, full=False) for f in rows) or "(nothing)")
            return 0
    except (Invalid, OSError) as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 2
    print(json.dumps(res, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
