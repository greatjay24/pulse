#!/usr/bin/env python3
"""Folds the memory scattered across the Mac into the shared store (bin/memory.py). Reads only:
the originals are never moved, edited or deleted. Safe to run again: every source has a fixed id,
so a rerun updates what changed and adds what's new.

    memory_import.py              import everything, print a summary
    memory_import.py --dry-run    print what would be written
    memory_import.py --only claude,facts,preferences,notes

Sources (each skipped when it isn't there):
  claude       Claude Code's memory for the org folder and for the home folder:
               ~/.claude/projects/<path with every non-alphanumeric character as "-">/memory/*.md
  facts        <org>/memory/facts.md bullets
  preferences  <org>/memory/preferences.json (learned by learn.py) and the "## Added by ..."
               section of preferences.md (the owner's own lines)
  notes        notes.json in the optional task tracker (PULSE_TRACKER_DIR, default
               ~/project-tracker): goal, status, next, blocked per project

Entity tags: a source whose name or text mentions an entity's id or name (from portfolio.json)
is tagged with that entity; otherwise `general`.

Left where they are, on purpose: memory/learnings.jsonl (learn.py's raw signal log), OWNER.md,
entity BRIEF.md files.

Dedupe: a fact whose text nearly matches one already imported from another source is not written
twice; the summary lists it as a duplicate of the kept id.
CLAUDE_MEMORY_DIR (one folder) and PULSE_TRACKER_DIR override the source folders.
"""
import argparse, difflib, json, os, pathlib, re, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import memory as mem  # noqa: E402

HOME = pathlib.Path.home()
TRACKER = pathlib.Path(os.path.expanduser(os.environ.get("PULSE_TRACKER_DIR") or HOME / "project-tracker"))
OWN_SECTION = re.compile(r"^## Added by[^\n]*$", re.M)
CLAUDE_TYPES = {"user": "fact", "feedback": "feedback", "project": "project", "reference": "reference"}


def claude_project_dir(path):
    """Claude Code's per-folder project directory: the absolute path with every non-alphanumeric
    character replaced by "-" (/Users/sam/portfolio -> -Users-sam-portfolio)."""
    return HOME / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(path))


def claude_dirs():
    if os.environ.get("CLAUDE_MEMORY_DIR"):
        return [pathlib.Path(os.environ["CLAUDE_MEMORY_DIR"])]
    out = []
    for base in (mem.ORG.resolve(), HOME.resolve()):
        d = claude_project_dir(base) / "memory"
        if d not in out:
            out.append(d)
    return out


def tag_for(text):
    """The entities a text mentions by id or name (portfolio.json), else general."""
    out = []
    for e in mem.registry():
        for word in (e.get("id"), e.get("name")):
            if word and len(word) > 2 and re.search(r"(?<![a-z0-9])" + re.escape(word.lower()) + r"(?![a-z0-9])",
                                                    (text or "").lower()):
                out.append(e["id"])
                break
    return out or ["general"]


def frontmatter(text):
    meta, body = {}, text
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end > 0:
            for line in text[4:end].splitlines():
                k, sep, v = line.strip().partition(":")
                if sep and v.strip():
                    meta.setdefault(k.strip(), v.strip().strip('"'))
            body = text[end + 4:].strip()
    return meta, body


# --------------------------------------------------------------------------
# Sources: each yields dicts for memory.upsert
# --------------------------------------------------------------------------

def from_claude():
    seen = set()
    for d in claude_dirs():
        for p in sorted(d.glob("*.md")) if d.is_dir() else []:
            if p.name == "MEMORY.md" or p.name in seen:
                continue
            seen.add(p.name)
            try:
                text = p.read_text()
            except OSError:
                continue
            yield claude_row(p, text)


def claude_row(p, text):
    meta, body = frontmatter(text)
    name = meta.get("name") or p.stem
    desc = meta.get("description") or ""
    return {"id": mem.make_id("m", "claude", p.name), "title": desc or name, "body": body,
            "entity": tag_for(f"{name} {desc}"),
            "type": CLAUDE_TYPES.get(meta.get("type"), "fact"), "source": f"claude-memory/{p.name}",
            "tags": [name]}


def bullets(text):
    """Markdown bullets with their wrapped continuation lines joined."""
    out = []
    for line in text.splitlines():
        if line.startswith("- "):
            out.append(line[2:].strip())
        elif out and line.startswith("  ") and line.strip():
            out[-1] += " " + line.strip()
        elif not line.strip() or line.startswith("#"):
            if out and out[-1] is not None:
                out.append(None)
    return [b for b in out if b]


def from_facts():
    try:
        text = (mem.MEMORY / "facts.md").read_text()
    except OSError:
        return
    for b in bullets(text):
        yield {"id": mem.make_id("m", "facts.md", mem.norm(b)[:80]), "title": b.split(". ")[0], "body": b,
               "entity": ["general"], "type": "fact",
               "source": "memory/facts.md"}


def from_preferences():
    try:
        data = json.loads((mem.MEMORY / "preferences.json").read_text())
    except (OSError, json.JSONDecodeError):
        data = {}
    for p in data.get("preferences") or []:
        if not isinstance(p, dict) or not re.match(r"^p-[0-9a-f]{6}$", p.get("id") or ""):
            continue
        status = "disabled" if p.get("disabled") else ("superseded" if p.get("status") == "superseded" else "active")
        body = p["text"]
        if p.get("superseded_by"):
            body += f"\n\nReplaced by {p['superseded_by']}."
        yield {"id": p["id"], "title": p["text"], "body": body, "entity": [p.get("entity") or "general"],
               "type": "preference", "source": "memory/preferences.json", "by": "learn.py",
               "tags": [p.get("area") or "general"], "status": status, "evidence": p.get("evidence") or None}
    try:
        md = (mem.MEMORY / "preferences.md").read_text()
    except OSError:
        return
    own = OWN_SECTION.search(md)
    for b in bullets(md[own.end():] if own else ""):
        if b == "(none yet)":
            continue
        m = re.match(r"^\[([^\]]+)\]\s*(.+)$", b)
        ents = [e.strip() for e in m.group(1).split(",")] if m else tag_for(b)
        text = m.group(2) if m else b
        try:
            ents = mem.parse_entities(ents)
        except mem.Invalid:
            ents = tag_for(text)
        yield {"id": mem.make_id("p", "owner", mem.norm(text)[:80]), "title": text.split(". ")[0], "body": text,
               "entity": ents, "type": "preference", "source": "memory/preferences.md#added-by-owner", "by": "owner"}


def from_notes():
    try:
        notes = json.loads((TRACKER / "notes.json").read_text()).get("notes") or {}
    except (OSError, json.JSONDecodeError, AttributeError):
        return
    known = set(mem.entity_ids())
    for key, n in notes.items():
        if not isinstance(n, dict) or not (n.get("goal") or n.get("next")):
            continue
        eid = key if key in known else None
        ents = [eid] if eid else tag_for(f"{key} {n.get('goal')}")
        parts = [f"Goal: {n['goal']}" if n.get("goal") else "", f"Status: {n.get('status')}" if n.get("status") else "",
                 f"Next: {n['next']}" if n.get("next") else "", f"Blocked on: {n['blocked_on']}" if n.get("blocked_on") else "",
                 "The owner keeps this in the task tracker's notes.json; that file wins if they differ."]
        yield {"id": mem.make_id("m", "notes", key), "title": f"{key}: {n.get('goal') or n.get('next')}",
               "body": "\n".join(x for x in parts if x), "entity": ents, "type": "project",
               "source": f"tracker/notes.json#{key}", "by": "owner"}


SOURCES = {"claude": from_claude, "facts": from_facts, "preferences": from_preferences, "notes": from_notes}


def run(only=None, dry_run=False):
    existing = {f["id"]: f for f in mem.all_facts()}
    kept, written, unchanged, dups, errors = [], [], [], [], []
    for name in only or SOURCES:
        for row in SOURCES[name]():
            # Dedupe across sources: a near-identical active fact under another id wins.
            twin = next((f for f in kept if f["type"] == row["type"] and difflib.SequenceMatcher(
                a=mem.norm(f["body"]), b=mem.norm(row["body"]), autojunk=False).ratio() >= mem.DUP_RATIO), None)
            if twin is None:
                twin = next((f for f in existing.values() if f["id"] != row["id"] and f.get("status") == "active"
                             and f.get("type") == row["type"] and f.get("source") != row.get("source")
                             and difflib.SequenceMatcher(a=mem.norm(f.get("body")), b=mem.norm(row["body"]),
                                                         autojunk=False).ratio() >= mem.DUP_RATIO), None)
            if twin is not None and row["id"] not in existing:
                dups.append({"source": row["source"], "duplicate_of": twin["id"]})
                continue
            kept.append(row)
            if dry_run:
                written.append({"id": row["id"], "entity": row["entity"], "type": row["type"], "source": row["source"],
                                "title": mem.one_line(row["title"], 90)})
                continue
            try:
                changed = mem.upsert(row["id"], row["title"], row["body"], row["entity"], row["type"], row.get("source", ""),
                                     row.get("by", "import"), row.get("tags", ()), row.get("status", "active"),
                                     row.get("evidence"))
            except mem.Invalid as e:
                errors.append({"source": row["source"], "error": str(e)})
                continue
            (written if changed else unchanged).append(row["id"])
    if not dry_run:
        mem.rebuild_index()
    return {"ok": not errors, "written": written if dry_run else len(written), "unchanged": len(unchanged),
            "duplicates": dups, "errors": errors, "dry_run": dry_run}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args(argv)
    only = [x.strip() for x in a.only.split(",") if x.strip()] or None
    if only and set(only) - set(SOURCES):
        print(json.dumps({"ok": False, "error": f"--only takes {', '.join(SOURCES)}"}))
        return 2
    print(json.dumps(run(only, a.dry_run), ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
