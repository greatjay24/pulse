#!/usr/bin/env python3
"""watch_store.py (the "Done without you" log and follow-ups) and undo.py against a throwaway
org, with gh, claude and the Outbox mocked. Run: python3 bin/test_undo.py"""
import json, os, pathlib, shutil, sys, tempfile, unittest
from unittest import mock

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="undo-test-"))
os.environ["PORTFOLIO_ROOT"] = str(ROOT)
os.environ["PULSE_CLAUDE"] = str(ROOT / "no-claude-here")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import watch_store as ws  # noqa: E402
import undo  # noqa: E402

REG = {"entities": [{"id": "acme", "name": "Acme", "group": "companies", "path": "companies/acme", "lead": "acme-lead"}]}


class Base(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(ROOT, ignore_errors=True)
        ROOT.mkdir(parents=True)
        (ROOT / "portfolio.json").write_text(json.dumps(REG))


class Store(Base):
    def test_defaults_name_no_business(self):
        cfg = ws.config()
        self.assertEqual((cfg["email"]["accounts"], cfg["account_entity"], cfg["default_entity"]), ([], {}, None))
        self.assertFalse(cfg["invoice_chaser"]["enabled"])
        self.assertEqual(cfg["deploy_fix"]["owners"], [])
        self.assertEqual(ws.org(), ROOT)

    def test_followups_share_pulse_py_file(self):
        import pulse
        with mock.patch.object(pulse, "FOLLOWUPS", ROOT / "followups.jsonl"), mock.patch.object(pulse.ask, "ORG", ROOT):
            ours = ws.add_followup("Client replies", "acme", "2026-11-02", "acme-lead", check={"pr_merged": "o/r#1"})
            theirs = pulse.followup_add("Check the launch", "owner", "2026-11-03")
            got = {r["id"]: r for r in pulse.read_followups()}
            self.assertEqual(got[ours["id"]]["check"], {"pr_merged": "o/r#1"})
            pulse.followup_set(ours["id"], status="done")
        mine = ws.followups()
        self.assertEqual(mine[ours["id"]]["status"], "done")
        self.assertEqual(mine[ours["id"]]["check"], {"pr_merged": "o/r#1"})
        self.assertEqual(mine[theirs["id"]]["who"], "owner")

    def test_validation(self):
        with self.assertRaises(ValueError):
            ws.add_followup("x", "acme", "soon", "me")
        with self.assertRaises(ValueError):
            ws.add_followup("x", "acme", "2026-11-01", "me", check={"vibes": 1})
        with self.assertRaises(ValueError):
            ws.parse_undo("rm:-rf")
        self.assertEqual(ws.parse_undo("invite:abc_123@owner@example.com"), {"kind": "invite", "ref": "abc_123@owner@example.com"})


class Undo(Base):
    def test_run_and_none_and_twice(self):
        a = ws.log_action("acme", "Asked acme-lead", "x", undo="run:run-1", by="acme-lead")
        n = ws.log_action("acme", "Researched", "x", undo="none")
        fake_ask = mock.Mock()
        fake_ask.stop.return_value = {"ok": True, "stopped": True}
        with mock.patch.dict(sys.modules, {"ask": fake_ask}):
            res = undo.undo(a["id"])
        self.assertEqual((res["ok"], res["result"]), (True, "stopped the run"))
        with self.assertRaises(undo.Refused):
            undo.undo(a["id"])                                # already undone
        with self.assertRaises(undo.Refused):
            undo.undo(n["id"])
        self.assertTrue(ws.actions()[0]["undone"])

    def test_outbox_skip_only_pending(self):
        a = ws.log_action("acme", "Drafted reply", "x", undo="outbox:ob-1")
        fake = mock.Mock()
        fake.load.return_value = {"status": "sent"}
        with mock.patch.dict(sys.modules, {"outbox": fake}):
            self.assertFalse(undo.undo(a["id"])["ok"])
        fake.skip.assert_not_called()
        fake.load.return_value = {"status": "pending"}
        with mock.patch.dict(sys.modules, {"outbox": fake}):
            self.assertTrue(undo.undo(a["id"])["ok"])
        fake.skip.assert_called_once()

    def test_pr_close_and_dry_run(self):
        a = ws.log_action("acme", "Opened fix PR", "x", undo="pr:acme/site#9")
        calls = []

        def fake_gh(args, timeout=60):
            calls.append(args[:2])
            return json.dumps({"state": "OPEN", "url": "https://github.com/acme/site/pull/9"}) if args[1] == "view" else ""
        with mock.patch.object(undo, "gh", fake_gh):
            self.assertIn("would close", undo.undo(a["id"], dry=True)["result"])
            self.assertEqual(calls, [["pr", "view"]])
            self.assertIn("closed", undo.undo(a["id"])["result"])
        self.assertEqual(calls[-1], ["pr", "close"])

    def test_calendar_without_claude_changes_nothing(self):
        a = ws.log_action("acme", "Held a slot", "x", undo="calendar:evt1")
        res = undo.undo(a["id"])
        self.assertFalse(res["ok"])
        self.assertIn("Claude Code", res["result"])
        self.assertFalse(ws.actions()[0].get("undone"))

    def test_followup_dropped(self):
        f = ws.add_followup("Client replies", "acme", "2026-11-02", "acme-lead")
        a = ws.log_action("acme", "Will check back", "x", undo=f"followup:{f['id']}")
        self.assertTrue(undo.undo(a["id"])["ok"])
        self.assertEqual(ws.followups()[f["id"]]["status"], "dropped")

    def test_cli_list(self):
        ws.log_action("acme", "Researched", "x", undo="none")
        import subprocess
        p = subprocess.run([sys.executable, str(pathlib.Path(undo.__file__)), "--list"], capture_output=True, text=True,
                           env={**os.environ})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(len(json.loads(p.stdout)["actions"]), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
