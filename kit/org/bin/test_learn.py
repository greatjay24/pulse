#!/usr/bin/env python3
"""Tests for learn.py. A temp PORTFOLIO_ROOT; the summarizer is faked, so no model is ever called."""
import json, os, pathlib, sys, tempfile, unittest

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="learn-test-"))
os.environ["PORTFOLIO_ROOT"] = str(ROOT)
os.environ["CLAUDE_MEMORY_DIR"] = str(ROOT / "_claude")
os.environ["PULSE_TRACKER_DIR"] = str(ROOT / "_tracker")
os.environ.pop("PULSE_CLAUDE", None)
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import learn  # noqa: E402


def write(rel, obj):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(obj if isinstance(obj, str) else json.dumps(obj))


def fresh():
    import shutil
    for d in ("outbox", "memory", "logs", "companies"):
        shutil.rmtree(ROOT / d, ignore_errors=True)
    write("portfolio.json", {"owner": {"name": "Sam"}, "entities": [{"id": "acme", "path": "companies/acme", "lead": "acme-lead"}]})
    write("outbox/e1.json", {"id": "e1", "kind": "email", "entity": "acme", "subject": "Grant answers", "created_by": "acme-lead",
                             "status": "sent", "edited_at": "2026-10-29T10:00:00-04:00",
                             "original": {"body": "Hi there.\n- Point one\n- Point two\nThanks."},
                             "body": "Hi there. We build sites for shops. Thanks.", "history": []})
    write("outbox/e2.json", {"id": "e2", "kind": "post", "channel": "linkedin", "entity": "acme", "subject": "Launch",
                             "created_by": "acme-lead", "status": "skipped", "why": "launch day. BEFORE SENDING: open the preview link first",
                             "history": [{"what": "skipped in Pulse: too salesy"}]})
    write("outbox/e3.json", {"id": "e3", "kind": "email", "entity": "acme", "subject": "Invoice nudge",
                             "created_by": "acme-lead", "status": "sent", "sent_at": "2026-10-28T09:00:00-04:00"})
    write("outbox/t.json", {"id": "t", "kind": "email", "subject": "Dry run: test", "created_by": "ops-builder", "status": "skipped"})
    write("companies/acme/decisions.jsonl",
          json.dumps({"id": "d1", "action": "reject", "note": "too expensive", "ask": "Buy ads", "recommend": "Yes", "at": "2026-10-27T09:00:00-04:00"}) + "\n" +
          json.dumps({"id": "d2", "action": "discuss", "note": "break pricing out by page", "ask": "Quote", "at": "2026-10-27T10:00:00-04:00"}) + "\n" +
          json.dumps({"id": "d2", "action": "reply", "note": "ok", "at": "2026-10-27T10:01:00-04:00"}) + "\n")
    write("logs/transcripts/r1.jsonl",
          json.dumps({"t": "start", "kind": "chat", "entity": "acme", "agent": "acme-lead"}) + "\n" +
          json.dumps({"t": "user", "at": "2026-10-29T11:00:00-04:00", "text": "Please don't use bullet lists in grant answers."}) + "\n" +
          json.dumps({"t": "user", "at": "2026-10-29T11:01:00-04:00", "text": "What's the status?"}) + "\n")
    write("logs/transcripts/n1.jsonl",
          json.dumps({"t": "start", "kind": "nightly", "entity": "acme", "agent": "acme-lead"}) + "\n" +
          json.dumps({"t": "user", "text": "never mind, don't count me"}) + "\n")


def fake(proposals):
    calls = []

    def summarizer(batch, prefs):
        calls.append((batch, [dict(p) for p in prefs]))
        return proposals(batch, prefs) if callable(proposals) else proposals
    summarizer.calls = calls
    return summarizer


def ids(batch, kind):
    return [s["id"] for s in batch if s["type"] == kind]


class LearnTests(unittest.TestCase):
    def setUp(self):
        fresh()

    def test_collects_each_signal_kind(self):
        sigs = learn.collect()
        kinds = sorted(s["type"] for s in sigs)
        self.assertEqual(kinds, ["approve", "discuss", "edit", "reject", "said", "skip"])
        edit = next(s for s in sigs if s["type"] == "edit")
        self.assertIn("cut: - Point one | - Point two", edit["text"])
        self.assertIn("We build sites for shops", edit["text"])
        skip = next(s for s in sigs if s["type"] == "skip")
        self.assertIn("too salesy", skip["text"])
        self.assertIn("launch day", skip["text"])
        self.assertNotIn("preview link", skip["text"])  # the dropped draft's to-dos are not lessons
        said = next(s for s in sigs if s["type"] == "said")
        self.assertIn("bullet lists", said["text"])      # only chat/interactive, only corrections

    def test_learns_merges_and_never_deletes(self):
        s1 = fake(lambda b, p: [{"text": "Prefers no bullet lists in grant answers", "area": "grants",
                                 "signal_ids": ids(b, "said") + ids(b, "edit")}])
        out = learn.learn(summarizer=s1)
        self.assertEqual([c["what"] for c in out["changes"]], ["added"])
        prefs = learn.load_prefs()
        self.assertEqual(prefs[0]["evidence"], {"said": 1, "edit": 1})
        md = learn.PREFS_MD.read_text()
        self.assertIn("Prefers no bullet lists in grant answers (edited 1 item, said so 1 time,", md)
        self.assertEqual(len(learn.read_jsonl(learn.LEARNINGS)), 6)

        # Second night: nothing new to summarize, no duplicate log rows.
        s2 = fake([])
        learn.learn(summarizer=s2)
        self.assertEqual(s2.calls, [])
        self.assertEqual(len(learn.read_jsonl(learn.LEARNINGS)), 6)

        # A new signal that repeats it (worded slightly differently) strengthens the line.
        write("logs/transcripts/r2.jsonl",
              json.dumps({"t": "start", "kind": "chat", "entity": "acme", "agent": "acme-lead"}) + "\n" +
              json.dumps({"t": "user", "at": "2026-10-30T11:00:00-04:00", "text": "Again: don't use bullets in grant answers."}) + "\n")
        s3 = fake(lambda b, p: [{"text": "Prefers no bullet lists in grant answers.", "area": "grants", "signal_ids": ids(b, "said")}])
        learn.learn(summarizer=s3)
        prefs = learn.load_prefs()
        self.assertEqual(len(prefs), 1)
        self.assertEqual(prefs[0]["evidence"]["said"], 2)

        # A contradiction supersedes the old line; both stay in the JSON, only the new one is in the md.
        write("logs/transcripts/r3.jsonl",
              json.dumps({"t": "start", "kind": "chat", "entity": "acme", "agent": "acme-lead"}) + "\n" +
              json.dumps({"t": "user", "at": "2026-10-31T11:00:00-04:00", "text": "I prefer short bullet lists in grant answers now."}) + "\n")
        old_id = prefs[0]["id"]
        s4 = fake(lambda b, p: [{"text": "Prefers short bullet lists in grant answers", "area": "grants",
                                 "signal_ids": ids(b, "said"), "replaces": old_id}])
        learn.learn(summarizer=s4)
        prefs = {p["id"]: p for p in learn.load_prefs()}
        self.assertEqual(prefs[old_id]["status"], "superseded")
        self.assertIn(prefs[old_id]["superseded_by"], prefs)
        md = learn.PREFS_MD.read_text()
        self.assertNotIn("Prefers no bullet lists", md)
        self.assertIn("Prefers short bullet lists", md)

    def test_unsupported_and_approval_only_lines_are_dropped(self):
        s = fake(lambda b, p: [{"text": "Prefers purple", "area": "general", "signal_ids": ["nope"]},
                               {"text": "Likes invoices", "area": "email", "signal_ids": ids(b, "approve")}])
        out = learn.learn(summarizer=s)
        self.assertEqual(out["changes"], [])

    def test_toggle_keeps_the_line_and_owner_section_survives(self):
        learn.learn(summarizer=fake(lambda b, p: [{"text": "Wants pricing per page", "area": "sales",
                                                    "signal_ids": ids(b, "discuss")}]))
        md = learn.PREFS_MD.read_text().replace("(none yet)", "- Call me Sam, not the owner.")
        learn.PREFS_MD.write_text(md)
        pid = learn.load_prefs()[0]["id"]
        self.assertTrue(learn.set_disabled(pid, True)["ok"])
        p = learn.load_prefs()[0]
        self.assertEqual((p["disabled"], p["status"]), (True, "active"))
        md = learn.PREFS_MD.read_text()
        self.assertNotIn("Wants pricing per page", md)
        self.assertIn("- Call me Sam, not the owner.", md)
        self.assertIn("## Added by Sam", md)
        learn.set_disabled(pid, False)
        self.assertIn("Wants pricing per page", learn.PREFS_MD.read_text())
        self.assertFalse(learn.set_disabled("p-000000", True)["ok"])

    def test_dry_run_writes_nothing(self):
        out = learn.learn(dry_run=True, summarizer=fake(lambda b, p: [{"text": "Wants pricing per page", "area": "sales",
                                                                       "signal_ids": ids(b, "discuss")}]))
        self.assertEqual(out["proposed"][0]["text"], "Wants pricing per page")
        self.assertFalse((ROOT / "memory").exists())

    def test_owner_name_and_older_heading(self):
        learn.PREFS_MD.parent.mkdir(parents=True, exist_ok=True)
        learn.PREFS_MD.write_text("# x\n\n## Added by someone\n- Keep my own line.\n")
        learn.save([])
        md = learn.PREFS_MD.read_text()
        self.assertTrue(md.startswith("# How Sam likes things done"))
        self.assertIn("## Added by Sam\n- Keep my own line.", md)

    def test_no_model_unless_claude_code(self):
        write("portfolio.json", {"runner": "codex", "entities": [{"id": "acme", "path": "companies/acme", "lead": "acme-lead"}]})
        out = learn.learn()
        self.assertIn("codex", out["model"])
        self.assertEqual(out["proposed"], [])
        self.assertEqual(out["summarized"], 0)
        self.assertTrue(learn.LEARNINGS.exists())          # the signals are still logged

    def test_missing_claude_binary_skips_model(self):
        orig = learn.claude_binary
        learn.claude_binary = lambda: None
        try:
            out = learn.learn()
        finally:
            learn.claude_binary = orig
        self.assertIn("isn't installed", out["model"])

    def test_cli_list_and_set(self):
        learn.learn(summarizer=fake(lambda b, p: [{"text": "Wants pricing per page", "area": "sales",
                                                    "signal_ids": ids(b, "discuss")}]))
        import contextlib, io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(learn.main(["--list"]), 0)
        prefs = json.loads(buf.getvalue())["preferences"]
        pid = prefs[0]["id"]
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(learn.main(["--set", pid, "--disabled", "true"]), 0)
        self.assertEqual(json.loads(buf.getvalue()), {"ok": True, "id": pid, "disabled": True})

    def test_cli_set_validates(self):
        self.assertEqual(learn.main(["--set", "../x", "--disabled", "true"]), 2)


if __name__ == "__main__":
    unittest.main()
