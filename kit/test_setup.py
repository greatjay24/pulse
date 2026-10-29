#!/usr/bin/env python3
"""End-to-end checks for setup.py. Every run uses a throwaway HOME; the real one is never touched.
Run: python3 kit/test_setup.py"""
import json, os, pathlib, shutil, subprocess, sys, tempfile, unittest

KIT = pathlib.Path(__file__).resolve().parent
SETUP = KIT / "setup.py"
EXAMPLE = KIT / "example-config.json"
MANAGERS = ["sales-manager", "marketing-manager", "delivery-manager", "finance-manager", "admin-manager"]
STATUS_KEYS = {"entity", "name", "group", "parent", "stage", "updated", "health", "health_why", "headline", "metrics",
               "lanes", "decisions", "owner_actions", "waiting_on", "risks", "next", "done"}


def run(home, *args, stdin=None):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "PORTFOLIO_"))}
    env.update(HOME=str(home), GIT_CONFIG_GLOBAL=str(home / ".gitconfig-none"), GIT_CONFIG_NOSYSTEM="1")
    return subprocess.run([sys.executable, str(SETUP), *args], env=env, input=stdin, capture_output=True, text=True,
                          cwd=str(home), timeout=60)


def commits(org):
    return int(subprocess.run(["git", "-C", str(org), "rev-list", "--count", "HEAD"], capture_output=True, text=True).stdout.strip() or 0)


def snapshot(*roots):
    """{path: (bytes, mtime)} for every file under the roots, .git excluded."""
    out = {}
    for root in roots:
        for p in root.rglob("*"):
            if p.is_file() and ".git" not in p.parts:
                out[str(p)] = (p.read_bytes(), p.stat().st_mtime_ns)
    return out


class SetupE2E(unittest.TestCase):
    def setUp(self):
        self.home = pathlib.Path(tempfile.mkdtemp(prefix="pulse-setup-test-")).resolve()
        self.org = self.home / "portfolio"
        self.agents = self.home / ".claude" / "agents"

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)

    def config(self, **changes):
        cfg = json.loads(EXAMPLE.read_text())
        cfg.update(changes)
        path = self.home / "org.json"
        path.write_text(json.dumps(cfg))
        return path

    def test_config_run_rerun_and_conflict(self):
        logo = self.home / "acme.svg"
        logo.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
        cfg = json.loads(EXAMPLE.read_text())
        cfg["entities"][0]["logo"] = str(logo)
        cfg_path = self.home / "org.json"
        cfg_path.write_text(json.dumps(cfg))

        # 1. First run builds the whole tree.
        r = run(self.home, "--config", str(cfg_path))
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        for rel in ["portfolio.json", "OPERATING.md", "STATUS_SCHEMA.md", "README.md", ".gitignore", "bin/act.py",
                    "bin/live.py", "bin/nightly.py", "bin/session_hook.py", "bin/policy.py", "launchd/install.sh",
                    "launchd/com.pulse.org.nightly.plist", "launchd/com.pulse.org.weekly.plist", "assets/logos/acme.svg"]:
            self.assertTrue((self.org / rel).is_file(), rel)
        for rel in ["logs/live", "logs/transcripts", "history"]:
            self.assertTrue((self.org / rel).is_dir(), rel)
        reg = json.loads((self.org / "portfolio.json").read_text())
        self.assertEqual(reg["owner"], {"name": "Sam"})
        self.assertEqual([g["id"] for g in reg["groups"]], ["companies", "family", "personal"])
        self.assertEqual(reg["managers"], MANAGERS)
        self.assertEqual(reg["chief_of_staff"]["lead"], "chief-of-staff")
        by_id = {e["id"]: e for e in reg["entities"]}
        self.assertEqual(by_id["acme"]["path"], "companies/acme")
        self.assertEqual(by_id["acme"]["logo"], "assets/logos/acme.svg")
        self.assertEqual(by_id["personal"]["path"], "personal")
        self.assertEqual((by_id["initech"]["path"], by_id["initech"]["parent"], by_id["initech"]["schedule"]),
                         ("personal/ventures/initech", "personal", "on-call"))
        for e in reg["entities"]:
            self.assertEqual(e["lead"], f"{e['id']}-lead")
            status = json.loads((self.org / e["path"] / "status.json").read_text())
            self.assertEqual(set(status), STATUS_KEYS)
            self.assertEqual((status["entity"], status["health"]), (e["id"], "yellow"))
            self.assertEqual(set(status["lanes"]), {"sales", "marketing", "delivery", "finance", "admin"})
            self.assertTrue((self.org / e["path"] / "BRIEF.md").read_text().startswith(f"# {e['name']}"))
            self.assertEqual((self.org / e["path"] / "decisions.jsonl").read_text(), "")
            self.assertTrue((self.agents / f"{e['lead']}.md").is_file())
        for name in ["chief-of-staff"] + MANAGERS:
            self.assertTrue((self.agents / f"{name}.md").is_file(), name)
        self.assertEqual(len(list(self.agents.glob("*.md"))), 11)
        # Every placeholder was filled (bin/ and install.sh hold none that setup owns).
        for p in list(self.agents.glob("*.md")) + [self.org / n for n in ("OPERATING.md", "STATUS_SCHEMA.md", "README.md")] + \
                list((self.org / "launchd").glob("*.plist")):
            self.assertNotIn("{{", p.read_text(), p)
        acme = (self.agents / "acme-lead.md").read_text()
        self.assertTrue(acme.startswith("---\nname: acme-lead\n"))
        self.assertIn(f"{self.org}/companies/acme/BRIEF.md", acme)
        self.assertIn("Initech", (self.agents / "chief-of-staff.md").read_text())
        self.assertEqual(commits(self.org), 1)
        self.assertIn("bin/talk.py acme", r.stdout)
        self.assertEqual(reg["runner"], "claude-code")
        neutral = (self.org / "agents" / "acme-lead.md").read_text()
        self.assertIn("role: lead\ntier: deep\n", neutral)                  # model-neutral source
        self.assertIn("model: opus\n", acme)                                  # translated for Claude Code
        self.assertEqual(len(list((self.org / "agents").glob("*.md"))), 11)
        self.assertIn("launchd/install.sh", r.stdout)
        self.assertIn('"matcher": "Agent|Task"', r.stdout)
        self.assertIn("SubagentStop", r.stdout)
        self.assertFalse((self.home / "Library").exists())          # launchd was not installed

        # The installed scripts work where they landed.
        for t in ("test_act.py", "test_live.py", "test_runners.py"):
            out = subprocess.run([sys.executable, str(self.org / "bin" / t)], capture_output=True, text=True,
                                 env={**os.environ, "HOME": str(self.home)}, timeout=120)
            self.assertEqual(out.returncode, 0, out.stderr[-2000:])
        dry = subprocess.run([sys.executable, str(self.org / "bin" / "act.py"), "acme", "nope", "approve", "--dry-run"],
                             capture_output=True, text=True, env={**os.environ, "HOME": str(self.home)})
        self.assertEqual(json.loads(dry.stdout.strip().splitlines()[-1]), {"ok": False, "error": "acme has no open decision nope"})

        # 2. Re-run: nothing changes.
        before = snapshot(self.org, self.agents)
        r = run(self.home, "--config", str(cfg_path))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Nothing to do", r.stdout)
        self.assertEqual(snapshot(self.org, self.agents), before)
        self.assertEqual(commits(self.org), 1)

        # 3. A hand-edited agent is left alone; a new entity is added; nothing is dropped.
        custom = "---\nname: acme-lead\n---\nMy own lead.\n"
        (self.agents / "acme-lead.md").write_text(custom)
        status_edit = self.org / "companies/acme/status.json"
        status_edit.write_text(status_edit.read_text().replace('"yellow"', '"green"'))
        cfg["entities"] = cfg["entities"][1:2] + [{"id": "hooli", "name": "Hooli", "group": "companies",
                                                   "description": "A consulting side line."}]
        cfg_path.write_text(json.dumps(cfg))
        r = run(self.home, "--config", str(cfg_path))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual((self.agents / "acme-lead.md").read_text(), custom)
        self.assertNotIn("acme-lead.md", r.stdout)       # acme isn't in this config, so it isn't touched at all
        self.assertIn('"green"', status_edit.read_text())
        ids = [e["id"] for e in json.loads((self.org / "portfolio.json").read_text())["entities"]]
        self.assertEqual(ids, ["acme", "northwind", "globex", "personal", "initech", "hooli"])
        self.assertTrue((self.agents / "hooli-lead.md").is_file())
        self.assertTrue((self.org / "companies/hooli/status.json").is_file())
        self.assertIn("left alone", r.stdout)            # chief-of-staff.md now differs (its table)
        self.assertEqual(commits(self.org), 2)

        # 4. Same config again with acme back in: its edited agent is reported, not overwritten.
        cfg_path.write_text(json.dumps(json.loads(EXAMPLE.read_text())))
        r = run(self.home, "--config", str(cfg_path))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("acme-lead.md  (exists and differs", r.stdout)
        self.assertEqual((self.agents / "acme-lead.md").read_text(), custom)

    def test_interactive(self):
        answers = "\n".join([
            "Sam", "",                                      # owner, default groups
            "acme", "", "1", "Builds websites.", "", "", "", "", "~/code/acme-site",   # id, name, group, desc, color, logo, schedule, parent, dirs
            "globex", "Globex Rentals", "Family", "Rental homes.", "#123456", "", "on-call", "", "",
            "",                                             # done adding
            "claude-code",                                  # runner
            "y",                                            # write?
        ]) + "\n"
        r = run(self.home, stdin=answers)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        reg = json.loads((self.org / "portfolio.json").read_text())
        e = {x["id"]: x for x in reg["entities"]}
        self.assertEqual((e["acme"]["name"], e["acme"]["group"], e["acme"]["schedule"]), ("Acme", "companies", "nightly"))
        self.assertEqual((e["globex"]["group"], e["globex"]["color"], e["globex"]["schedule"]), ("family", "#123456", "on-call"))
        self.assertEqual(e["acme"]["dirs"], ["~/code/acme-site"])
        self.assertNotIn("dirs", e["globex"])
        self.assertTrue((self.agents / "globex-lead.md").is_file())
        self.assertEqual(commits(self.org), 1)

    def test_runner_choice_and_switch(self):
        r = run(self.home, "--config", str(self.config(runner="codex")))
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        reg = json.loads((self.org / "portfolio.json").read_text())
        self.assertEqual(reg["runner"], "codex")
        self.assertFalse(self.agents.exists())                           # nothing for Claude Code
        rules = self.home / ".codex" / "rules" / "pulse-org.rules"
        self.assertIn('decision = "forbidden"', rules.read_text())
        self.assertEqual(len(list((self.org / "agents").glob("*.md"))), 11)
        self.assertIn("Codex (ChatGPT)", r.stdout)
        self.assertIn("Claude Code only", r.stdout)                      # no hooks snippet for codex
        self.assertNotIn('"matcher"', r.stdout)
        self.assertIn('"runner" in ~/portfolio/portfolio.json', r.stdout)

        # A re-run without --runner keeps the choice; --runner switches and installs that runner's agents.
        run(self.home, "--config", str(self.config(runner="claude-code")))
        self.assertEqual(json.loads((self.org / "portfolio.json").read_text())["runner"], "codex")
        r = run(self.home, "--config", str(self.config()), "--runner", "opencode")
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertEqual(json.loads((self.org / "portfolio.json").read_text())["runner"], "opencode")
        oc = self.home / ".config" / "opencode" / "agents"
        lead = (oc / "acme-lead.md").read_text()
        self.assertIn("mode: primary", lead)
        self.assertIn('"git push --force*": deny', lead)
        self.assertIn("mode: subagent", (oc / "sales-manager.md").read_text())
        self.assertEqual(commits(self.org), 2)

        r = run(self.home, "--config", str(self.config(runner="gpt-cli")))
        self.assertEqual(r.returncode, 2)

    def test_dry_run_writes_nothing(self):
        r = run(self.home, "--config", str(self.config()), "--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Nothing was written", r.stdout)
        self.assertFalse(self.org.exists())
        self.assertFalse(self.agents.exists())

    def test_other_org_dir_warns(self):
        r = run(self.home, "--config", str(self.config()), "--org-dir", str(self.home / "elsewhere"), "--yes")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Pulse reads ~/portfolio only", r.stdout)
        self.assertTrue((self.home / "elsewhere/portfolio.json").is_file())
        self.assertIn(str(self.home / "elsewhere"), (self.agents / "acme-lead.md").read_text())

    def test_bad_configs_stop_before_writing(self):
        for bad in [{"owner": ""},
                    {"entities": [{"id": "Bad Id!", "name": "x"}]},
                    {"entities": [{"id": "x", "group": "nope"}]},
                    {"entities": [{"id": "x", "color": "red"}]},
                    {"entities": [{"id": "x", "parent": "y"}]},
                    {"entities": [{"id": "x", "logo": "/no/such.svg"}]},
                    {"entities": [{"id": "x", "dirs": ["~"]}]},
                    {"entities": [{"id": "x", "dirs": [3]}]},
                    {"entities": []}]:
            r = run(self.home, "--config", str(self.config(**bad)))
            self.assertEqual(r.returncode, 2, bad)
            self.assertIn("Setup stopped", r.stderr)
        self.assertFalse(self.org.exists())


if __name__ == "__main__":
    unittest.main(verbosity=1)
