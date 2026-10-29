#!/usr/bin/env python3
"""Unit checks for act.py against a throwaway portfolio. Run: python3 bin/test_act.py"""
import json, os, pathlib, sys, tempfile, unittest

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="act-test-"))
os.environ["PORTFOLIO_ROOT"] = str(ROOT)
os.environ["PULSE_TRACKER_DIR"] = str(ROOT / "no-tracker")   # no tracker unless a test makes one
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import act  # noqa: E402

LAUNCHES = []
act.launch_worker = lambda *a: LAUNCHES.append(a)


def setup():
    (ROOT / "companies/acme").mkdir(parents=True, exist_ok=True)
    (ROOT / "portfolio.json").write_text(json.dumps({"entities": [
        {"id": "acme", "name": "Acme", "path": "companies/acme", "lead": "acme-lead", "tracker_projects": ["acme"]},
        {"id": "evil", "name": "Evil", "path": "../outside", "lead": "x"},
    ]}))
    (ROOT / "companies/acme/status.json").write_text(json.dumps({"decisions": [
        {"id": "acme-offer", "ask": "Pick the offer", "recommend": "Ads", "gate": "decision"},
        {"ask": "Buy acme.com today?", "recommend": "Yes", "gate": "money"},
    ]}))
    log = ROOT / "companies/acme/decisions.jsonl"
    if log.exists():
        log.unlink()
    LAUNCHES.clear()


def rows():
    return act.read_log(ROOT / "companies/acme/decisions.jsonl")


class ActTests(unittest.TestCase):
    def setUp(self):
        setup()

    def test_slug_matches_pulse(self):
        self.assertEqual(act.slug("Buy acme.com today?"), "buy-acme-com-today")
        self.assertEqual(act.slug("Sign off Zoë/@x release"), "sign-off-zo-x-release")
        self.assertLessEqual(len(act.slug("x " * 80)), 60)

    def test_rejects_unknown_inputs(self):
        for args in [("nope", "acme-offer", "approve"), ("acme", "nope", "approve"),
                     ("acme", "acme-offer", "merge"), ("../acme", "acme-offer", "approve"),
                     ("acme", "--worker", "approve"), ("acme", "ACME", "approve"),
                     ("evil", "x", "approve")]:
            with self.assertRaises(act.Invalid, msg=args):
                act.answer(*args)
        with self.assertRaises(act.Invalid):
            act.answer("acme", "acme-offer", "discuss", "")
        with self.assertRaises(act.Invalid):
            act.answer("acme", "acme-offer", "discuss", "x" * 2001)
        self.assertEqual(rows(), [])
        self.assertEqual(LAUNCHES, [])

    def test_approve_appends_and_launches(self):
        r = act.answer("acme", "acme-offer", "approve", "go")
        self.assertTrue(r["launched"])
        self.assertEqual([(x["id"], x["action"], x["note"]) for x in rows()], [("acme-offer", "approve", "go")])
        self.assertEqual(set(rows()[0]), {"id", "action", "note", "at", "ask", "recommend"})
        self.assertEqual(LAUNCHES, [("acme", "acme-offer", "approve")])

    def test_fallback_id(self):
        act.answer("acme", "buy-acme-com-today", "reject")
        self.assertEqual(rows()[0]["id"], "buy-acme-com-today")

    def test_idempotent_after_done(self):
        act.answer("acme", "acme-offer", "approve")
        act.record("acme", "acme-offer", "done", "Wrote the offer, PR #1")
        LAUNCHES.clear()
        r = act.answer("acme", "acme-offer", "approve")
        self.assertFalse(r["changed"])
        self.assertFalse(r["launched"])
        self.assertEqual(LAUNCHES, [])
        self.assertEqual(len(rows()), 2)
        # A second done is also a no-op.
        self.assertFalse(act.record("acme", "acme-offer", "done", "again")["changed"])

    def test_pending_approve_is_not_duplicated(self):
        act.answer("acme", "acme-offer", "approve")
        r = act.answer("acme", "acme-offer", "approve")
        self.assertFalse(r["changed"])
        self.assertEqual(len(rows()), 1)

    def test_reject_then_approve_is_noop(self):
        act.answer("acme", "acme-offer", "reject")
        self.assertFalse(act.answer("acme", "acme-offer", "approve")["changed"])
        self.assertEqual([x["action"] for x in rows()], ["reject"])

    def test_discuss_and_reply(self):
        act.answer("acme", "acme-offer", "discuss", "Why ads?")
        act.record("acme", "acme-offer", "reply", "Fastest to cash.")
        self.assertEqual([x["action"] for x in rows()], ["discuss", "reply"])
        with self.assertRaises(act.Invalid):
            act.record("acme", "acme-offer", "approve", "x")   # leads can't approve

    def test_note_is_cleaned(self):
        act.answer("acme", "acme-offer", "discuss", "  hi\x00\x1b[31m there \r\n")
        self.assertEqual(rows()[0]["note"], "hi[31m there")

    def test_dry_run_writes_nothing(self):
        r = act.answer("acme", "acme-offer", "approve", dry_run=True)
        self.assertTrue(r["dry_run"])
        self.assertEqual(r["would_append"]["id"], "acme-offer")
        self.assertIn("--worker", r["would_launch"])
        self.assertEqual(rows(), [])
        self.assertEqual(LAUNCHES, [])

    def test_tracker_match(self):
        e = act.entity_for("acme")
        tracker = ROOT / "tracker"
        (tracker).mkdir(exist_ok=True)
        (tracker / "todos.json").write_text(json.dumps({"todos": [
            {"title": "Decide: the offer to pick", "project": "acme"},
            {"title": "Decide: pick a logo", "project": "other"},
        ]}))
        old = act.TRACKER
        act.TRACKER = tracker
        try:
            self.assertEqual(act.tracker_match(e, {"ask": "Pick the offer"}), "Decide: the offer to pick")
            self.assertIsNone(act.tracker_match(e, {"ask": "Pick a logo"}))
            self.assertIsNone(act.tracker_match(e, {"ask": "Rotate keys"}))
        finally:
            act.TRACKER = old

    def test_worker_logs_run(self):
        import types
        calls = []
        fake = types.ModuleType("nightly")
        fake.run = lambda agent, prompt, model, max_turns, timeout, **kw: (
            calls.append((agent, model, max_turns, prompt, kw)) or
            {"agent": agent, "ok": True, "result": "did it", "cost_usd": 0.12, "secs": 3, "run_id": "r1"})
        sys.modules["nightly"] = fake
        act.answer("acme", "acme-offer", "discuss", "Why ads?")
        act.LOGS.mkdir(exist_ok=True)
        act.worker("acme", "acme-offer", "discuss")
        self.assertEqual(calls[0][:3], ("acme-lead", "sonnet", 40))
        self.assertIn('"Why ads?"', calls[0][3])
        self.assertIn("never send", calls[0][3])
        logs = sorted(act.LOGS.glob("act-*-acme.json"))
        out = json.loads(logs[-1].read_text())
        self.assertEqual((out["kind"], out["decision"], out["running"], out["cost_usd"]), ("act", "acme-offer", False, 0.12))
        self.assertEqual(out["run_id"], "r1")   # links the act log to its transcript
        self.assertEqual(calls[0][4], {"kind": "act", "entity": "acme", "doing": "Discuss: Pick the offer"})
        self.assertFalse(act.run_in_progress("acme"))

    def test_approve_without_a_tracker_skips_it(self):
        import types
        fake = types.ModuleType("nightly")
        fake.run = lambda agent, prompt, model, max_turns, timeout, **kw: {"agent": agent, "ok": True, "result": "done"}
        sys.modules["nightly"] = fake
        self.assertFalse(act.has_tracker())
        self.assertTrue(act.answer("acme", "acme-offer", "approve")["launched"])
        act.LOGS.mkdir(exist_ok=True)
        for f in act.LOGS.glob("act-*-acme.json"):
            f.unlink()
        act.worker("acme", "acme-offer", "approve")
        out = json.loads(sorted(act.LOGS.glob("act-*-acme.json"))[-1].read_text())
        self.assertEqual(out["tracker"], {"title": None, "result": "skipped: no tracker"})
        self.assertTrue(out["ok"])
        self.assertIsNone(act.answer("acme", "acme-offer", "approve", dry_run=True).get("would_close_task"))

    def test_prompt_names_the_org_not_a_person(self):
        p = act.prompt_for(act.entity_for("acme"), "acme-offer", "discuss", "why?")
        self.assertIn(str(act.ORG) + "/bin/act.py --record acme acme-offer reply", p)
        self.assertIn("The owner just answered", p)

    def test_worker_crash_still_finalizes_log(self):
        import types
        fake = types.ModuleType("nightly")

        def boom(*a, **kw):
            raise RuntimeError("claude missing")
        fake.run = boom
        sys.modules["nightly"] = fake
        act.answer("acme", "acme-offer", "discuss", "Why?")
        act.LOGS.mkdir(exist_ok=True)
        for f in act.LOGS.glob("act-*-acme.json"):
            f.unlink()
        with self.assertRaises(RuntimeError):
            act.worker("acme", "acme-offer", "discuss")
        out = json.loads(sorted(act.LOGS.glob("act-*-acme.json"))[-1].read_text())
        self.assertFalse(out["running"])
        self.assertFalse(out["ok"])
        self.assertIn("claude missing", out["result"])
        self.assertIn("finished", out)


if __name__ == "__main__":
    unittest.main(verbosity=1)
