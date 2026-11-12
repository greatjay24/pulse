#!/usr/bin/env python3
"""goals.py: schema validation, pacing and the leads' `set`. Run: python3 bin/test_goals.py"""
import datetime, json, os, pathlib, sys, tempfile, unittest

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="goals-test-"))
os.environ["PORTFOLIO_ROOT"] = str(ROOT)
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import goals  # noqa: E402

GOAL = {"id": "acme-cash", "title": "Cash", "metric": "Cash in (30d)", "target": 10000, "unit": "USD",
        "by": "2026-12-31", "current": 2500, "source": "stripe", "owner_note": "", "proposed": True,
        "start": "2026-10-01", "baseline": 0}


def setup():
    (ROOT / "companies/acme").mkdir(parents=True, exist_ok=True)
    (ROOT / "portfolio.json").write_text(json.dumps({"entities": [
        {"id": "acme", "path": "companies/acme"}, {"id": "evil", "path": "../outside"}]}))
    (ROOT / "companies/acme/goals.json").write_text(json.dumps({"entity": "acme", "goals": [GOAL]}))


class Goals(unittest.TestCase):
    def setUp(self):
        setup()

    def test_valid_roundtrip(self):
        doc = goals.load(goals.entity("acme"))
        self.assertEqual(doc["goals"][0]["target"], 10000)

    def test_rejects_bad_goals(self):
        bad = [dict(GOAL, id="Bad Id"), dict(GOAL, target="10k"), dict(GOAL, by="Dec 31"),
               dict(GOAL, source="vibes"), dict(GOAL, extra=1), dict(GOAL, current=True),
               dict(GOAL, title=""), {k: v for k, v in GOAL.items() if k != "owner_note"},
               dict(GOAL, by="2026-02-30")]
        for g in bad:
            with self.assertRaises((goals.Invalid, ValueError), msg=str(g)):
                goals.validate({"goals": [g]})
        with self.assertRaises(goals.Invalid):
            goals.validate({"goals": [GOAL, GOAL]})          # duplicate ids

    def test_null_targets_allowed(self):
        g = dict(GOAL, target=None, current=None)
        self.assertEqual(goals.pace(goals.validate_goal(g)), "unmeasured")

    def test_pace(self):
        d = datetime.date
        self.assertEqual(goals.pace(dict(GOAL, current=2500), d(2026, 10, 15)), "on-track")
        self.assertEqual(goals.pace(dict(GOAL, current=1000), d(2026, 12, 1)), "at-risk")
        self.assertEqual(goals.pace(dict(GOAL, current=10000), d(2026, 12, 1)), "done")
        self.assertEqual(goals.pace(dict(GOAL, current=9000), d(2027, 1, 2)), "missed")
        self.assertEqual(goals.pace(dict(GOAL, by=None), d(2026, 12, 1)), "no-date")
        self.assertEqual(goals.pace(dict(GOAL, at_risk=True), d(2026, 10, 2)), "at-risk")
        down = dict(GOAL, direction="down", baseline=100, target=20, current=30)
        self.assertEqual(goals.pace(down, d(2026, 12, 1)), "on-track")
        self.assertEqual(goals.pace(dict(down, current=15), d(2026, 12, 1)), "done")

    def test_set_only_touches_measurement(self):
        res = goals.set_measure("acme", "acme-cash", current=4000, note="Stripe 30d", at_risk=False)
        self.assertEqual(res["goal"]["current"], 4000)
        doc = json.loads((ROOT / "companies/acme/goals.json").read_text())
        g = doc["goals"][0]
        self.assertEqual((g["target"], g["title"], g["proposed"]), (10000, "Cash", True))
        self.assertEqual(g["lead_note"], "Stripe 30d")
        with self.assertRaises(goals.Invalid):
            goals.set_measure("acme", "nope", current=1)

    def test_path_cannot_escape(self):
        with self.assertRaises(goals.Invalid):
            goals.goals_path(goals.entity("evil"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
