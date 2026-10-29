#!/usr/bin/env python3
"""Unit checks for runners.py and nightly.run on each runner, against a throwaway portfolio.
The fixtures are real event streams (opencode 1.19.5 runs with a free model; a signed-out
codex-cli 0.165.0 run) plus one codex stream built from codex's documented event schema.
Run: python3 bin/test_runners.py"""
import json, os, pathlib, shutil, stat, subprocess, sys, tempfile, unittest

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="runners-test-"))
os.environ["PORTFOLIO_ROOT"] = str(ROOT)
os.environ.pop("PORTFOLIO_RUN_ID", None)
HERE = pathlib.Path(__file__).resolve().parent
FIX = HERE / "fixtures"
sys.path.insert(0, str(HERE))
import live  # noqa: E402
import runners  # noqa: E402
import nightly  # noqa: E402

# Nothing a test installs may land in the real home.
runners.OpenCode.AGENTS = ROOT / "home" / ".config" / "opencode" / "agents"
runners.Codex.RULES = ROOT / "home" / ".codex" / "rules" / "pulse-org.rules"
runners.AGENTS_DIR = ROOT / "agents"

FAKE_CLI = r'''#!/usr/bin/env python3
import json, os, sys
with open(os.environ["FAKE_ARGV"], "w") as f:
    json.dump(sys.argv, f)
sys.stdout.write(open(os.environ["FAKE_FIXTURE"]).read())
sys.exit(int(os.environ.get("FAKE_EXIT", "0")))
'''

LEAD = """---
name: acme-lead
description: Operating lead for Acme.
role: lead
tier: deep
---

You are the operating lead for **Acme**.
"""


def lines_of(session, fixture):
    out = []
    for raw in (FIX / fixture).read_text().splitlines():
        out += session.feed(json.loads(raw))
    return out


def write_registry(runner):
    (ROOT / "companies/acme").mkdir(parents=True, exist_ok=True)
    reg = {"entities": [{"id": "acme", "name": "Acme", "path": "companies/acme", "lead": "acme-lead", "schedule": "nightly"}]}
    if runner is not None:
        reg["runner"] = runner
    (ROOT / "portfolio.json").write_text(json.dumps(reg))


class ResolveTests(unittest.TestCase):
    def test_default_is_claude_code(self):
        self.assertEqual(runners.resolve({})["name"], "claude-code")
        self.assertEqual(runners.resolve(None)["name"], "claude-code")

    def test_org_and_entity_override(self):
        reg = {"runner": {"name": "codex", "model": "gpt-5.5", "network": False},
               "entities": [{"id": "a"}, {"id": "b", "runner": {"model": "gpt-5.5-mini"}},
                            {"id": "c", "runner": "opencode"}, {"id": "d", "runner": {"name": "opencode", "model": "anthropic/x"}}]}
        self.assertEqual(runners.resolve(reg, "a"), {"name": "codex", "model": "gpt-5.5", "network": False})
        self.assertEqual(runners.resolve(reg, "b")["model"], "gpt-5.5-mini")
        self.assertEqual(runners.resolve(reg, "b")["name"], "codex")
        # A different runner never inherits the org's model names (they belong to another CLI).
        self.assertEqual(runners.resolve(reg, "c"), {"name": "opencode"})
        self.assertEqual(runners.resolve(reg, "d")["model"], "anthropic/x")
        with self.assertRaises(ValueError):
            runners.resolve({"runner": "gpt-cli"})

    def test_models_by_tier(self):
        self.assertEqual(runners.ClaudeCode().model("sonnet"), "sonnet")
        self.assertEqual(runners.ClaudeCode({"name": "claude-code", "plan_model": "sonnet"}).model("opus"), "sonnet")
        self.assertIsNone(runners.Codex().model("sonnet"))          # the account's default model
        c = runners.Codex({"name": "codex", "model": "m1", "plan_model": "m2"})
        self.assertEqual((c.model("sonnet"), c.model("opus")), ("m1", "m2"))

    def test_capabilities(self):
        self.assertTrue(runners.ClaudeCode.subagents)
        self.assertTrue(runners.OpenCode.subagents)
        self.assertFalse(runners.Codex.subagents)
        self.assertEqual(runners.ClaudeCode().solo_note(), "")
        self.assertIn("can't deploy agents", runners.Codex().solo_note())


class CodexTests(unittest.TestCase):
    def test_tools_team_and_tokens(self):
        s = runners.CodexSession()
        out = lines_of(s, "codex-team-and-tools.jsonl")
        tools = [x["summary"] for x in out if x["t"] == "tool"]
        self.assertEqual(tools, ["Running: cat portfolio/companies/acme/BRIEF.md",
                                 "Searching the web: local bakery website pricing 2026",
                                 "Editing ~/portfolio/companies/acme/status.json".replace("~/", "/home/sam/"),
                                 "Drafting an email", "Pushing a branch"])
        errors = [x["text"] for x in out if x["t"] == "error"]
        self.assertEqual(len(errors), 1)
        self.assertIn("declined", errors[0])
        deploy = next(x for x in out if x["t"] == "deploy")
        self.assertEqual((deploy["agents"][0]["id"], deploy["agents"][0]["prompt"]), ("item_6", "Research three competitors."))
        done = next(x for x in out if x["t"] == "agent_done")
        self.assertEqual((done["id"], done["status"], done["summary"]), ("item_6", "completed", "Three competitors found."))
        self.assertEqual(out[-1], {**out[-1], "t": "text"})
        summ = s.summary(0)
        self.assertTrue(summ["ok"])
        self.assertIsNone(summ["cost_usd"])          # codex reports tokens, never cost
        self.assertEqual(summ["tokens"], {"input": 24763, "output": 186})
        self.assertIn("Force-push was declined", summ["result"])

    def test_signed_out_run_fails_cleanly(self):
        s = runners.CodexSession()
        out = lines_of(s, "codex-signed-out.jsonl")
        self.assertFalse(any("Reconnecting" in x.get("text", "") for x in out))
        self.assertTrue(all(x["t"] == "error" for x in out))
        summ = s.summary(1)
        self.assertFalse(summ["ok"])
        self.assertIn("401 Unauthorized", summ["result"])
        self.assertIsNone(summ["tokens"])

    def test_command_guardrails(self):
        (ROOT / "agents").mkdir(exist_ok=True)
        (ROOT / "agents" / "acme-lead.md").write_text(LEAD)
        cmd = runners.Codex({"name": "codex", "network": False}).command("codex", "acme-lead", "NIGHTLY", "gpt-x", 60)
        self.assertEqual(cmd[:4], ["codex", "exec", "--json", "--skip-git-repo-check"])
        self.assertEqual(cmd[cmd.index("--sandbox") + 1], "workspace-write")
        self.assertIn('approval_policy="never"', cmd)
        self.assertIn("sandbox_workspace_write.network_access=false", cmd)
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", cmd)
        self.assertNotIn("--approve-for-me", cmd)
        instr = next(c for c in cmd if c.startswith("developer_instructions="))
        self.assertEqual(json.loads(instr.split("=", 1)[1]), "You are the operating lead for **Acme**.\n")
        self.assertEqual(cmd[-3:], ["-m", "gpt-x", "NIGHTLY"])

    def test_rules_cover_the_policy(self):
        rules = runners.codex_rules()
        for needle in ['"git", "push", ["--force"', '"gh", "pr", "merge"', '"rm", ["-rf"', '["main", "master", "develop"]']:
            self.assertIn(needle, rules)
        self.assertEqual(rules.count('decision = "forbidden"'), len(runners.policy.SHELL_FORBIDDEN))

    @unittest.skipUnless(shutil.which("codex", path=runners.search_path()), "codex not installed")
    def test_rules_with_the_real_codex(self):
        path = ROOT / "check.rules"
        path.write_text(runners.codex_rules())
        codex = shutil.which("codex", path=runners.search_path())
        for cmd, want in ((["git", "push", "--force", "origin", "x"], "forbidden"), (["git", "push", "origin", "main"], "forbidden"),
                          (["gh", "pr", "merge", "3"], "forbidden"), (["git", "push", "origin", "feat/x"], None)):
            out = json.loads(subprocess.run([codex, "execpolicy", "check", "--rules", str(path), "--", *cmd],
                                            capture_output=True, text=True, timeout=30).stdout)
            self.assertEqual(out.get("decision"), want, cmd)


class OpenCodeTests(unittest.TestCase):
    def test_solo_run(self):
        s = runners.OpenCodeSession()
        out = lines_of(s, "opencode-solo.jsonl")
        self.assertEqual([x["t"] for x in out], ["tool", "tool", "text"])
        self.assertEqual(out[0]["summary"], "Reading /home/sam/demo/note.txt")
        self.assertEqual(out[1]["summary"], "Running: ls")
        summ = s.summary(0)
        self.assertTrue(summ["ok"])
        self.assertEqual(summ["cost_usd"], 0)        # reported by opencode (a free model), not estimated
        self.assertEqual(summ["tokens"], {"input": 6080 + 1792 + 283 + 7808, "output": 113 + 21})

    def test_subagent_is_a_deployment(self):
        out = lines_of(runners.OpenCodeSession(), "opencode-team.jsonl")
        deploy = next(x for x in out if x["t"] == "deploy")
        self.assertEqual((deploy["agents"][0]["type"], deploy["agents"][0]["description"]), ("researcher", "Summarize note.txt"))
        done = next(x for x in out if x["t"] == "agent_done")
        self.assertEqual((done["status"], done["secs"]), ("completed", 3))
        self.assertTrue(done["summary"].startswith("**File path:**"))
        self.assertNotIn("<task", done["summary"])

    def test_denied_command_is_an_error_line(self):
        s = runners.OpenCodeSession()
        out = lines_of(s, "opencode-denied.jsonl")
        self.assertEqual([x["t"] for x in out], ["tool", "error", "text"])
        self.assertIn("prevents you from using this specific tool call", out[1]["text"])
        self.assertTrue(s.summary(0)["ok"])

    def test_run_that_stops_mid_task_is_not_ok(self):
        # Real stream shape: an auto-rejected permission ends the run after a tool-calls step.
        s = runners.OpenCodeSession()
        for raw in (FIX / "opencode-denied.jsonl").read_text().splitlines()[:3]:
            s.feed(json.loads(raw))
        summ = s.summary(0)
        self.assertFalse(summ["ok"])
        self.assertIn("stopped before finishing", summ["result"])

    def test_agent_file_carries_the_policy(self):
        text = runners.for_opencode(*runners.split_agent(LEAD))
        meta, body = runners.split_agent(text)
        self.assertEqual((meta["mode"], meta["description"]), ("primary", '"Operating lead for Acme."'))
        self.assertIn('    "*": deny', text)
        self.assertIn('    "git push --force*": deny', text)
        self.assertIn('    "gh pr merge*": deny', text)
        self.assertIn('    "git *": allow', text)
        self.assertLess(text.index('"git *": allow'), text.index('"git push --force*": deny'))   # last match wins
        self.assertIn("  task: allow", text)
        self.assertIn("  external_directory: deny", text)
        manager = runners.for_opencode(*runners.split_agent(LEAD.replace("role: lead", "role: manager")))
        self.assertIn("mode: subagent", manager)
        self.assertIn("  task: deny", manager)
        self.assertEqual(body, "You are the operating lead for **Acme**.\n")


class ClaudeTranslationTests(unittest.TestCase):
    def test_claude_file_is_unchanged_in_shape(self):
        out = runners.for_claude(*runners.split_agent(LEAD))
        self.assertEqual(out, "---\nname: acme-lead\ndescription: Operating lead for Acme.\nmodel: opus\n---\n\n"
                              "You are the operating lead for **Acme**.\n")


class RunOnEachRunnerTests(unittest.TestCase):
    """nightly.run end to end with a fake CLI that replays a fixture."""

    def setUp(self):
        for d in (live.LIVE, live.TRANSCRIPTS):
            if d.exists():
                shutil.rmtree(d)
        fake = ROOT / "fake-cli"
        fake.write_text(FAKE_CLI)
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        self.argv = ROOT / "argv.json"
        os.environ["FAKE_ARGV"] = str(self.argv)
        nightly.BINARIES.update({"codex": str(fake), "opencode": str(fake)})
        (ROOT / "agents").mkdir(exist_ok=True)
        (ROOT / "agents" / "acme-lead.md").write_text(LEAD)
        for m in ("sales-manager", "marketing-manager", "delivery-manager", "finance-manager", "admin-manager"):
            (ROOT / "agents" / f"{m}.md").write_text(LEAD.replace("acme-lead", m).replace("role: lead", "role: manager"))

    def tearDown(self):
        nightly.BINARIES.clear()
        os.environ.pop("FAKE_EXIT", None)

    def transcript(self, run_id):
        return [json.loads(l) for l in (live.TRANSCRIPTS / f"{run_id}.jsonl").read_text().splitlines()]

    def test_codex_run(self):
        write_registry("codex")
        os.environ["FAKE_FIXTURE"] = str(FIX / "codex-team-and-tools.jsonl")
        res = nightly.run("acme-lead", "NIGHTLY run", "sonnet", timeout=20, entity="acme", doing="Night shift for Acme")
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["runner"], "codex")
        self.assertIsNone(res["cost_usd"])
        self.assertEqual(res["tokens"], {"input": 24763, "output": 186})
        self.assertEqual(res["models"], [])
        argv = json.loads(self.argv.read_text())
        self.assertIn("can't deploy agents", argv[-1])           # the solo note rides on the prompt
        self.assertTrue(argv[-1].startswith("NIGHTLY run"))
        t = self.transcript(res["run_id"])
        self.assertEqual(t[0]["t"], "start")
        self.assertEqual(t[-1]["t"], "result")
        self.assertEqual((t[-1]["cost_usd"], t[-1]["tokens"], t[-1]["runner"]), (None, {"input": 24763, "output": 186}, "codex"))
        f = json.loads((live.LIVE / f"{res['run_id']}.json").read_text())
        self.assertEqual((f["state"], f["runner"], f["tokens"]["output"]), ("finished", "codex", 186))
        self.assertTrue(runners.Codex.RULES.exists())            # guardrails installed on first run

    def test_codex_signed_out(self):
        write_registry({"name": "codex"})
        os.environ["FAKE_FIXTURE"] = str(FIX / "codex-signed-out.jsonl")
        os.environ["FAKE_EXIT"] = "1"
        res = nightly.run("acme-lead", "x", "sonnet", timeout=20, entity="acme")
        self.assertFalse(res["ok"])
        self.assertIn("401", res["result"])
        self.assertEqual(json.loads((live.LIVE / f"{res['run_id']}.json").read_text())["state"], "failed")

    def test_opencode_run_with_a_team(self):
        write_registry("opencode")
        os.environ["FAKE_FIXTURE"] = str(FIX / "opencode-team.jsonl")
        res = nightly.run("acme-lead", "x", "sonnet", timeout=20, entity="acme")
        self.assertTrue(res["ok"])
        self.assertEqual((res["agents"], res["cost_usd"]), (1, 0))
        argv = json.loads(self.argv.read_text())
        self.assertEqual(argv[1:6], ["run", "--format", "json", "--agent", "acme-lead"])
        self.assertNotIn("can't deploy agents", argv[-1])
        team = json.loads((live.LIVE / f"{res['run_id']}.json").read_text())["team"]
        self.assertEqual((team[0]["type"], team[0]["status"]), ("researcher", "completed"))
        # The lead and the managers it can call were installed for opencode, never overwritten.
        self.assertTrue((runners.OpenCode.AGENTS / "acme-lead.md").exists())
        self.assertTrue((runners.OpenCode.AGENTS / "sales-manager.md").exists())
        (runners.OpenCode.AGENTS / "acme-lead.md").write_text("mine")
        nightly.run("acme-lead", "x", "sonnet", timeout=20, entity="acme")
        self.assertEqual((runners.OpenCode.AGENTS / "acme-lead.md").read_text(), "mine")

    def test_missing_cli_fails_with_the_install_hint(self):
        write_registry("opencode")
        nightly.BINARIES.clear()
        old = runners.EXTRA_PATH[:]
        runners.EXTRA_PATH[:] = []
        path = os.environ.get("PATH", "")
        os.environ["PATH"] = "/nonexistent"
        try:
            res = nightly.run("acme-lead", "x", "sonnet", timeout=20, entity="acme")
        finally:
            runners.EXTRA_PATH[:] = old
            os.environ["PATH"] = path
        self.assertFalse(res["ok"])
        self.assertIn("opencode (any provider) is not installed", res["result"])

    def test_claude_code_stays_the_default(self):
        write_registry(None)
        self.assertEqual(nightly.runner_for("acme").name, "claude-code")


if __name__ == "__main__":
    unittest.main(verbosity=1)
