#!/usr/bin/env python3
import datetime, json, os, pathlib, sys, tempfile, unittest

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="usage-test-"))
PROJECTS = ROOT / "claude-projects"
os.environ["PORTFOLIO_ROOT"] = str(ROOT)
os.environ["CLAUDE_PROJECTS_DIR"] = str(PROJECTS)
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import usage  # noqa: E402

NOW = datetime.datetime.now().astimezone().replace(microsecond=0)


def at(mins_ago):
    return (NOW - datetime.timedelta(minutes=mins_ago)).isoformat()


def utc(mins_ago):
    return (NOW - datetime.timedelta(minutes=mins_ago)).astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def transcript(run_id, kind, mins_ago, result=None, entity="acme", agent="acme-lead", secs=60):
    lines = [{"t": "start", "at": at(mins_ago), "run_id": run_id, "kind": kind, "entity": entity, "agent": agent,
              "doing": f"{kind} run", "prompt": "p"}]
    if result is not None:
        lines.append({"t": "result", "at": at(mins_ago - secs / 60), "ok": True, "result": "r", "secs": secs, **result})
    (ROOT / "logs/transcripts").mkdir(parents=True, exist_ok=True)
    (ROOT / "logs/transcripts" / f"{run_id}.jsonl").write_text("".join(json.dumps(x) + "\n" for x in lines))


def session(sid, entrypoint, msgs, project="-proj", sub=False):
    """msgs: [(mins_ago, model, input, output, cache_read, cache_write, msg_id)]"""
    d = PROJECTS / project / (f"{sid}/subagents" if sub else "")
    d.mkdir(parents=True, exist_ok=True)
    lines = [{"type": "user", "sessionId": sid, "timestamp": utc(msgs[0][0] + 1), "entrypoint": entrypoint,
              "message": {"role": "user", "content": "SECRET USER TEXT"}}]
    for mins, model, i, o, cr, cw, mid in msgs:
        u = {"input_tokens": i, "output_tokens": o, "cache_read_input_tokens": cr, "cache_creation_input_tokens": cw,
             "cache_creation": {"ephemeral_1h_input_tokens": cw, "ephemeral_5m_input_tokens": 0}}
        line = {"type": "assistant", "sessionId": sid, "timestamp": utc(mins), "entrypoint": entrypoint, "cwd": str(ROOT),
                "message": {"id": mid, "model": model, "usage": u, "content": [{"type": "text", "text": "SECRET REPLY"}]}}
        lines += [line, line]      # Claude Code writes one line per content block; same id, counted once
    (d / (f"agent-{mid}.jsonl" if sub else f"{sid}.jsonl")).write_text("".join(json.dumps(x) + "\n" for x in lines))


def fresh():
    import shutil
    for p in (ROOT / "logs", PROJECTS):
        shutil.rmtree(p, ignore_errors=True)
    (ROOT / "portfolio.json").write_text(json.dumps({
        "entities": [{"id": "acme", "lead": "acme-lead"}],
        "usage": {"five_hour_budget_usd": 1.0, "weekly_budget_usd": 100, "warn_at": 0.8}}))


def by_id(data):
    return {r["id"]: r for r in data["runs"]}


class UsageTests(unittest.TestCase):
    def setUp(self):
        fresh()

    def test_runner_rows_and_sessions_count_once(self):
        tok = {"input": 10, "output": 1000, "cache_read": 0, "cache_write": 0}
        transcript("r1", "nightly", 30, {"cost_usd": 0.5, "tokens": tok, "session_id": "s-run",
                                         "by_model": {"claude-sonnet-5-5": {**tok, "cost_usd": 0.5}}, "models": ["claude-sonnet-5-5"]})
        session("s-run", "sdk-cli", [(29, "claude-sonnet-5-5", 10, 1000, 0, 0, "m1")])
        session("s-me", "cli", [(20, "claude-opus-5-5", 1_000_000, 0, 0, 0, "m2"), (10, "claude-opus-5-5", 0, 100_000, 0, 0, "m3")])
        data = usage.build()
        rows = by_id(data)
        self.assertEqual(set(rows), {"r1", "session-s-me"})
        self.assertEqual((rows["r1"]["cost_usd"], rows["r1"]["cost_basis"], rows["r1"]["entity"]), (0.5, "reported", "acme"))
        me = rows["session-s-me"]
        self.assertEqual((me["kind"], me["cost_basis"]), ("interactive", "estimated"))
        self.assertAlmostEqual(me["cost_usd"], 4.0 + 2.0)      # $4/M in + $20/M out
        self.assertEqual(me["tokens"], {"input": 1_000_000, "output": 100_000, "cache_read": 0, "cache_write": 0})

    def test_subagent_files_join_their_session(self):
        session("s1", "cli", [(10, "claude-haiku-5-5", 0, 1_000_000, 0, 0, "a")])
        session("s1", "cli", [(9, "claude-haiku-5-5", 0, 1_000_000, 0, 0, "b")], sub=True)
        rows = by_id(usage.build())
        self.assertEqual(rows["session-s1"]["tokens"]["output"], 2_000_000)
        self.assertAlmostEqual(rows["session-s1"]["cost_usd"], 1.0)

    def test_old_run_without_session_id_matches_by_time_and_cost(self):
        # Two runs start together (parallel nightly); each takes the session whose cost it reported.
        transcript("a", "nightly", 60, {"cost_usd": 4.0})
        transcript("b", "nightly", 60, {"cost_usd": 0.2})
        session("sa", "sdk-cli", [(59.8, "claude-opus-5-5", 1_000_000, 0, 0, 0, "x")])
        session("sb", "sdk-cli", [(59.7, "claude-sonnet-5-5", 100_000, 0, 0, 0, "y")])
        rows = by_id(usage.build())
        self.assertEqual(set(rows), {"a", "b"})
        self.assertEqual((rows["a"]["session_id"], rows["a"]["tokens"]["input"]), ("sa", 1_000_000))
        self.assertEqual((rows["b"]["session_id"], rows["b"]["tokens"]["input"]), ("sb", 100_000))
        self.assertEqual(rows["a"]["cost_basis"], "reported")

    def test_resumed_chat_splits_by_run(self):
        transcript("c1", "chat", 120, {"cost_usd": 1.0, "session_id": "s"}, secs=60)
        transcript("c2", "chat", 30, {"cost_usd": 2.0, "session_id": "s"}, secs=60)
        session("s", "sdk-cli", [(119.5, "claude-opus-5-5", 0, 100, 0, 0, "1"), (29.5, "claude-opus-5-5", 0, 200, 0, 0, "2")])
        rows = by_id(usage.build())
        self.assertEqual((rows["c1"]["tokens"]["output"], rows["c2"]["tokens"]["output"]), (100, 200))
        self.assertNotIn("session-s", rows)

    def test_org_session_keeps_its_entity_and_conversation(self):
        transcript("session-s9", "interactive", 10, None)
        session("s9", "cli", [(9, "claude-opus-5-5", 0, 10, 0, 0, "q")])
        r = by_id(usage.build())["session-s9"]
        self.assertEqual((r["entity"], r["agent"], r["run_id"]), ("acme", "acme-lead", "session-s9"))

    def test_windows_budgets_and_warning(self):
        transcript("w1", "act", 60, {"cost_usd": 0.9})
        transcript("w2", "act", 60 * 30, {"cost_usd": 50.0})   # 30 hours ago: in the week, not the 5 hours
        w = usage.build()["windows"]
        self.assertAlmostEqual(w["five_hour"]["cost_usd"], 0.9)
        self.assertTrue(w["five_hour"]["warn"])                 # 90% of a $1 budget
        self.assertAlmostEqual(w["seven_day"]["cost_usd"], 50.9)
        self.assertFalse(w["seven_day"]["warn"])

    def test_plan_reading_age_and_reset(self):
        (ROOT / "logs/usage").mkdir(parents=True)
        (ROOT / "logs/usage/plan.json").write_text(json.dumps({"at": at(10), "windows": {
            "five_hour": {"utilization": 0.85, "resets_at": at(-60)},
            "seven_day": {"utilization": 0.9, "resets_at": at(5)}}}))
        p = usage.build()["plan"]
        self.assertFalse(p["stale"])
        self.assertTrue(p["windows"]["five_hour"]["warn"])
        self.assertTrue(p["windows"]["seven_day"]["reset_passed"])
        self.assertFalse(p["windows"]["seven_day"]["warn"])

    def test_price_override_and_unknown_model(self):
        pj = json.loads((ROOT / "portfolio.json").read_text())
        pj["usage"]["prices_per_mtok"] = {"claude-opus-5-5": {"input": 10}}
        (ROOT / "portfolio.json").write_text(json.dumps(pj))
        session("s", "cli", [(5, "claude-opus-5-5", 1_000_000, 0, 0, 0, "1")])
        session("t", "cli", [(5, "mystery-model", 1_000_000, 0, 0, 0, "2")])
        rows = by_id(usage.build())
        self.assertAlmostEqual(rows["session-s"]["cost_usd"], 10.0)
        self.assertIsNone(rows["session-t"]["cost_usd"])

    def test_never_writes_message_content(self):
        session("s", "cli", [(5, "claude-opus-5-5", 1, 1, 1, 1, "1")])
        usage.write(usage.build())
        raw = (ROOT / "logs/usage/usage.json").read_text()
        self.assertNotIn("SECRET", raw)


if __name__ == "__main__":
    unittest.main()
