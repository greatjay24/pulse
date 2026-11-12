#!/usr/bin/env python3
"""Learn how the owner likes things done, from what they do in Roo. Runs nightly before the
directors (nightly.py), next to sales_learn.

    learn.py                      collect new signals, summarize them, update memory/
    learn.py --dry-run            the same, but print the proposed preferences and write nothing
    learn.py --no-model           collect and log signals only (no summarizing)
    learn.py --set <id> --disabled true|false     Roo's toggle (never deletes a line)
    learn.py --list               preferences.json as JSON

Signals (all read from ~/portfolio, read-only):
  edit       an Outbox item the owner edited before sending: the agent's text (`original`,
             kept by outbox.py) against what they sent
  skip       an Outbox item they skipped, with their note
  approve    an Outbox item sent or approved without edits; a decision approved as-is
  reject     a decision they rejected, with their note
  discuss    a note they wrote on a decision
  said       their own words in Conversations (chat and interactive transcripts) that correct
             or steer: "don't...", "I prefer...", "stop...", "always..."
  sales_edit what they changed in a sales draft before sending (sales/outcomes.json)

Writes:
  memory/learnings.jsonl    every signal once (the raw log), keyed by a stable id
  memory/preferences.json   the curated list: {id, text, area, entity, evidence {type: n},
                            first_seen, last_seen, sources [signal ids], status active|superseded,
                            superseded_by, disabled}
  memory/preferences.md     what agents read: active, enabled preferences, rendered from the
                            JSON, plus the owner's own "## Added by ..." section kept verbatim
  memory/.learn_state.json  which signals were summarized
  then bin/outbox_learn.py  Outbox decisions -> outbox_stats.json, autoapprove_candidates.json,
                            and rule-based lessons in the shared store (memory/facts/l-*.md)
  then bin/memory_import.py  folds preferences.json, facts.md, Claude Code memory and the optional
                            tracker's notes.json into the shared store (memory/facts/), read-only on the sources

The summarizing step is one `claude -p --model haiku` call on the CLI's own sign-in (the owner's
subscription; API-key variables are removed from its environment), with no tools. It runs only
when the org's runner (portfolio.json "runner") is claude-code and the claude CLI is installed;
otherwise the signals are collected and logged, and the output says why nothing was summarized. It proposes
preference lines and says which existing line each one repeats or replaces. This script then
merges: a repeat adds evidence to the existing line, a replacement marks the old line
superseded, and nothing is ever deleted.

PORTFOLIO_ROOT overrides the org folder (default: the parent of this bin/).
"""
import argparse, collections, datetime, difflib, hashlib, json, os, pathlib, re, subprocess, sys, time

HOME = pathlib.Path.home()
# The org folder: PORTFOLIO_ROOT (tests), else the folder this bin/ lives in.
ORG = pathlib.Path(os.environ.get("PORTFOLIO_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
MEMORY = ORG / "memory"
LEARNINGS = MEMORY / "learnings.jsonl"
PREFS_JSON = MEMORY / "preferences.json"
PREFS_MD = MEMORY / "preferences.md"
STATE = MEMORY / ".learn_state.json"
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from live import clip, now_iso, owner_name, redact, write_json_atomic  # noqa: E402
import memory_import, outbox_learn  # noqa: E402

MODEL = "haiku"
MAX_SIGNALS = 60          # per summarizing call, newest first
MAX_APPROVALS = 15        # approvals are weak evidence; don't let them crowd out edits
SNIPPET = 300
OWN_HEADING = re.compile(r"^## Added by[^\n]*$", re.M)     # the owner's own lines in preferences.md
# Variables that would bill an API key or route to another provider instead of the CLI's sign-in.
BILLING_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_BEDROCK_BASE_URL",
               "ANTHROPIC_VERTEX_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
               "CLAUDE_CODE_USE_FOUNDRY")
SUMMARIZE_TIMEOUT = 300
SAID = re.compile(r"\b(don'?t|do not|never|stop|always|i prefer|prefer|i'?d rather|rather than|instead|"
                  r"too (?:long|short|formal|wordy|salesy|much)|no more|from now on|i like|i don'?t like|"
                  r"i want you to|make sure|please (?:don'?t|stop|always|keep|use))\b", re.I)
EVIDENCE_WORDS = {
    "edit": ("edited {n} item", "edited {n} items"), "sales_edit": ("edited {n} sales draft", "edited {n} sales drafts"),
    "skip": ("skipped {n} item", "skipped {n} items"), "reject": ("rejected {n} decision", "rejected {n} decisions"),
    "discuss": ("said so on {n} decision", "said so on {n} decisions"), "said": ("said so {n} time", "said so {n} times"),
    "approve": ("approved {n} as-is", "approved {n} as-is"),
}


def sid(*parts):
    return hashlib.sha1("\x1f".join(str(p) for p in parts).encode()).hexdigest()[:12]


def read_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return default


def read_jsonl(path):
    out = []
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return out
    for line in lines:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def queued_reason(why):
    """The reason a draft was queued, without its "BEFORE SENDING:" to-dos. Those belonged to the
    dropped draft; kept in a lesson, Roo later read them as open work."""
    return re.split(r"\s*BEFORE SENDING\b", str(why or ""), maxsplit=1)[0]


def text(s, n=SNIPPET):
    return clip(redact(" ".join(str(s or "").split())), n)


# --------------------------------------------------------------------------
# Signals
# --------------------------------------------------------------------------

def sentences(s):
    return [x.strip() for x in re.split(r"(?<=[.!?])\s+|\n+", s or "") if x.strip()]


def diff_text(before, after):
    """What the owner cut and added, sentence by sentence."""
    a, b = sentences(before), sentences(after)
    cut, added = [], []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if op in ("delete", "replace"):
            cut += a[i1:i2]
        if op in ("insert", "replace"):
            added += b[j1:j2]
    return cut, added


def outbox_signals():
    out = []
    for f in sorted((ORG / "outbox").glob("*.json")) if (ORG / "outbox").is_dir() else []:
        item = read_json(f, None)
        if not isinstance(item, dict):
            continue
        iid, kind = item.get("id") or f.stem, item.get("kind") or "email"
        where = f"{kind}" + (f" on {item['channel']}" if item.get("channel") else "")
        base = {"entity": item.get("entity"), "source": f"outbox/{iid}", "by": item.get("created_by")}
        status = item.get("status")
        if (item.get("created_by") or "").endswith("builder") or "dry run" in (item.get("subject") or "").lower():
            continue     # test items
        original = item.get("original") if isinstance(item.get("original"), dict) else {}
        if original:
            parts = []
            for field, before in original.items():
                after = item.get(field)
                if isinstance(before, list) or isinstance(after, list):
                    parts.append(f"{field}: {before} -> {after}")
                    continue
                cut, added = diff_text(str(before or ""), str(after or ""))
                if field == "body":
                    parts.append(f"cut: {' | '.join(text(c, 160) for c in cut[:6]) or '-'}; "
                                 f"added: {' | '.join(text(c, 160) for c in added[:6]) or '-'}; "
                                 f"length {len(str(before or '').split())} -> {len(str(after or '').split())} words")
                else:
                    parts.append(f"{field}: {text(before, 120)!r} -> {text(after, 120)!r}")
            out.append({**base, "id": sid("edit", iid, item.get("edited_at")), "type": "edit", "at": item.get("edited_at"),
                        "text": text(f"Edited a {where} ({text(item.get('subject'), 80)}) before sending. " + "; ".join(parts), 900)})
        elif item.get("edited_at"):
            out.append({**base, "id": sid("edit", iid, item.get("edited_at")), "type": "edit", "at": item.get("edited_at"),
                        "text": text(f"Edited a {where} ({text(item.get('subject'), 80)}) before sending (no copy of the agent's text kept).")})
        if status == "skipped":
            note = next((h.get("what", "")[len("skipped in Pulse"):].lstrip(": ") for h in reversed(item.get("history") or [])
                         if str(h.get("what", "")).startswith("skipped in Pulse")), "")
            out.append({**base, "id": sid("skip", iid), "type": "skip", "at": item.get("skipped_at"),
                        "text": text(f"Skipped a {where} ({text(item.get('subject'), 80)}). Why it was queued: {text(queued_reason(item.get('why')), 160)}. "
                                     f"Their note: {note or '(none)'}")})
        elif status in ("sent", "approved", "published") and not item.get("edited_at"):
            out.append({**base, "id": sid("approve", iid), "type": "approve",
                        "at": item.get("sent_at") or item.get("approved_at") or item.get("published_at"),
                        "text": text(f"Sent a {where} exactly as the agent wrote it ({text(item.get('subject'), 80)}).")})
    return out


def entities():
    reg = read_json(ORG / "portfolio.json", {})
    return [e for e in reg.get("entities", []) if isinstance(e, dict) and e.get("id") and e.get("path")]


def decision_signals():
    out = []
    for e in entities():
        for i, r in enumerate(read_jsonl(ORG / e["path"] / "decisions.jsonl")):
            a, note = r.get("action"), (r.get("note") or "").strip()
            ask = text(r.get("ask") or r.get("id"), 120)
            base = {"entity": e["id"], "source": f"{e['path']}/decisions.jsonl#{r.get('id')}", "at": r.get("at"),
                    "id": sid("decision", e["id"], r.get("id"), a, r.get("at"), i)}
            if a == "reject":
                out.append({**base, "type": "reject", "text": text(f"Rejected the decision \"{ask}\" (recommended: "
                                                                     f"{text(r.get('recommend'), 80)}). Their note: {note or '(none)'}")})
            elif a == "discuss" and note:
                out.append({**base, "type": "discuss", "text": text(f"On the decision \"{ask}\" they wrote: {note}", 600)})
            elif a == "approve" and not note:
                out.append({**base, "type": "approve", "text": text(f"Approved \"{ask}\" as recommended ({text(r.get('recommend'), 80)}).")})
            elif a == "approve" and note:
                out.append({**base, "type": "discuss", "text": text(f"Approved \"{ask}\" with a note: {note}", 600)})
    return out


def conversation_signals():
    out = []
    folder = ORG / "logs" / "transcripts"
    for f in sorted(folder.glob("*.jsonl")) if folder.is_dir() else []:
        start = None
        for i, x in enumerate(read_jsonl(f)):
            if x.get("t") == "start":
                start = x
                if start.get("kind") not in ("chat", "interactive"):
                    break
            elif x.get("t") == "user" and start and SAID.search(x.get("text") or ""):
                words = x.get("text") or ""
                if len(words) > 1200:       # a pasted document, not a correction
                    continue
                out.append({"id": sid("said", f.stem, i), "type": "said", "at": x.get("at"), "entity": start.get("entity"),
                            "by": start.get("agent"), "source": f"logs/transcripts/{f.name}",
                            "text": text(f"Told {start.get('agent')}: {words}", 600)})
    return out


def sales_signals():
    out = []
    for e in entities():
        outcomes = read_json(ORG / e["path"] / "sales" / "outcomes.json", {})
        for key, o in (outcomes.items() if isinstance(outcomes, dict) else []):
            ed = o.get("edit") if isinstance(o, dict) else None
            if not isinstance(ed, dict) or (ed.get("similarity") or 1) >= 0.98:
                continue
            bits = [f"cut: {' | '.join(text(c, 120) for c in (ed.get('cut') or [])[:4]) or '-'}",
                    f"added: {' | '.join(text(c, 120) for c in (ed.get('added') or [])[:4]) or '-'}",
                    f"{ed.get('draft_words')} -> {ed.get('sent_words')} words"]
            out.append({"id": sid("sales_edit", e["id"], key), "type": "sales_edit", "at": o.get("sent_at"), "entity": e["id"],
                        "source": f"{e['path']}/sales/outcomes.json#{key}",
                        "text": text("Edited a sales email before sending. " + "; ".join(bits), 700)})
    return out


def collect():
    sigs = outbox_signals() + decision_signals() + conversation_signals() + sales_signals()
    seen, out = set(), []
    for s in sigs:
        if s["id"] not in seen:
            seen.add(s["id"])
            out.append(s)
    return out


# --------------------------------------------------------------------------
# Summarizing (haiku, no tools)
# --------------------------------------------------------------------------

SYSTEM = (
    "You keep a short list of how a business owner likes their agents to work. You read signals from what they did "
    "(edits they made to drafts, items they skipped or rejected, notes, corrections they typed, things they approved as-is) "
    "and propose preference lines. Rules: only propose a preference the signals actually support; a single "
    "approval proves nothing on its own; ignore one-off content (names, dates, a specific deal) and write the "
    "general habit behind it. Each line is one short sentence starting with Prefers / Wants / Doesn't want / "
    "Always / Never, plain words, at most 110 characters, no names of people or companies. If a signal repeats an "
    "existing preference, set same_as to its id. If it contradicts one, set replaces to its id. Return JSON only."
)
SCHEMA = {
    "type": "object",
    "properties": {"preferences": {"type": "array", "items": {
        "type": "object",
        "properties": {"text": {"type": "string"}, "area": {"type": "string"},
                       "entity": {"type": ["string", "null"]}, "signal_ids": {"type": "array", "items": {"type": "string"}},
                       "same_as": {"type": ["string", "null"]}, "replaces": {"type": ["string", "null"]}},
        "required": ["text", "area", "signal_ids"]}}},
    "required": ["preferences"],
}


def prompt_for(signals, prefs):
    current = [{"id": p["id"], "text": p["text"], "area": p.get("area")} for p in prefs if p.get("status") == "active"]
    rows = [{"id": s["id"], "type": s["type"], "entity": s.get("entity"), "at": (s.get("at") or "")[:10], "text": s["text"]}
            for s in signals]
    return ("Existing preferences (JSON):\n" + json.dumps(current, ensure_ascii=False) +
            "\n\nNew signals (JSON):\n" + json.dumps(rows, ensure_ascii=False) +
            "\n\nPropose preferences. area is one short word (email, grants, posts, sales, decisions, code, reports, "
            "general). entity is the business id when the habit is specific to one, else null.")


def model_unavailable():
    """None when the summarizing step can run, else why not (it needs Claude Code)."""
    try:
        import runners
        name = runners.resolve(read_json(ORG / "portfolio.json", {}))["name"]
    except Exception as ex:
        return f"runner config: {type(ex).__name__}"
    if name != "claude-code":
        return f"summarizing needs the claude-code runner (this org runs on {name}); signals were logged only"
    if not claude_binary():
        return "the claude CLI isn't installed; signals were logged only"
    return None


def claude_binary():
    if os.environ.get("PULSE_CLAUDE"):
        return os.environ["PULSE_CLAUDE"]
    import runners
    return runners.ClaudeCode().find()


def summarize(signals, prefs):
    """Runs haiku once on the claude CLI's own sign-in, with no tools. Returns the proposed list."""
    from live import LiveRun
    cmd = [claude_binary(), "-p", "--model", MODEL, "--tools", "", "--strict-mcp-config", "--disable-slash-commands",
           "--no-session-persistence", "--system-prompt", SYSTEM, "--json-schema", json.dumps(SCHEMA),
           "--output-format", "json", "--max-turns", "3"]
    env = {k: v for k, v in os.environ.items() if k not in BILLING_ENV}
    message = prompt_for(signals, prefs)
    with LiveRun("learn", "learn", doing=f"Learning from {len(signals)} signals", prompt="learn.py summarizing pass") as live:
        env["PORTFOLIO_RUN_ID"] = live.run_id
        t0 = time.time()
        final, err = None, ""
        try:
            p = subprocess.run(cmd, input=message, env=env, cwd=str(ORG), capture_output=True, text=True,
                               timeout=SUMMARIZE_TIMEOUT)
            err = redact((p.stderr or "")[-800:])
            final = json.loads(p.stdout or "null")
        except subprocess.TimeoutExpired:
            err = f"timeout after {SUMMARIZE_TIMEOUT}s"
        except (OSError, json.JSONDecodeError) as ex:
            err = err or f"{type(ex).__name__}: {ex}"
        if not isinstance(final, dict) or final.get("is_error"):
            why = err or (final or {}).get("result") or "no result"
            live.finish(False, why, secs=int(time.time() - t0), append_result=True)
            raise RuntimeError(f"summarizer failed: {why}")
        live.finish(True, "Proposed preferences", final.get("total_cost_usd"), int(time.time() - t0), append_result=True)
    data = final.get("structured_output")
    if not isinstance(data, dict):
        data = json.loads(final.get("result") or "{}")
    return [p for p in data.get("preferences") or [] if isinstance(p, dict) and (p.get("text") or "").strip()]


# --------------------------------------------------------------------------
# Merging: never delete, mark superseded
# --------------------------------------------------------------------------

def norm(s):
    return re.sub(r"[^a-z0-9 ]+", "", (s or "").lower()).strip()


def evidence_line(evidence):
    parts = []
    for kind in ("edit", "sales_edit", "skip", "reject", "discuss", "said", "approve"):
        n = evidence.get(kind) or 0
        if n:
            one, many = EVIDENCE_WORDS[kind]
            parts.append((one if n == 1 else many).format(n=n))
    return ", ".join(parts) or "seen once"


def day_label(iso):
    try:
        d = datetime.date.fromisoformat((iso or "")[:10])
    except ValueError:
        return ""
    return f"{d:%b} {d.day}"


def merge(prefs, proposed, signals, today=None):
    """Folds proposed lines into prefs (in place). Returns the list of changes."""
    today = today or datetime.date.today().isoformat()
    by_id = {p["id"]: p for p in prefs}
    sig = {s["id"]: s for s in signals}
    changes = []
    for p in proposed:
        sources = [x for x in p.get("signal_ids") or [] if x in sig]
        if not sources:
            continue    # a line nothing supports
        ev = collections.Counter(sig[x]["type"] for x in sources)
        if set(ev) == {"approve"} and len(sources) < 3:
            continue    # approvals alone are weak
        target = by_id.get(p.get("same_as") or "")
        if target is None and not p.get("replaces"):      # the model missed a duplicate: catch near-identical wording
            target = next((q for q in prefs if q.get("status") == "active" and
                           difflib.SequenceMatcher(a=norm(q["text"]), b=norm(p["text"])).ratio() >= 0.85), None)
        if target is not None and target.get("status") == "active":
            new = [x for x in sources if x not in target["sources"]]
            if not new:
                continue
            target["sources"] += new
            for x in new:
                target["evidence"][sig[x]["type"]] = target["evidence"].get(sig[x]["type"], 0) + 1
            target["last_seen"] = today
            changes.append({"what": "strengthened", "id": target["id"], "text": target["text"]})
            continue
        pid = "p-" + hashlib.sha1(norm(p["text"]).encode()).hexdigest()[:6]
        if pid in by_id:
            continue
        line = {"id": pid, "text": clip(" ".join(p["text"].split()), 140), "area": (p.get("area") or "general")[:20],
                "entity": p.get("entity") or None, "evidence": dict(ev), "first_seen": today, "last_seen": today,
                "sources": sources, "status": "active", "superseded_by": None, "disabled": False}
        old = by_id.get(p.get("replaces") or "")
        if old is not None and old.get("status") == "active":
            old.update(status="superseded", superseded_by=pid, superseded_at=today)
            changes.append({"what": "superseded", "id": old["id"], "text": old["text"], "by": pid})
        prefs.append(line)
        by_id[pid] = line
        changes.append({"what": "added", "id": pid, "text": line["text"]})
    return changes


def render(prefs, own=""):
    owner = owner_name()
    active = [p for p in prefs if p.get("status") == "active" and not p.get("disabled")]
    active.sort(key=lambda p: (-sum(p["evidence"].values()), p["area"], p["text"]))
    by_area = collections.OrderedDict()
    for p in active:
        by_area.setdefault(p["area"], []).append(p)
    heading = f"## Added by {owner}"
    lines = [f"# How {owner} likes things done", "",
             "Learned from what the owner edits, skips, rejects and tells agents (bin/learn.py, nightly). Every agent",
             "reads this at session start. Follow it unless the task or OWNER.md says otherwise; the owner's rules file",
             "and OPERATING.md guardrails always win. Generated from preferences.json: turn lines on or off in Roo",
             f"(Settings > What Roo has learned), and add your own under \"{heading[3:]}\".", ""]
    if not active:
        lines += ["Nothing learned yet.", ""]
    for area, ps in by_area.items():
        lines.append(f"## {area.capitalize()}")
        for p in ps:
            scope = f"[{p['entity']}] " if p.get("entity") else ""
            lines.append(f"- {scope}{p['text']} ({evidence_line(p['evidence'])}, {day_label(p['last_seen'])}) `{p['id']}`")
        lines.append("")
    lines += [heading, own.strip() or "(none yet)", ""]
    return "\n".join(lines)


def own_section():
    try:
        md = PREFS_MD.read_text()
    except OSError:
        return ""
    m = OWN_HEADING.search(md)
    if not m:
        return ""
    body = md[m.end():].strip()
    return "" if body == "(none yet)" else body


def load_prefs():
    data = read_json(PREFS_JSON, {})
    prefs = data.get("preferences") if isinstance(data, dict) else None
    return prefs if isinstance(prefs, list) else []


def save(prefs):
    MEMORY.mkdir(parents=True, exist_ok=True)
    write_json_atomic(PREFS_JSON, {"updated": now_iso(), "preferences": prefs})
    tmp = PREFS_MD.with_name(f".{PREFS_MD.name}.{os.getpid()}.tmp")
    tmp.write_text(render(prefs, own_section()))
    os.replace(tmp, PREFS_MD)


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def pick(signals, done):
    new = [s for s in signals if s["id"] not in done]
    new.sort(key=lambda s: s.get("at") or "", reverse=True)
    strong = [s for s in new if s["type"] != "approve"]
    weak = [s for s in new if s["type"] == "approve"][:MAX_APPROVALS]
    return (strong + weak)[:MAX_SIGNALS]


def learn(dry_run=False, use_model=True, summarizer=None):
    signals = collect()
    logged = {r.get("id") for r in read_jsonl(LEARNINGS)}
    fresh = [s for s in signals if s["id"] not in logged]
    state = read_json(STATE, {})
    done = set(state.get("summarized") or [])
    batch = pick(signals, done)
    prefs = load_prefs()
    proposed, changes, skipped_why = [], [], None
    if use_model and summarizer is None:
        skipped_why = model_unavailable()
        use_model = skipped_why is None
    if use_model and batch and any(s["type"] != "approve" for s in batch):
        proposed = (summarizer or summarize)(batch, prefs)
        changes = merge(prefs, proposed, batch)
    out = {"ok": True, "signals": len(signals), "new_signals": len(fresh), "summarized": len(batch) if use_model else 0,
           "by_type": dict(collections.Counter(s["type"] for s in signals)), "proposed": proposed, "changes": changes,
           "dry_run": dry_run}
    if skipped_why:
        out["model"] = skipped_why
    out["outbox"] = shared_memory_step(lambda: outbox_learn.run(dry_run=dry_run))
    if dry_run:
        return out
    MEMORY.mkdir(parents=True, exist_ok=True)
    if fresh:
        with LEARNINGS.open("a") as f:
            for s in fresh:
                f.write(json.dumps({**s, "logged_at": now_iso()}, ensure_ascii=False) + "\n")
    if use_model:
        write_json_atomic(STATE, {"summarized": sorted(done | {s["id"] for s in batch}), "last_run": now_iso()})
    save(prefs)
    out["memory_sync"] = shared_memory_step(memory_import.run)
    return out


def shared_memory_step(fn):
    """Outbox lessons and the shared-store sync (bin/memory.py). Never raises: a failure here must not
    lose the preferences learned above."""
    try:
        res = fn()
        return {k: v for k, v in res.items() if k not in ("lessons", "written")} | {"lessons": len(res.get("lessons") or [])}
    except Exception as ex:
        return {"ok": False, "error": f"{type(ex).__name__}: {redact(str(ex))}"}


def set_disabled(pid, disabled):
    prefs = load_prefs()
    for p in prefs:
        if p.get("id") == pid:
            p["disabled"] = bool(disabled)
            p["toggled_at"] = now_iso()
            save(prefs)
            return {"ok": True, "id": pid, "disabled": p["disabled"]}
    return {"ok": False, "error": f"no preference {pid}"}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-model", action="store_true")
    ap.add_argument("--set")
    ap.add_argument("--disabled", choices=("true", "false"))
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args(argv)
    if a.set:
        if not re.match(r"^p-[0-9a-f]{6}$", a.set) or a.disabled is None:
            print(json.dumps({"ok": False, "error": "--set needs a preference id and --disabled true|false"}))
            return 2
        res = set_disabled(a.set, a.disabled == "true")
    elif a.list:
        res = {"ok": True, "preferences": load_prefs()}
    else:
        try:
            res = learn(dry_run=a.dry_run, use_model=not a.no_model)
        except Exception as ex:
            res = {"ok": False, "error": f"{type(ex).__name__}: {redact(str(ex))}"}
    print(json.dumps(res, indent=2 if a.dry_run else None, ensure_ascii=False))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
