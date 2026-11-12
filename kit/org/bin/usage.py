#!/usr/bin/env python3
"""Where the Claude plan's usage goes: one row per agent run and per Claude Code session.

    usage.py                 rebuild logs/usage/usage.json and print a one-line summary
    usage.py --no-sessions   runner logs only (skip ~/.claude/projects)
    usage.py --print         print the whole usage.json instead

Claude Code runs on the owner's subscription. Dollar figures are API-equivalent
estimates (what the same tokens would cost on the API), never charges. What matters is
the share of the plan's limits, so the output carries both:

  plan      the plan's own 5-hour and weekly utilization, as Claude Code reported it in the
            last headless run's `rate_limit_event` (logs/usage/plan.json, kept by live.py).
            Real numbers from Anthropic, but only as fresh as the last run.
  windows   our estimate: API-equivalent cost and tokens in the last 5 hours and 7 days,
            from our own logs, against the soft budgets in portfolio.json "usage".

Sources (read-only):
  logs/transcripts/<run_id>.jsonl   start + result lines of every runner run (nightly, weekly,
                                    act, chat, watch, check). Since tokens were added the
                                    result line carries tokens, by_model and session_id.
  ~/.claude/projects/**/*.jsonl     Claude Code's own session files. Only these fields of
                                    assistant lines are read: message.id, message.model,
                                    message.usage, timestamp, sessionId, entrypoint, cwd.
                                    No message content is read into memory or written out.

A session that belongs to a runner run (same session id, or a headless session that started
within a minute of a runner run with no session id on record) is not counted twice: its
tokens fill in the runner row when that row has none.

Rows: {id, run_id, source runner|session, kind, entity, agent, doing, started, ended, secs,
ok, cost_usd, cost_basis reported|estimated, tokens{input,output,cache_read,cache_write},
by_model{model: {..tokens, cost_usd}}, hours{hour ISO: cost_usd}}. `kind` is the runner's
(nightly, weekly, act, chat, watch, check), `interactive` for the owner's own sessions, or
`headless` for other `claude -p` runs (bots, scripts). Runs on codex or opencode show the
tokens and cost those CLIs reported; nothing is estimated for them.

PORTFOLIO_ROOT overrides the org folder (default: the parent of this bin/) and
CLAUDE_PROJECTS_DIR ~/.claude/projects (tests only).
"""
import argparse, collections, datetime, json, os, pathlib, sys

HOME = pathlib.Path.home()
ORG = pathlib.Path(os.environ.get("PORTFOLIO_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
LOGS = ORG / "logs"
TRANSCRIPTS = LOGS / "transcripts"
USAGE = LOGS / "usage"
PROJECTS = pathlib.Path(os.environ.get("CLAUDE_PROJECTS_DIR") or HOME / ".claude" / "projects")
TOKEN_KEYS = ("input", "output", "cache_read", "cache_write")
MATCH_SECS = 60               # a headless session this close to a runner run's start is that run
PLAN_STALE_SECS = 6 * 3600    # older plan readings are shown, flagged as stale
WINDOWS = (("five_hour", 5 * 3600), ("seven_day", 7 * 86400))

# API-equivalent $ per million tokens, used only where Claude Code didn't report a cost
# (interactive sessions). Calibrated against Claude Code's own costUSD for each model on
# 2026-10-29. portfolio.json "usage.prices_per_mtok" overrides any of them.
PRICES = {
    "opus": {"input": 4.0, "output": 20.0, "cache_read": 0.2, "cache_write_5m": 5.0, "cache_write_1h": 8.0},
    "sonnet": {"input": 2.0, "output": 10.0, "cache_read": 0.1, "cache_write_5m": 2.5, "cache_write_1h": 4.0},
    "haiku": {"input": 0.1, "output": 0.5, "cache_read": 0.01, "cache_write_5m": 0.125, "cache_write_1h": 0.2},
}
DEFAULT_USAGE = {"five_hour_budget_usd": None, "weekly_budget_usd": None, "warn_at": 0.8}


def now():
    return datetime.datetime.now().astimezone()


def parse_iso(s):
    try:
        d = datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.astimezone()


def iso(d):
    return d.astimezone().isoformat(timespec="seconds") if d else None


def hour_of(d):
    return iso(d.astimezone().replace(minute=0, second=0, microsecond=0))


def zero():
    return {k: 0 for k in TOKEN_KEYS}


def add_tokens(a, b):
    for k in TOKEN_KEYS:
        a[k] = a.get(k, 0) + int((b or {}).get(k) or 0)
    return a


def total(t):
    return sum(int((t or {}).get(k) or 0) for k in TOKEN_KEYS)


# --------------------------------------------------------------------------
# Config and prices
# --------------------------------------------------------------------------

def config():
    try:
        reg = json.loads((ORG / "portfolio.json").read_text())
    except (OSError, json.JSONDecodeError):
        reg = {}
    u = reg.get("usage") if isinstance(reg.get("usage"), dict) else {}
    out = {**DEFAULT_USAGE, **{k: u[k] for k in DEFAULT_USAGE if k in u}}
    prices = {fam: dict(p) for fam, p in PRICES.items()}
    for model, p in (u.get("prices_per_mtok") or {}).items():
        if isinstance(p, dict):
            prices[str(model)] = {k: float(v) for k, v in p.items() if isinstance(v, (int, float))}
    out["prices"] = prices
    return out


def price_for(model, prices):
    m = (model or "").lower()
    if m in prices:
        return prices[m]
    for fam in ("opus", "sonnet", "haiku"):
        if fam in m and fam in prices:
            return prices[fam]
    return None


def estimate(model, t, prices):
    """API-equivalent $ for a model's tokens. t may split cache writes into cw5m/cw1h."""
    p = price_for(model, prices)
    if not p:
        return None
    cw1h = t.get("cw1h", 0)
    cw5m = t.get("cache_write", 0) - cw1h
    return (t.get("input", 0) * p.get("input", 0) + t.get("output", 0) * p.get("output", 0)
            + t.get("cache_read", 0) * p.get("cache_read", 0) + cw5m * p.get("cache_write_5m", 0)
            + cw1h * p.get("cache_write_1h", 0)) / 1e6


# --------------------------------------------------------------------------
# Runner runs: transcripts
# --------------------------------------------------------------------------

def runner_rows():
    """One row per runner transcript (start + result). Interactive org sessions
    (session-<id>.jsonl) come back separately as {session_id: start line}."""
    rows, interactive = [], {}
    if not TRANSCRIPTS.is_dir():
        return rows, interactive
    for f in sorted(TRANSCRIPTS.glob("*.jsonl")):
        start, result = None, None
        try:
            with f.open() as fh:
                for line in fh:
                    if '"t": "start"' not in line and '"t": "result"' not in line:
                        continue
                    try:
                        x = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if x.get("t") == "start" and start is None:
                        start = x
                    elif x.get("t") == "result":
                        result = x
        except OSError:
            continue
        if not start:
            continue
        if start.get("kind") == "interactive" or f.stem.startswith("session-"):
            interactive[f.stem[len("session-"):]] = start
            continue
        started = parse_iso(start.get("at"))
        ended = parse_iso((result or {}).get("at")) or started
        cost = (result or {}).get("cost_usd")
        by_model = (result or {}).get("by_model") or None
        tokens = (result or {}).get("tokens") or None
        rows.append({
            "id": f.stem, "run_id": f.stem, "source": "runner", "kind": start.get("kind") or "run",
            "entity": start.get("entity"), "agent": start.get("agent"), "doing": start.get("doing") or "",
            "started": iso(started), "ended": iso(ended), "secs": (result or {}).get("secs"),
            "ok": (result or {}).get("ok"), "cost_usd": cost if isinstance(cost, (int, float)) else None,
            "cost_basis": "reported" if isinstance(cost, (int, float)) else None,
            "tokens": tokens, "by_model": by_model, "models": (result or {}).get("models") or [],
            "session_id": (result or {}).get("session_id"),
        })
    return rows + older_runner_rows({r["run_id"] for r in rows}), interactive


def older_runner_rows(known):
    """Runs from before transcripts existed: logs/act-*.json and the nightly logs/<stamp>.json."""
    rows, lead_entity = [], {}
    try:
        reg = json.loads((ORG / "portfolio.json").read_text())
        lead_entity = {e.get("lead"): e.get("id") for e in reg.get("entities", [])}
    except (OSError, json.JSONDecodeError):
        pass

    def row(r, kind, started, ended, entity, doing, key):
        cost = r.get("cost_usd")
        return {"id": key, "run_id": None, "source": "runner", "kind": kind, "entity": entity,
                "agent": r.get("agent"), "doing": doing, "started": iso(started), "ended": iso(ended),
                "secs": r.get("secs"), "ok": r.get("ok"), "cost_usd": cost if isinstance(cost, (int, float)) else None,
                "cost_basis": "reported" if isinstance(cost, (int, float)) else None, "tokens": r.get("tokens"),
                "by_model": r.get("by_model"), "models": r.get("models") or [], "session_id": r.get("session_id")}

    for f in sorted(LOGS.glob("act-*.json")):
        try:
            r = json.loads(f.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(r, dict) or r.get("running") or r.get("run_id") in known:
            continue
        started = parse_iso(r.get("started"))
        if started:
            rows.append(row(r, "act", started, parse_iso(r.get("finished")) or started, r.get("entity"),
                            f"{str(r.get('action') or '').capitalize()}: {r.get('decision') or ''}".strip(), f.stem))
    for f in sorted(LOGS.glob("20*.json")):
        try:
            results = json.loads(f.read_text())
            ended = datetime.datetime.strptime(f.stem[:15], "%Y-%m-%d_%H%M").astimezone()
        except (OSError, json.JSONDecodeError, ValueError):
            continue
        for i, r in enumerate(results if isinstance(results, list) else []):
            if not isinstance(r, dict) or r.get("run_id") in known or "run_id" in r:
                continue
            started = ended - datetime.timedelta(seconds=r.get("secs") or 0)
            rows.append(row(r, "nightly", started, ended, lead_entity.get(r.get("agent")),
                            "Night shift", f"{f.stem}-{i}"))
    return rows


# --------------------------------------------------------------------------
# Claude Code sessions: usage numbers only
# --------------------------------------------------------------------------

def session_id_of(path, line_sid):
    # Subagent files live in <session>/subagents/; they count toward the parent session.
    if path.parent.name == "subagents":
        return path.parent.parent.name
    return line_sid or path.stem


def scan_sessions():
    """{session_id: {entrypoint, cwd, msgs: [(ts, model, tokens+cw1h)]}}, oldest message first.
    Each API message counts once, however many lines or files repeat it."""
    msgs = {}      # message id -> (sid, ts, model, tokens)
    meta = {}
    if not PROJECTS.is_dir():
        return {}
    for path in PROJECTS.rglob("*.jsonl"):
        try:
            fh = path.open("rb")
        except OSError:
            continue
        with fh:
            for raw in fh:
                if b'"usage"' not in raw or b'"assistant"' not in raw:
                    continue
                try:
                    d = json.loads(raw)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue
                if not isinstance(d, dict) or d.get("type") != "assistant":
                    continue
                m = d.get("message") if isinstance(d.get("message"), dict) else {}
                u = m.get("usage")
                ts = parse_iso(d.get("timestamp"))
                if not isinstance(u, dict) or not ts:
                    continue
                model = m.get("model") or "unknown"
                if model == "<synthetic>":
                    continue
                cc = u.get("cache_creation") if isinstance(u.get("cache_creation"), dict) else {}
                t = {"input": int(u.get("input_tokens") or 0), "output": int(u.get("output_tokens") or 0),
                     "cache_read": int(u.get("cache_read_input_tokens") or 0),
                     "cache_write": int(u.get("cache_creation_input_tokens") or 0),
                     "cw1h": int(cc.get("ephemeral_1h_input_tokens") or 0)}
                sid = session_id_of(path, d.get("sessionId"))
                key = m.get("id") or f"{sid}:{d.get('uuid')}"
                old = msgs.get(key)
                if old is None or t["output"] > old[3]["output"]:
                    msgs[key] = (old[0] if old else sid, min(ts, old[1]) if old else ts, model, t)
                if path.parent.name != "subagents":
                    s = meta.setdefault(sid, {"entrypoint": None, "cwd": None})
                    s["entrypoint"] = s["entrypoint"] or d.get("entrypoint")
                    s["cwd"] = s["cwd"] or d.get("cwd")
    out = {}
    for sid, ts, model, t in msgs.values():
        out.setdefault(sid, {**(meta.get(sid) or {"entrypoint": None, "cwd": None}), "msgs": []})["msgs"].append((ts, model, t))
    for s in out.values():
        s["msgs"].sort(key=lambda x: x[0])
    return out


def usage_from(msgs, prices):
    """(tokens, by_model, cost or None, hours{hour: cost}) for a list of session messages."""
    per_model, hours = {}, collections.defaultdict(float)
    tokens, cost, priced = zero(), 0.0, True
    for ts, model, t in msgs:
        mt = per_model.setdefault(model, {**zero(), "cw1h": 0})
        add_tokens(mt, t)
        mt["cw1h"] += t["cw1h"]
        add_tokens(tokens, t)
        c = estimate(model, t, prices)
        priced = priced and c is not None
        cost += c or 0
        hours[hour_of(ts)] += c or 0
    by_model = {}
    for model, t in per_model.items():
        c = estimate(model, t, prices)
        by_model[model] = {**{k: t[k] for k in TOKEN_KEYS}, "cost_usd": round(c, 6) if c is not None else None}
    return tokens, by_model, (round(cost, 6) if priced or cost else None), {h: round(c, 6) for h, c in hours.items()}


def session_row(sid, s, msgs, prices, kind, start=None):
    tokens, by_model, cost, hours = usage_from(msgs, prices)
    cwd = s.get("cwd") or ""
    project = ("~/" + str(pathlib.Path(cwd).relative_to(HOME))) if cwd.startswith(str(HOME) + "/") else (cwd or None)
    start = start or {}
    first, last = msgs[0][0], msgs[-1][0]
    return {
        "id": f"session-{sid}" if len(msgs) == len(s["msgs"]) else f"session-{sid}-{int(first.timestamp())}",
        "run_id": f"session-{sid}" if start else None, "source": "session", "kind": kind,
        "entity": start.get("entity"), "agent": start.get("agent"),
        "doing": start.get("doing") or (f"Claude Code in {project}" if project else "Claude Code session"),
        "started": iso(first), "ended": iso(last), "secs": int((last - first).total_seconds()), "ok": None,
        "cost_usd": cost, "cost_basis": "estimated", "tokens": tokens, "by_model": by_model,
        "models": sorted(by_model), "session_id": sid, "project": project, "hours": hours,
    }


def live_session_ids():
    """run_id -> session_id from live files (chat runs kept it before transcripts did)."""
    out = {}
    for f in (LOGS / "live").glob("*.json") if (LOGS / "live").is_dir() else []:
        try:
            sid = json.loads(f.read_text()).get("session_id")
        except (OSError, json.JSONDecodeError, AttributeError):
            continue
        if isinstance(sid, str) and sid:
            out[f.stem] = sid
    return out


def merge(runs, sessions, interactive, prices):
    """Runner rows plus session rows, each API call counted once. A session can hold several
    runs (a resumed chat): its messages go to the run whose time span holds them."""
    from_live = live_session_ids()
    for r in runs:
        r["session_id"] = r.get("session_id") or from_live.get(r["run_id"])
    claims = collections.defaultdict(list)
    for r in runs:
        if r.get("session_id") in sessions:
            claims[r["session_id"]].append(r)
    # Older runner runs without a session id: pair each with the headless session that began
    # within a minute of it, best cost match first (parallel nightly runs start together).
    pairs = []
    for r in runs:
        if r.get("session_id") or not r.get("started"):
            continue
        start = parse_iso(r["started"])
        for sid, s in sessions.items():
            if sid in claims or not str(s.get("entrypoint") or "").startswith("sdk"):
                continue
            gap = abs((s["msgs"][0][0] - start).total_seconds())
            if gap <= MATCH_SECS:
                est = usage_from(s["msgs"], prices)[2] or 0
                miss = abs((r.get("cost_usd") or 0) - est) / max(r.get("cost_usd") or 0, est, 0.001)
                pairs.append((miss if r.get("cost_usd") is not None else 1.0, gap, r["id"], sid, r))
    taken = set()
    for _, _, rid, sid, r in sorted(pairs, key=lambda p: p[:4]):
        if rid in taken or sid in claims:
            continue
        taken.add(rid)
        r["session_id"] = sid
        claims[sid].append(r)

    rows = list(runs)
    slack = datetime.timedelta(seconds=MATCH_SECS)
    for sid, s in sessions.items():
        left = s["msgs"]
        mine_runs = sorted(claims.get(sid, []), key=lambda r: r["started"])
        for i, r in enumerate(mine_runs):
            lo, hi = parse_iso(r["started"]) - slack, parse_iso(r["ended"] or r["started"]) + slack
            if i + 1 < len(mine_runs):      # a resumed chat's next run starts where this one stops
                hi = min(hi, parse_iso(mine_runs[i + 1]["started"]))
            mine = [m for m in left if lo <= m[0] <= hi]
            left = [m for m in left if not (lo <= m[0] <= hi)]
            if mine and not r.get("tokens"):
                tokens, by_model, cost, _ = usage_from(mine, prices)
                r["tokens"], r["by_model"] = tokens, by_model
                r["models"] = r.get("models") or sorted(by_model)
                if r.get("cost_usd") is None:
                    r["cost_usd"], r["cost_basis"] = cost, "estimated"
                elif len(by_model) == 1:
                    next(iter(by_model.values()))["cost_usd"] = r["cost_usd"]
        if not left:
            continue
        headless = str(s.get("entrypoint") or "").startswith("sdk")
        if claims.get(sid) and headless:
            continue    # a runner's own session: what falls outside its runs is startup noise
        kind = "headless" if headless else "interactive"
        rows.append(session_row(sid, s, left, prices, kind, interactive.get(sid) if kind == "interactive" else None))
    for r in rows:
        if "hours" not in r:
            at = parse_iso(r.get("ended") or r.get("started"))
            r["hours"] = {hour_of(at): r["cost_usd"] or 0} if at else {}
        if r.get("tokens") and not r.get("by_model") and len(r.get("models") or []) == 1:
            r["by_model"] = {r["models"][0]: {**r["tokens"], "cost_usd": r.get("cost_usd")}}
    rows.sort(key=lambda r: r.get("started") or "", reverse=True)
    return rows


# --------------------------------------------------------------------------
# Windows, plan, budgets
# --------------------------------------------------------------------------

def windows(rows, cfg, at=None):
    """Rolling 5-hour and 7-day totals from our logs (hour buckets), against the budgets."""
    at = at or now()
    out = {}
    budgets = {"five_hour": cfg.get("five_hour_budget_usd"), "seven_day": cfg.get("weekly_budget_usd")}
    for name, secs in WINDOWS:
        since = at - datetime.timedelta(seconds=secs)
        cost, runs, tokens = 0.0, 0, zero()
        for r in rows:
            # An hour bucket counts when any of it falls inside the window.
            inside = [(h, c) for h, c in (r.get("hours") or {}).items()
                      if parse_iso(h) and parse_iso(h) + datetime.timedelta(hours=1) > since and parse_iso(h) <= at]
            if not inside:
                continue
            share = sum(c for _, c in inside)
            cost += share
            runs += 1
            whole = sum((r.get("hours") or {}).values()) or 0
            frac = (share / whole) if whole else 1.0
            for k in TOKEN_KEYS:
                tokens[k] += int(((r.get("tokens") or {}).get(k) or 0) * frac)
        budget = budgets[name]
        used = (cost / budget) if isinstance(budget, (int, float)) and budget > 0 else None
        out[name] = {"since": iso(since), "cost_usd": round(cost, 4), "tokens": tokens, "runs": runs,
                     "budget_usd": budget, "used": round(used, 4) if used is not None else None,
                     "warn": used is not None and used >= cfg.get("warn_at", 0.8)}
    return out


def plan(cfg, at=None):
    at = at or now()
    try:
        p = json.loads((USAGE / "plan.json").read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(p, dict) or not isinstance(p.get("windows"), dict):
        return None
    taken = parse_iso(p.get("at"))
    p["age_secs"] = int((at - taken).total_seconds()) if taken else None
    p["stale"] = p["age_secs"] is None or p["age_secs"] > PLAN_STALE_SECS
    for w in p["windows"].values():
        resets = parse_iso(w.get("resets_at"))
        w["reset_passed"] = bool(resets and resets <= at)   # the reading is from an earlier window
        w["warn"] = (not w["reset_passed"]) and (w.get("utilization") or 0) >= cfg.get("warn_at", 0.8)
    return p


def implied_budgets(rows, cfg, reading):
    """What a full window would be in API-equivalent dollars, judging by the plan's own
    reading and our logged cost over the same window. A hint for setting the soft budgets."""
    taken = parse_iso((reading or {}).get("at"))
    if not taken:
        return {}
    ours = windows(rows, {**cfg, "five_hour_budget_usd": None, "weekly_budget_usd": None}, taken)
    out = {}
    for name in ("five_hour", "seven_day"):
        u = ((reading.get("windows") or {}).get(name) or {}).get("utilization")
        if isinstance(u, (int, float)) and u >= 0.05 and ours[name]["cost_usd"] > 0:
            out[name] = round(ours[name]["cost_usd"] / u, 2)
    return out


def build(with_sessions=True):
    cfg = config()
    runs, interactive = runner_rows()
    sessions = scan_sessions() if with_sessions else {}
    rows = merge(runs, sessions, interactive, cfg["prices"])
    at = now()
    reading = plan(cfg, at)
    return {
        "generated": iso(at),
        "note": "API-equivalent estimates; on a subscription nothing here is charged.",
        "sessions_scanned": with_sessions,
        "warn_at": cfg.get("warn_at", 0.8),
        "plan": reading,
        "windows": windows(rows, cfg, at),
        "implied_budget_usd": implied_budgets(rows, cfg, reading) if with_sessions else {},
        "runs": rows,
    }


def write(data):
    USAGE.mkdir(parents=True, exist_ok=True)
    tmp = USAGE / f".usage.json.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    os.replace(tmp, USAGE / "usage.json")


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-sessions", action="store_true")
    ap.add_argument("--print", action="store_true")
    a = ap.parse_args(argv)
    data = build(with_sessions=not a.no_sessions)
    write(data)
    if a.print:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        kinds = collections.Counter(r["kind"] for r in data["runs"])
        print(json.dumps({"ok": True, "runs": len(data["runs"]), "kinds": kinds, "windows": {
            k: {"cost_usd": w["cost_usd"], "used": w["used"]} for k, w in data["windows"].items()},
            "plan": {k: w.get("utilization") for k, w in ((data["plan"] or {}).get("windows") or {}).items()},
            "implied_budget_usd": data["implied_budget_usd"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
