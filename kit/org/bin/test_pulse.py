#!/usr/bin/env python3
"""Unit checks for pulse.py (the front door's tools) against a throwaway portfolio and a fake
claude. Run: python3 bin/test_pulse.py"""
import datetime, json, os, pathlib, stat, sys, tempfile, unittest

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="pulse-test-"))
os.environ["PORTFOLIO_ROOT"] = str(ROOT)
os.environ.pop("PORTFOLIO_RUN_ID", None)
FAKE_BIN = ROOT / "fake-claude"
os.environ["PULSE_CLAUDE"] = str(FAKE_BIN)
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ask  # noqa: E402
import pulse  # noqa: E402

# Replies with the agent's name and the first line of what it was asked.
FAKE_CLAUDE = r'''#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
agent = args[args.index("--agent") + 1]
message = sys.stdin.read()
sid = "11111111-2222-3333-4444-555555555555"
print(json.dumps({"type": "system", "subtype": "init", "session_id": sid}), flush=True)
print(json.dumps({"type": "assistant", "session_id": sid, "message": {"content": [{"type": "text", "text": "working"}]}}), flush=True)
print(json.dumps({"type": "result", "session_id": sid, "is_error": False,
                  "result": agent + " did: " + message.splitlines()[0] + "\nhttps://example.com/pr/1",
                  "total_cost_usd": 0.001, "duration_ms": 10}), flush=True)
'''

SPECS = []
ask.launch_worker = lambda spec: SPECS.append(spec)


def setup():
    for d in ["companies/acme", "companies/globex", "logs/live", "logs/transcripts"]:
        (ROOT / d).mkdir(parents=True, exist_ok=True)
    (ROOT / "portfolio.json").write_text(json.dumps({
        "front_door": {"lead": "pulse", "model": "sonnet"},
        "chief_of_staff": {"lead": "chief-of-staff"},
        "entities": [
            {"id": "acme", "name": "Acme", "path": "companies/acme", "lead": "acme-lead"},
            {"id": "globex", "name": "Globex", "path": "companies/globex", "lead": "globex-lead"},
        ]}))
    (ROOT / "companies/acme/status.json").write_text(json.dumps({
        "health": "yellow", "headline": "Two drafts unsent", "decisions": [{"id": "d1", "ask": "Pick a price"}],
        "risks": [{"what": "Key expires Friday"}], "next": ["Send the drafts"]}))
    (ROOT / "companies/acme/goals.json").write_text(json.dumps({"goals": [{"title": "Ten sales", "current": 2, "target": 10, "unit": "sales", "at_risk": True}]}))
    (ROOT / "WEEK.md").write_text("# Week\n\n## Your three moves this week\n1. Ship the site.\n\n## Decisions\nnone\n")
    FAKE_BIN.write_text(FAKE_CLAUDE)
    FAKE_BIN.chmod(FAKE_BIN.stat().st_mode | stat.S_IEXEC)
    for f in [*(ROOT / "logs/live").glob("*"), *(ROOT / "logs/transcripts").glob("*"), pulse.FOLLOWUPS,
              *(pulse.GROUPS.glob("*") if pulse.GROUPS.is_dir() else []), ask.SESSIONS]:
        if f.exists():
            f.unlink()


def run_job(spec):
    path = ROOT / f"job-{spec['run_id']}.json"
    path.write_text(json.dumps(spec))
    ask.worker(str(path))
    return json.loads((ROOT / "logs/live" / f"{spec['run_id']}.json").read_text())


def lines(run_id):
    return [json.loads(l) for l in (ROOT / "logs/transcripts" / f"{run_id}.jsonl").read_text().splitlines()]


class PulseTests(unittest.TestCase):
    def setUp(self):
        setup()
        SPECS.clear()
        os.environ.pop("PORTFOLIO_RUN_ID", None)

    def front_door_run(self, text):
        r = ask.ask("pulse", text)
        run_job(SPECS.pop())
        return r["run_id"]

    def test_delegate_starts_one_run_per_lead_as_a_group(self):
        origin = self.front_door_run("Get Acme and Globex ready for Monday")
        os.environ["PORTFOLIO_RUN_ID"] = origin
        r = pulse.delegate([("acme", "Ship the pricing page"), ("globex-lead", "Draft the launch post")])
        self.assertEqual([x["agent"] for x in r["runs"]], ["acme-lead", "globex-lead"])
        self.assertEqual(len(SPECS), 2)
        for spec in SPECS:
            self.assertTrue(spec["new"])
            self.assertEqual(spec["extra"]["parent_run"], origin)
            self.assertEqual(spec["extra"]["group"], r["group"])
            self.assertIn("Handed to you by Roo", spec["message"])
        g = json.loads(pulse.group_path(r["group"]).read_text())
        self.assertEqual(g["request"], "Get Acme and Globex ready for Monday")
        self.assertEqual(g["origin_run"], origin)

    def test_delegate_refuses_bad_targets_and_itself(self):
        for tasks in ([], [("nope", "x")], [("pulse", "x")], [("org", "x")], [("acme", "  ")]):
            with self.assertRaises((pulse.Invalid, ask.Invalid), msg=tasks):
                pulse.delegate(tasks)
        self.assertEqual(SPECS, [])

    def test_last_child_to_finish_reports_back_once(self):
        origin = self.front_door_run("Do both things")
        r = pulse.delegate([("acme", "Thing one"), ("globex", "Thing two")], origin=origin)
        first, second = list(SPECS)
        SPECS.clear()
        st = run_job(first)
        self.assertEqual(st["state"], "finished")
        self.assertEqual(SPECS, [])                             # globex's worker hasn't started yet
        run_job(second)
        self.assertEqual(len(SPECS), 1)
        report = SPECS[0]
        self.assertEqual(report["agent"], "pulse")
        self.assertEqual(report["extra"]["trigger"], "report")
        self.assertEqual(report["extra"]["report_for"], origin)
        self.assertIn("acme-lead did: Thing one", report["message"])
        self.assertIn("globex-lead did: Thing two", report["message"])
        self.assertIn('The owner asked: "Do both things"', report["message"])
        self.assertEqual(report["extra"]["display"], "Report back from acme-lead, globex-lead")
        g = json.loads(pulse.group_path(r["group"]).read_text())
        self.assertTrue(g["reported"])
        self.assertEqual(g["report_run"], report["run_id"])
        # A late duplicate call doesn't report twice.
        pulse.child_finished(second["run_id"])
        self.assertEqual(len(SPECS), 1)
        st = run_job(report)
        self.assertEqual(st["report_for"], origin)
        self.assertEqual(next(l for l in lines(st["run_id"]) if l["t"] == "report")["text"], report["extra"]["display"])

    def test_followups_add_list_set(self):
        os.environ["PORTFOLIO_RUN_ID"] = "20261029-000000-pulse-abcd"
        row = pulse.followup_add("Check the Acme reply", "acme-lead", "2020-01-01")
        later = pulse.followup_add("Check the bank", "owner", "2999-01-01T10:00", note="loan")
        self.assertEqual(row["run"], "20261029-000000-pulse-abcd")
        self.assertEqual([r["id"] for r in pulse.read_followups() if pulse.is_due(r)], [row["id"]])
        pulse.followup_set(row["id"], status="done")
        self.assertFalse(any(pulse.is_due(r) for r in pulse.read_followups()))
        self.assertEqual(pulse.followup_set(later["id"], check_at="2999-02-01")["check_at"][:10], "2999-02-01")
        for bad in (lambda: pulse.followup_add("", "owner", "2020-01-01"), lambda: pulse.followup_add("x", "--x", "2020-01-01"),
                    lambda: pulse.followup_add("x", "owner", "tomorrow"), lambda: pulse.followup_set("fu-nope", status="done"),
                    lambda: pulse.followup_set(row["id"], status="maybe"), lambda: pulse.followup_set("../x")):
            with self.assertRaises(pulse.Invalid):
                bad()

    def test_tick_checks_due_followups_once_a_day(self):
        row = pulse.followup_add("Check the Acme reply", "owner", "2020-01-01")
        at = datetime.datetime.now().astimezone().replace(hour=10)
        r = pulse.tick(at)
        self.assertTrue(r["started"])
        self.assertEqual(r["due"], [row["id"]])
        self.assertIn(row["id"], SPECS[0]["message"])
        self.assertEqual(SPECS[0]["extra"]["trigger"], "followup")
        self.assertFalse(pulse.tick(at + datetime.timedelta(hours=1))["started"])     # checked recently
        rows = pulse.read_followups()
        rows[0]["last_checked"] = (at - datetime.timedelta(hours=pulse.CHECK_GAP_HOURS + 1)).isoformat()
        pulse.write_followups(rows)
        self.assertTrue(pulse.tick(at)["started"])                                     # a day later: again
        self.assertEqual(pulse.tick(at.replace(hour=3))["reason"], "outside working hours")

    def test_tick_checks_every_followup_without_a_watcher(self):
        mine = pulse.followup_add("Ask the owner about the lease", "owner", "2020-01-01")
        lead = pulse.followup_add("Acme client replies", "acme", "2020-01-01")
        r = pulse.tick(datetime.datetime.now().astimezone().replace(hour=10))
        self.assertEqual(r["due"], [mine["id"], lead["id"]])
        self.assertEqual(mine["created_by"], "pulse")

    def test_tick_leaves_lead_followups_to_a_watcher(self):
        watcher = ROOT / "watch.py"
        watcher.write_text("# a watcher\n")
        real, pulse.WATCHER = pulse.WATCHER, watcher
        try:
            mine = pulse.followup_add("Ask the owner about the lease", "owner", "2020-01-01")
            pulse.followup_add("Acme client replies", "acme", "2020-01-01")
            pulse.followup_add("Globex PR merged", "globex-lead", "2020-01-01")
            r = pulse.tick(datetime.datetime.now().astimezone().replace(hour=10))
            self.assertEqual(r["due"], [mine["id"]])
        finally:
            pulse.WATCHER = real

    def test_later_row_for_an_id_wins(self):
        row = pulse.followup_add("Check the bank", "owner", "2020-01-01")
        with pulse.FOLLOWUPS.open("a") as f:
            f.write(json.dumps({**row, "status": "done"}) + "\n")
        rows = pulse.read_followups()
        self.assertEqual([(r["id"], r["status"]) for r in rows], [(row["id"], "done")])
        self.assertFalse(any(pulse.is_due(r) for r in rows))

    def test_digest_and_brief(self):
        pulse.followup_add("Check the Acme reply", "acme-lead", "2020-01-01")
        d = pulse.digest("morning")
        for want in ("Acme: yellow", "Two drafts unsent", "1 decision(s) open", "risk: Key expires Friday",
                     "next: Send the drafts", "goal at risk: Ten sales (2/10 sales)", "1. Ship the site.",
                     "0 waiting for your click", "Follow-ups: 1 due"):
            self.assertIn(want, d)
        self.assertNotIn("Finished today", d)
        self.assertIn("Finished today", pulse.digest("evening"))
        r = pulse.brief("morning", source="schedule")
        self.assertEqual(r["agent"], "pulse")
        self.assertEqual(SPECS[0]["extra"], {"trigger": "brief", "source": "schedule", "display": "Morning brief"})
        self.assertTrue(SPECS[0]["message"].startswith("BRIEF morning"))
        st = run_job(SPECS[0])
        self.assertEqual(st["doing"], "Morning brief")
        w = pulse.wait(st["run_id"], timeout=2)
        self.assertTrue(w["ok"])
        self.assertTrue(w["reply"].startswith("pulse did: BRIEF morning"))

    def test_status_lists_waiting_handoffs(self):
        r = pulse.delegate([("acme", "Thing one")])
        s = pulse.status()
        self.assertEqual(s["handoffs_waiting"][0]["group"], r["group"])
        self.assertEqual(s["followups_open"], 0)

    def test_cli(self):
        import subprocess
        p = subprocess.run([sys.executable, str(pathlib.Path(pulse.__file__)), "delegate", "--to", "acme"],
                           capture_output=True, text=True, env={**os.environ})
        self.assertEqual(p.returncode, 2)
        self.assertEqual(json.loads(p.stdout)["error"], "give one --message for each --to")
        p = subprocess.run([sys.executable, str(pathlib.Path(pulse.__file__)), "followup", "add", "--what", "x",
                            "--who", "owner", "--check-at", "2030-01-01"], capture_output=True, text=True, env={**os.environ})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(json.loads(p.stdout)["followup"]["id"].startswith("fu-"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
