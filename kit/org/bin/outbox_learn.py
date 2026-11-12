#!/usr/bin/env python3
"""What the owner's Outbox clicks teach: run by learn.py each night (or alone with --dry-run).

    outbox_learn.py [--dry-run] [--streak 5]

For every Outbox item the owner has decided, one decision:
  unchanged   sent (or approved, for posts) exactly as the agent wrote it
  edited      edited in Roo, then sent or approved (outbox.py keeps the agent's text in `original`)
  skipped     skipped, with the owner's note when there is one (edited-then-skipped counts as skipped)

Writes (all under <org>/memory):
  outbox_decisions.jsonl     append-only ledger, one row per decided item: ids, agent, kind, entity,
                             decision, fields the owner changed, the skip note. No bodies, no recipients.
                             Stats come from this, so they survive Outbox clean-ups.
  outbox_stats.json          approval rate per agent, per kind, per agent+kind, with the current run of
                             unchanged approvals
  autoapprove_candidates.json + .md
                             agent+kind pairs with >= --streak unchanged approvals in a row and no skip
                             in that run. Proposals only: nothing reads this to send. The owner confirms
                             by setting "owner": "yes" or "no" on a row (kept across runs).
  facts/l-*.md               lessons, via memory.upsert: short rules from the owner's edits ("<owner>
                             cuts sign-offs from acme-lead's email drafts"), skip patterns, and skip
                             notes, each tagged with the entities of the items behind it

Rule-based on purpose (v1): every lesson points at the items that support it, and needs two of them
(one when it is the owner's own skip note).
"""
import argparse, collections, datetime, difflib, json, os, pathlib, re, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import memory as mem  # noqa: E402
from live import now_iso, owner_name, redact, write_json_atomic  # noqa: E402

ORG = mem.ORG
OUTBOX = ORG / "outbox"
LEDGER = mem.MEMORY / "outbox_decisions.jsonl"
STATS = mem.MEMORY / "outbox_stats.json"
CANDIDATES = mem.MEMORY / "autoapprove_candidates.json"
CANDIDATES_MD = mem.MEMORY / "autoapprove_candidates.md"
LESSON_STATE = mem.MEMORY / ".outbox_lessons.json"

STREAK = 5
MIN_EVIDENCE = 2
SKIP_PATTERN_MIN = 3
SKIP_PATTERN_RATE = 0.6
SHORTER, LONGER = 0.8, 1.25
NEVER_AUTO = re.compile(r"stripe|invoice|payment|refund|payout|transfer|quote", re.I)
TEST_ITEM = re.compile(r"\b(dry run|resend test)\b", re.I)

SIGNOFF = re.compile(r"^(best|best regards|thanks|thank you|thanks so much|many thanks|cheers|regards|warm regards|kind regards|"
                     r"talk soon|all the best|sincerely|warmly|appreciate it)[,.!]*$|^[-–—]\s*\w+$", re.I)
GREETING = re.compile(r"^(hi|hey|hello|dear|good (morning|afternoon|evening)|greetings)\b", re.I)
FILLER = ["i hope this finds you well", "hope this finds you well", "i hope you're doing well", "hope you are well",
          "hope you're well", "just wanted to", "just checking in", "circling back", "touching base", "reaching out",
          "please don't hesitate", "please do not hesitate", "feel free to", "let me know if you have any questions",
          "i wanted to follow up", "as per", "at your earliest convenience", "excited to", "thrilled to"]
RULE_NOTE = re.compile(r"\b(don'?t|do not|never|stop|always|prefer|rather|too (?:long|short|formal|salesy|wordy|much)|"
                       r"no (?:hook|cta|point|need)|without a|not (?:needed|my voice|me)|wrong (?:tone|person|time)|"
                       r"off[- ]brand|generic|boring|handl(?:e|es|ing) (?:it|them|these))\b", re.I)
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")
HASHTAG = re.compile(r"(?<!\w)#\w+")


def read_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return default


def read_jsonl(path):
    out = []
    try:
        for line in path.read_text().splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                out.append(row)
    except OSError:
        pass
    return out


def kind_label(item):
    kind = item.get("kind") or "email"
    return f"{kind}:{item['channel']}" if item.get("channel") else kind


def is_test(item):
    by = item.get("created_by") or ""
    return by.endswith("builder") or bool(TEST_ITEM.search(item.get("subject") or ""))


# --------------------------------------------------------------------------
# Decisions
# --------------------------------------------------------------------------

def skip_note(item):
    for h in reversed(item.get("history") or []):
        what = str(h.get("what") or "")
        m = re.match(r"^skipped in (?:Pulse|Roo)(?::\s*(.*))?$", what)
        if m:
            return (m.group(1) or "").strip()
    return ""


def decision_of(item):
    """(decision, at) for a decided item, or None while it is still open."""
    status = item.get("status")
    edited = bool(item.get("original")) or bool(item.get("edited_at"))
    if status == "skipped":
        return "skipped", item.get("skipped_at")
    if status in ("sent", "approved", "published"):
        at = item.get("sent_at") or item.get("approved_at") or item.get("published_at") or item.get("edited_at")
        return ("edited" if edited else "unchanged"), at
    return None


def items():
    out = []
    for f in sorted(OUTBOX.glob("*.json")) if OUTBOX.is_dir() else []:
        item = read_json(f, None)
        if isinstance(item, dict) and item.get("id") and not is_test(item):
            out.append(item)
    return out


def decisions(all_items):
    rows = []
    for item in all_items:
        d = decision_of(item)
        if d is None:
            continue
        decision, at = d
        rows.append({"id": item["id"], "agent": item.get("created_by") or "unknown", "kind": kind_label(item),
                     "entity": item.get("entity") or "general", "decision": decision,
                     "at": at or item.get("created_at"), "changed": sorted((item.get("original") or {}).keys()),
                     "note": redact(skip_note(item))[:300] if decision == "skipped" else ""})
    return rows


def update_ledger(rows, dry_run=False):
    """Appends decisions not logged yet; returns the full ledger (old rows + new)."""
    ledger = read_jsonl(LEDGER)
    seen = {r.get("id") for r in ledger}
    new = [r for r in rows if r["id"] not in seen]
    if new and not dry_run:
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        with LEDGER.open("a") as f:
            for r in new:
                f.write(json.dumps({**r, "logged_at": now_iso()}, ensure_ascii=False) + "\n")
    return ledger + new, new


# --------------------------------------------------------------------------
# Stats and "ask less" candidates
# --------------------------------------------------------------------------

def tally(rows):
    c = collections.Counter(r["decision"] for r in rows)
    n = len(rows)
    return {"decided": n, "unchanged": c["unchanged"], "edited": c["edited"], "skipped": c["skipped"],
            "approval_rate": round((c["unchanged"] + c["edited"]) / n, 3) if n else None,
            "unchanged_rate": round(c["unchanged"] / n, 3) if n else None}


def streak(rows):
    run = 0
    for r in sorted(rows, key=lambda r: r.get("at") or "", reverse=True):
        if r["decision"] != "unchanged":
            break
        run += 1
    return run


def stats(ledger):
    groups = {"by_agent": collections.defaultdict(list), "by_kind": collections.defaultdict(list),
              "by_agent_kind": collections.defaultdict(list)}
    for r in ledger:
        groups["by_agent"][r["agent"]].append(r)
        groups["by_kind"][r["kind"]].append(r)
        groups["by_agent_kind"][f"{r['agent']}|{r['kind']}"].append(r)
    out = {"updated": now_iso(), "overall": tally(ledger)}
    for name, g in groups.items():
        out[name] = {}
        for key, rows in sorted(g.items()):
            t = tally(rows)
            if name == "by_agent_kind":
                t.update(streak_unchanged=streak(rows), last_at=max((r.get("at") or "" for r in rows), default=None),
                         entities=sorted({r["entity"] for r in rows}))
            out[name][key] = t
    return out


def candidates(st, min_streak=STREAK):
    prev = {(c.get("agent"), c.get("kind")): c for c in (read_json(CANDIDATES, {}).get("candidates") or [])}
    rows = []
    for key, t in st["by_agent_kind"].items():
        agent, kind = key.split("|", 1)
        if NEVER_AUTO.search(kind) or t["streak_unchanged"] < min_streak:
            continue
        old = prev.get((agent, kind), {})
        rows.append({"agent": agent, "kind": kind, "entities": t["entities"], "streak_unchanged": t["streak_unchanged"],
                     "decided": t["decided"], "approval_rate": t["approval_rate"], "unchanged_rate": t["unchanged_rate"],
                     "first_proposed": old.get("first_proposed") or now_iso()[:10], "owner": old.get("owner")})
    # Rows the owner already answered stay on the list even if the streak broke, so the answer isn't lost.
    for (agent, kind), old in prev.items():
        if old.get("owner") and not any(r["agent"] == agent and r["kind"] == kind for r in rows):
            rows.append({**old, "streak_unchanged": st["by_agent_kind"].get(f"{agent}|{kind}", {}).get("streak_unchanged", 0),
                         "note": "streak broken since proposed"})
    rows.sort(key=lambda r: (-r["streak_unchanged"], r["agent"], r["kind"]))
    return {"updated": now_iso(), "min_streak": min_streak,
            "note": ("Proposals only. Nothing reads this file to send; every Outbox item still waits for the "
                     "owner's click. Set \"owner\" to \"yes\" or \"no\" on a row to answer; wiring a yes into Roo "
                     "is a separate change the owner approves."),
            "candidates": rows}


def candidates_md(c):
    lines = ["# Ask less: auto-approve candidates", "",
             f"Agent and kind pairs {owner_name()} approved unchanged {c['min_streak']}+ times in a row, with no skip in that run.",
             "Proposals only: nothing auto-sends. Answer in autoapprove_candidates.json (\"owner\": \"yes\" | \"no\").", ""]
    if not c["candidates"]:
        lines.append("None yet.")
    for r in c["candidates"]:
        ans = f" Answered: {r['owner']}." if r.get("owner") else ""
        lines.append(f"- {r['agent']} / {r['kind']} [{', '.join(r.get('entities') or [])}]: {r['streak_unchanged']} unchanged in a row, "
                     f"{r['decided']} decided, {int((r.get('approval_rate') or 0) * 100)}% approved.{ans}")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# Lessons from edits and skips
# --------------------------------------------------------------------------

def lines_of(s):
    return [x.strip() for x in str(s or "").splitlines() if x.strip()]


def words(s):
    return len(str(s or "").split())


def edit_traits(item):
    """What changed between the agent's text and what the owner sent, as rule names."""
    orig = item.get("original") or {}
    traits = set()
    if "body" in orig:
        before, after = str(orig.get("body") or ""), str(item.get("body") or "")
        bl, al = lines_of(before), lines_of(after)
        tail_b = [x for x in bl[-3:] if SIGNOFF.match(x)]
        if tail_b and not any(SIGNOFF.match(x) for x in al[-3:]):
            traits.add("cuts_signoff")
        if bl and GREETING.match(bl[0]) and not (al and GREETING.match(al[0])):
            traits.add("cuts_greeting")
        wb, wa = words(before), words(after)
        if wb >= 15 and wa <= wb * SHORTER:
            traits.add("shorter")
        elif wb and wa >= wb * LONGER:
            traits.add("longer")
        lb, la = before.lower(), after.lower()
        if any(p in lb and p not in la for p in FILLER):
            traits.add("cuts_filler")
        if before.count("!") > after.count("!") and before.count("!") >= 1:
            traits.add("cuts_exclamations")
        if len(EMOJI.findall(before)) > len(EMOJI.findall(after)):
            traits.add("cuts_emoji")
        if len(HASHTAG.findall(before)) > len(HASHTAG.findall(after)):
            traits.add("cuts_hashtags")
    for field in ("subject", "title"):
        if field in orig and difflib.SequenceMatcher(a=mem.norm(orig.get(field)), b=mem.norm(item.get(field))).ratio() < 0.9:
            traits.add("rewrites_subject")
    if "to" in orig or "cc" in orig:
        traits.add("changes_recipients")
    return traits


TRAIT_TEXT = {
    "cuts_signoff": "{owner} cuts the sign-off from {who}'s {kind} drafts; end on the last real line.",
    "cuts_greeting": "{owner} drops the greeting line from {who}'s {kind} drafts; open with the point.",
    "shorter": "{owner} shortens {who}'s {kind} drafts (about {pct}% shorter on average); write tighter.",
    "longer": "{owner} adds detail to {who}'s {kind} drafts (about {pct}% longer); include the specifics up front.",
    "cuts_filler": "{owner} cuts filler phrases (\"hope this finds you well\", \"just wanted to\", \"circling back\") from {who}'s {kind} drafts.",
    "cuts_exclamations": "{owner} removes exclamation marks from {who}'s {kind} drafts.",
    "cuts_emoji": "{owner} removes emoji from {who}'s {kind} drafts.",
    "cuts_hashtags": "{owner} removes hashtags from {who}'s {kind} drafts.",
    "rewrites_subject": "{owner} rewrites the subject/title on {who}'s {kind} drafts; make it plainer and specific.",
    "changes_recipients": "{owner} changes the recipients on {who}'s {kind} drafts; double-check to/cc before queueing.",
}


def kind_words(kind):
    k, _, ch = kind.partition(":")
    base = {"email": "email", "resend_email": "email", "post": "post", "text": "text", "dm": "DM", "slack": "Slack"}.get(k, k)
    return f"{ch} {base}" if ch else base


def lesson(key, text, ids, entities, agent, kind, rule, evidence):
    fid = mem.make_id("l", *key)
    return {"id": fid, "title": text, "entities": sorted(set(entities)) or ["general"], "agent": agent, "kind": kind,
            "rule": rule, "items": sorted(ids), "evidence": evidence}


def distill(all_items, ledger):
    by_item = {i["id"]: i for i in all_items}
    owner = owner_name()
    out = []
    # Edits, per agent+kind, then across agents per kind.
    edited = [by_item[r["id"]] for r in ledger if r["decision"] == "edited" and r["id"] in by_item]
    for scope in ("agent", "all"):
        groups = collections.defaultdict(list)
        for it in edited:
            groups[(it.get("created_by") or "unknown") if scope == "agent" else "*", kind_label(it)].append(it)
        for (agent, kind), its in groups.items():
            traits = collections.defaultdict(list)
            for it in its:
                for t in edit_traits(it):
                    traits[t].append(it)
            for t, hits in traits.items():
                if len(hits) < MIN_EVIDENCE:
                    continue
                if scope == "all" and len({h.get("created_by") for h in hits}) < 2:
                    continue    # the per-agent lesson already says it
                pct = 0
                if t in ("shorter", "longer"):
                    ratios = [words(h.get("body")) / max(1, words(h["original"].get("body"))) for h in hits]
                    pct = round(abs(1 - sum(ratios) / len(ratios)) * 100)
                who = "every agent" if agent == "*" else agent
                text = TRAIT_TEXT[t].format(owner=owner, who=who, kind=kind_words(kind), pct=pct)
                text = text.replace("every agent's", "agents'")
                out.append(lesson(("edit", agent, kind, t), f"{text} ({len(hits)} of {len(its)} edits)",
                                  [h["id"] for h in hits], [h.get("entity") or "general" for h in hits], agent, kind, t,
                                  {"edit": len(hits)}))
    # Skips: a pattern per agent+kind, and each skip note the owner wrote.
    groups = collections.defaultdict(list)
    for r in ledger:
        groups[(r["agent"], r["kind"])].append(r)
    for (agent, kind), rows in groups.items():
        sk = [r for r in rows if r["decision"] == "skipped"]
        if len(sk) >= SKIP_PATTERN_MIN and len(sk) / len(rows) >= SKIP_PATTERN_RATE:
            out.append(lesson(("skip", agent, kind), f"{owner} skips most of {agent}'s {kind_words(kind)} drafts ({len(sk)} of "
                              f"{len(rows)}); ask before drafting more of these.", [r["id"] for r in sk],
                              [r["entity"] for r in sk], agent, kind, "skips_most", {"skip": len(sk)}))
    # Skip notes, grouped by what the owner wrote across agents. A note that repeats, or reads like a rule
    # ("too long", "no hook", "don't..."), is a lesson; a one-off "sent it from Gmail" is not.
    notes = collections.defaultdict(list)
    for r in ledger:
        if r["decision"] == "skipped" and r.get("note"):
            notes[mem.norm(r["note"])].append(r)
    for n, rs in notes.items():
        if len(rs) < MIN_EVIDENCE and not RULE_NOTE.search(rs[0]["note"]):
            continue
        agents, kinds = sorted({r["agent"] for r in rs}), {r["kind"] for r in rs}
        agent = agents[0] if len(agents) == 1 else "*"
        kind = kinds.pop() if len(kinds) == 1 else "*"
        what = "drafts" if kind == "*" else f"{kind_words(kind)} drafts"
        out.append(lesson(("skipnote", n), f"{owner} skipped {len(rs)} {what} from {', '.join(agents)}, noting: "
                          f"\"{mem.one_line(rs[0]['note'], 160)}\"",
                          [r["id"] for r in rs], [r["entity"] for r in rs], agent, kind, "skip_note", {"skip": len(rs)}))
    return out


def save_lessons(lessons, dry_run=False):
    state = read_json(LESSON_STATE, {})
    changed = []
    for l in lessons:
        body = (f"{l['title']}\n\nAgent: {l['agent']}. Kind: {l['kind']}. Rule: {l['rule']}.\n"
                f"Outbox items: {', '.join(l['items'])}.\nLearned by bin/outbox_learn.py from what the owner sent, edited or skipped.")
        if dry_run:
            changed.append(l["id"])
            continue
        tags = [t for t in (l["agent"] if l["agent"] != "*" else "", l["kind"], l["rule"]) if t]
        if mem.upsert(l["id"], l["title"], body, l["entities"], "lesson", "outbox", "learn.py", tags, "active", l["evidence"]):
            changed.append(l["id"])
        state[l["id"]] = {"items": l["items"], "updated": now_iso()}
    if not dry_run:
        write_json_atomic(LESSON_STATE, state)
    return changed


def run(dry_run=False, min_streak=STREAK):
    all_items = items()
    ledger, new = update_ledger(decisions(all_items), dry_run)
    st = stats(ledger)
    cand = candidates(st, min_streak)
    lessons = distill(all_items, ledger)
    changed = save_lessons(lessons, dry_run)
    if not dry_run:
        write_json_atomic(STATS, st)
        write_json_atomic(CANDIDATES, cand)
        mem.write_atomic(CANDIDATES_MD, candidates_md(cand))
        mem.rebuild_index()
    return {"ok": True, "decisions": len(ledger), "new_decisions": len(new), "overall": st["overall"],
            "lessons": [{"id": l["id"], "text": l["title"], "entities": l["entities"]} for l in lessons],
            "lessons_changed": len(changed), "autoapprove_candidates": len(cand["candidates"]), "dry_run": dry_run}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--streak", type=int, default=STREAK)
    a = ap.parse_args(argv)
    print(json.dumps(run(a.dry_run, max(2, a.streak)), ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
