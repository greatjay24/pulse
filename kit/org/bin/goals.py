#!/usr/bin/env python3
"""Goals and targets per entity: <entity path>/goals.json (schema in STATUS_SCHEMA.md).

    goals.py show [<entity>]                          every goal with its pace
    goals.py validate [<entity>]                      exit 1 if any file is malformed
    goals.py set <entity> <goal-id> [--current N] [--note "..."] [--at-risk yes|no]
                                                      leads: nightly measurement

Leads update only `current`, `lead_note`, `at_risk` and `updated` through `set`.
Titles, targets, dates and `proposed` are the owner's (Roo edits them).
PORTFOLIO_ROOT overrides the org folder (default: the parent of this bin/).
"""
import argparse, datetime, json, os, pathlib, re, sys

ORG = pathlib.Path(os.environ.get("PORTFOLIO_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SOURCES = ("status", "stripe", "bank", "sales", "github", "tracker", "manual", "other")
REQUIRED = ("id", "title", "metric", "target", "unit", "by", "current", "source", "owner_note")
OPTIONAL = {"proposed", "start", "baseline", "direction", "lead_note", "at_risk", "updated", "source_detail"}
TEXT_MAX = 500
AT_RISK_SLACK = 0.15


class Invalid(ValueError):
    pass


def num_or_null(v, name):
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise Invalid(f"{name} must be a number or null")
    return v


def date_or_null(v, name):
    if v is None:
        return None
    if not isinstance(v, str) or not DATE.match(v):
        raise Invalid(f"{name} must be YYYY-MM-DD or null")
    datetime.date.fromisoformat(v)
    return v


def text(v, name, required=False, n=TEXT_MAX):
    if v is None and not required:
        return None
    if not isinstance(v, str):
        raise Invalid(f"{name} must be text")
    v = "".join(ch for ch in v if ch.isprintable()).strip()
    if required and not v:
        raise Invalid(f"{name} is required")
    if len(v) > n:
        raise Invalid(f"{name} is longer than {n} characters")
    return v


def validate_goal(g):
    if not isinstance(g, dict):
        raise Invalid("each goal is an object")
    missing = [k for k in REQUIRED if k not in g]
    if missing:
        raise Invalid(f"goal {g.get('id')!r} is missing {missing}")
    extra = set(g) - set(REQUIRED) - OPTIONAL
    if extra:
        raise Invalid(f"goal {g.get('id')!r} has unknown keys {sorted(extra)}")
    if not isinstance(g["id"], str) or not ID.match(g["id"]):
        raise Invalid(f"bad goal id {g.get('id')!r}")
    out = {
        "id": g["id"],
        "title": text(g["title"], "title", required=True, n=160),
        "metric": text(g["metric"], "metric", required=True, n=160),
        "target": num_or_null(g["target"], "target"),
        "unit": text(g["unit"], "unit", required=False, n=24) or "",
        "by": date_or_null(g["by"], "by"),
        "current": num_or_null(g["current"], "current"),
        "source": g["source"],
        "owner_note": text(g["owner_note"], "owner_note") or "",
    }
    if out["source"] not in SOURCES:
        raise Invalid(f"source must be one of {SOURCES}")
    if "proposed" in g:
        if not isinstance(g["proposed"], bool):
            raise Invalid("proposed must be true or false")
        out["proposed"] = g["proposed"]
    if "start" in g:
        out["start"] = date_or_null(g["start"], "start")
    if "baseline" in g:
        out["baseline"] = num_or_null(g["baseline"], "baseline")
    if "direction" in g:
        if g["direction"] not in ("up", "down"):
            raise Invalid("direction must be up or down")
        out["direction"] = g["direction"]
    if "at_risk" in g:
        if not isinstance(g["at_risk"], bool):
            raise Invalid("at_risk must be true or false")
        out["at_risk"] = g["at_risk"]
    for k in ("lead_note", "source_detail"):
        if k in g:
            out[k] = text(g[k], k) or ""
    if "updated" in g:
        out["updated"] = text(g["updated"], "updated", n=40)
    return out


def validate(doc):
    if not isinstance(doc, dict) or not isinstance(doc.get("goals"), list):
        raise Invalid('goals.json is {"entity", "updated", "goals": [...]}')
    if len(doc["goals"]) > 20:
        raise Invalid("at most 20 goals per entity")
    goals = [validate_goal(g) for g in doc["goals"]]
    ids = [g["id"] for g in goals]
    if len(ids) != len(set(ids)):
        raise Invalid("goal ids must be unique")
    return {"entity": doc.get("entity"), "updated": doc.get("updated"), "goals": goals}


def pace(g, today=None):
    """on-track | at-risk | done | missed | no-date | unmeasured. Roo (utils/ops.ts) mirrors this."""
    today = today or datetime.date.today()
    t, c = g.get("target"), g.get("current")
    if t is None or c is None:
        return "unmeasured"
    base = g.get("baseline") or 0
    down = g.get("direction") == "down"
    reached = c <= t if down else c >= t
    if reached:
        return "done"
    if g.get("by") and datetime.date.fromisoformat(g["by"]) < today:
        return "missed"
    if g.get("at_risk"):
        return "at-risk"
    if not g.get("by"):
        return "no-date"
    if not g.get("start") or t == base:
        return "on-track"
    start, by = datetime.date.fromisoformat(g["start"]), datetime.date.fromisoformat(g["by"])
    span = max((by - start).days, 1)
    expected = min(max((today - start).days / span, 0), 1)
    progress = (c - base) / (t - base)
    return "at-risk" if progress < expected - AT_RISK_SLACK else "on-track"


def entities():
    reg = json.loads((ORG / "portfolio.json").read_text())
    return [e for e in reg.get("entities", []) if e.get("id") and e.get("path")]


def goals_path(e):
    p = (ORG / e["path"] / "goals.json").resolve()
    if not p.is_relative_to(ORG.resolve()):
        raise Invalid("path outside portfolio")
    return p


def entity(eid):
    for e in entities():
        if e["id"] == eid:
            return e
    raise Invalid(f"unknown entity: {eid}")


def load(e):
    p = goals_path(e)
    if not p.exists():
        return {"entity": e["id"], "updated": None, "goals": []}
    return validate(json.loads(p.read_text()))


def write(e, doc):
    doc = validate(doc)
    doc["entity"] = e["id"]
    doc["updated"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    p = goals_path(e)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, p)
    return doc


def set_measure(eid, gid, current=None, note=None, at_risk=None):
    e = entity(eid)
    doc = load(e)
    for g in doc["goals"]:
        if g["id"] == gid:
            if current is not None:
                g["current"] = current
            if note is not None:
                g["lead_note"] = note
            if at_risk is not None:
                g["at_risk"] = at_risk
            g["updated"] = datetime.date.today().isoformat()
            write(e, doc)
            return {"ok": True, "goal": g, "pace": pace(g)}
    raise Invalid(f"{eid} has no goal {gid}")


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["show", "validate", "set"])
    ap.add_argument("entity", nargs="?")
    ap.add_argument("goal", nargs="?")
    ap.add_argument("--current", type=float)
    ap.add_argument("--note")
    ap.add_argument("--at-risk", choices=["yes", "no"])
    a = ap.parse_args(argv)
    try:
        if a.cmd == "set":
            if not (a.entity and a.goal):
                raise Invalid("set needs <entity> <goal-id>")
            cur = a.current
            if cur is not None and cur == int(cur):
                cur = int(cur)
            res = set_measure(a.entity, a.goal, cur, a.note,
                              None if a.at_risk is None else a.at_risk == "yes")
            print(json.dumps(res, ensure_ascii=False))
            return 0
        bad = 0
        for e in ([entity(a.entity)] if a.entity else entities()):
            try:
                doc = load(e)
            except (Invalid, json.JSONDecodeError) as ex:
                bad += 1
                print(f"{e['id']}: INVALID: {ex}")
                continue
            if a.cmd == "show":
                print(f"{e['id']}:")
                for g in doc["goals"]:
                    tgt = "?" if g["target"] is None else g["target"]
                    cur = "?" if g["current"] is None else g["current"]
                    flag = " (proposed)" if g.get("proposed") else ""
                    print(f"  [{pace(g)}] {g['title']}: {cur} / {tgt} {g['unit']} by {g['by'] or 'no date'}{flag}")
            else:
                print(f"{e['id']}: ok ({len(doc['goals'])} goals)")
        return 1 if bad else 0
    except Invalid as ex:
        print(json.dumps({"ok": False, "error": str(ex)}))
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
