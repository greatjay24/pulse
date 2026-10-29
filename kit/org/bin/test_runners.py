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
with open(os.environ["FAKE_ARGV"] + ".ctx", "w") as f:
    json.dump({"cwd": os.getcwd(), "opencode": os.environ.get("OPENCODE_CONFIG_CONTENT")}, f)
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
        dirs = [str(ROOT), "/home/sam/code/acme-site"]
        cmd = runners.Codex({"name": "codex", "network": False}).command("codex", "acme-lead", "NIGHTLY", "gpt-x", 60, dirs)
        self.assertEqual(cmd[:4], ["codex", "exec", "--json", "--skip-git-repo-check"])
        self.assertEqual(cmd[cmd.index("-C") + 1], str(ROOT))              # starts in the org folder
        self.assertIn('approval_policy="never"', cmd)
        self.assertIn('default_permissions="pulse-org"', cmd)
        self.assertIn('permissions.pulse-org.extends=":workspace"', cmd)
        files = next(c for c in cmd if c.startswith("permissions.pulse-org.filesystem="))
        self.assertIn('":root"="deny"', files)
        self.assertIn('":minimal"="read"', files)
        self.assertIn('"~/.gitconfig"="read"', files)
        self.assertNotIn(":tmpdir", files)
        self.assertIn("permissions.pulse-org.network.enabled=false", cmd)
        self.assertIn('permissions.pulse-org.workspace_roots={"/home/sam/code/acme-site"=true}', cmd)
        # Permission profiles replace the older sandbox flags; mixing them would switch the profile off.
        self.assertNotIn("--sandbox", cmd)
        self.assertFalse(any(c.startswith("sandbox_workspace_write") for c in cmd))
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
    def test_profile_confines_reads_with_the_real_codex(self):
        """`codex sandbox` runs one local command under the profile; no model is called."""
        home = ROOT / "sbx-home"
        org, site, private = home / "portfolio", home / "code" / "site", home / "private"
        for d, f in ((org, "BRIEF.md"), (site, "index.html"), (private, "notes.txt")):
            d.mkdir(parents=True, exist_ok=True)
            (d / f).write_text(f"{f} body")
        codex = shutil.which("codex", path=runners.search_path())
        # temp off: this test's folders live under the temp dir, a real org doesn't.
        flags = runners.Codex({"name": "codex", "temp": False, "read_also": []}).profile([str(org), str(site)])
        (ROOT / "codex-home").mkdir(exist_ok=True)

        def run(*cmd):
            p = subprocess.run([codex, "sandbox", *flags, "-P", "pulse-org", "-C", str(org), "--", *cmd],
                               capture_output=True, text=True, timeout=60, env={**os.environ, "CODEX_HOME": str(ROOT / "codex-home")})
            return p.returncode, p.stdout
        self.assertEqual(run("cat", str(org / "BRIEF.md")), (0, "BRIEF.md body"))
        self.assertEqual(run("cat", str(site / "index.html")), (0, "index.html body"))
        self.assertNotEqual(run("cat", str(private / "notes.txt"))[0], 0)
        self.assertNotEqual(run("ls", str(home))[0], 0)
        self.assertNotEqual(run("ls", "/Users")[0], 0)

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
        self.assertIn("  external_directory:\n    \"*\": deny\n", text)
        # Read commands are not allowed on any path in the static file: only the run's dirs open them.
        self.assertNotIn('"cat *"', text)
        self.assertNotIn('"ls *"', text)
        manager = runners.for_opencode(*runners.split_agent(LEAD.replace("role: lead", "role: manager")))
        self.assertIn("mode: subagent", manager)
        self.assertIn("  task: deny", manager)
        self.assertEqual(body, "You are the operating lead for **Acme**.\n")

    def test_run_permissions_open_only_the_work_dirs(self):
        dirs = ["/home/sam/portfolio", "/home/sam/code/site"]
        env = runners.OpenCode().env("acme-lead", dirs)
        cfg = json.loads(env["OPENCODE_CONFIG_CONTENT"])
        self.assertEqual(set(cfg["agent"]), {"acme-lead", *runners.MANAGERS})
        lead, manager = cfg["agent"]["acme-lead"]["permission"], cfg["agent"]["sales-manager"]["permission"]
        self.assertEqual(lead["external_directory"], {"*": "deny", "/home/sam/code/site/**": "allow"})
        self.assertEqual((lead["task"], manager["task"]), ("allow", "deny"))
        bash = lead["bash"]
        self.assertEqual(bash["cat /home/sam/portfolio*"], "allow")
        self.assertEqual(bash["grep -* /home/sam/code/site*"], "allow")
        self.assertNotIn("cat *", bash)
        self.assertEqual(list(bash)[0], "*")
        self.assertEqual(bash["git push --force*"], "deny")
        self.assertEqual(lead["read"]["*.env"], "deny")
        oc = runners.OpenCode().command("opencode", "acme-lead", "x", None, 60, dirs)
        self.assertEqual(oc[oc.index("--dir") + 1], "/home/sam/portfolio")

    @unittest.skipUnless(shutil.which("opencode", path=runners.search_path()), "opencode not installed")
    def test_permissions_with_the_real_opencode(self):
        """`opencode debug agent --tool` runs one tool under the agent's permissions; no model is called."""
        home = ROOT / "oc-home"
        org, site, private = home / "portfolio", home / "code" / "site", home / "private"
        for d, f in ((org, "BRIEF.md"), (site, "index.html"), (private, "notes.txt")):
            d.mkdir(parents=True, exist_ok=True)
            (d / f).write_text(f"{f} body")
        subprocess.run(["git", "init", "-q", str(org)], check=True)
        agents = home / ".config" / "opencode" / "agents"
        agents.mkdir(parents=True, exist_ok=True)
        (agents / "acme-lead.md").write_text(runners.for_opencode(*runners.split_agent(LEAD)))
        env = {**os.environ, "HOME": str(home), "XDG_CONFIG_HOME": str(home / ".config"), "XDG_DATA_HOME": str(home / ".local/share"),
               "XDG_CACHE_HOME": str(home / ".cache"), "XDG_STATE_HOME": str(home / ".local/state"),
               **runners.OpenCode().env("acme-lead", [str(org), str(site)])}
        oc = shutil.which("opencode", path=runners.search_path())

        def tool(name, **params):
            p = subprocess.run([oc, "debug", "agent", "acme-lead", "--tool", name, "--params", json.dumps(params)],
                               capture_output=True, text=True, timeout=120, env=env, cwd=str(org))
            return p.stdout + p.stderr
        self.assertIn("BRIEF.md body", tool("read", filePath=str(org / "BRIEF.md")))
        self.assertIn("index.html body", tool("read", filePath=str(site / "index.html")))
        self.assertNotIn("notes.txt body", tool("read", filePath=str(private / "notes.txt")))
        self.assertNotIn("notes.txt body", tool("bash", command=f"cat {private / 'notes.txt'}", description="x"))
        self.assertIn("index.html body", tool("bash", command=f"cat {site / 'index.html'}", description="x"))


class WorkDirsTests(unittest.TestCase):
    def test_org_first_then_dirs(self):
        reg = {"dirs": ["~/code/shared"], "entities": [{"id": "acme", "dirs": ["~/code/acme-site", "~/code/shared", "~", "/"]}]}
        dirs = runners.work_dirs(reg, "acme")
        home = str(pathlib.Path.home().resolve())
        self.assertEqual(dirs, [str(ROOT.resolve()), f"{home}/code/shared", f"{home}/code/acme-site"])
        self.assertEqual(runners.work_dirs({}, None), [str(ROOT.resolve())])


class ClaudeTranslationTests(unittest.TestCase):
    def test_command_confines_reads(self):
        cmd = runners.ClaudeCode().command("claude", "acme-lead", "x", "sonnet", 5, ["/home/sam/portfolio", "/home/sam/code/site"])
        settings = json.loads(cmd[cmd.index("--settings") + 1])
        self.assertTrue(settings["permissions"]["blockReadsOutsideWorkingDirectories"])
        self.assertEqual(cmd[cmd.index("--add-dir") + 1], "/home/sam/code/site")
        allowed = cmd[cmd.index("--allowedTools") + 1:cmd.index("--disallowedTools")]
        self.assertNotIn("Bash(cat *)", allowed)
        self.assertNotIn("Bash(ls *)", allowed)
        self.assertIn("Bash(git *)", allowed)
        self.assertLess(cmd.index("--add-dir"), cmd.index("--allowedTools"))      # variadic flags last
        self.assertNotIn("--add-dir", runners.ClaudeCode().command("claude", "a", "x", "sonnet", 5, ["/o"]))

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
        self.assertEqual(argv[argv.index("-C") + 1], str(ROOT.resolve()))
        self.assertNotIn("--sandbox", argv)
        self.assertIn("can't deploy agents", argv[-1])           # the solo note rides on the prompt
        self.assertTrue(argv[-1].startswith("NIGHTLY run"))
        t = self.transcript(res["run_id"])
        self.assertEqual(t[0]["t"], "start")
        self.assertEqual(t[-1]["t"], "result")
        self.assertEqual((t[-1]["cost_usd"], t[-1]["tokens"], t[-1]["runner"]), (None, {"input": 24763, "output": 186}, "codex"))
        f = json.loads((live.LIVE / f"{res['run_id']}.json").read_text())
        self.assertEqual((f["state"], f["runner"], f["tokens"]["output"]), ("finished", "codex", 186))
        # A run never writes into codex's config folder; it says the rules are missing instead.
        self.assertFalse(runners.Codex.RULES.exists())
        self.assertTrue(any(x["t"] == "error" and "--install-codex-rules" in x["text"] for x in t))

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
        names = ["acme-lead", *runners.MANAGERS]
        missing = {f"{a}.md" for a in names if not (runners.OpenCode.AGENTS / f"{a}.md").exists()}
        res = nightly.run("acme-lead", "x", "sonnet", timeout=20, entity="acme")
        self.assertTrue(res["ok"])
        self.assertEqual((res["agents"], res["cost_usd"]), (1, 0))
        argv = json.loads(self.argv.read_text())
        self.assertEqual(argv[1:6], ["run", "--format", "json", "--agent", "acme-lead"])
        self.assertEqual(argv[argv.index("--dir") + 1], str(ROOT.resolve()))
        ctx = json.loads(pathlib.Path(str(self.argv) + ".ctx").read_text())
        self.assertEqual(pathlib.Path(ctx["cwd"]).resolve(), ROOT.resolve())         # runs from the org folder
        self.assertIn("acme-lead", json.loads(ctx["opencode"])["agent"])           # this run's permissions
        self.assertNotIn("can't deploy agents", argv[-1])
        team = json.loads((live.LIVE / f"{res['run_id']}.json").read_text())["team"]
        self.assertEqual((team[0]["type"], team[0]["status"]), ("researcher", "completed"))
        # The lead and the managers it can call were installed for opencode, never overwritten,
        # and the transcript says so.
        self.assertTrue((runners.OpenCode.AGENTS / "acme-lead.md").exists())
        t = self.transcript(res["run_id"])
        installed = [x["summary"] for x in t if x["t"] == "tool" and x["summary"].startswith("Installed agent file")]
        self.assertEqual({x.rsplit("/", 1)[-1] for x in installed}, missing)
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


# Odd shapes seen in the wild or plausible after a CLI update: a string where an object was
# expected, string or numeric content items, list ids, non-dict usage. Each stream ends with
# valid events, so a run that survives them finishes normally.
MALFORMED = {
    "claude-code": [
        {"type": "assistant", "message": "just a string"},
        {"type": "assistant", "message": {"content": "a string, not a list"}},
        {"type": "assistant", "message": {"content": ["str item", 5, None, {"type": "text", "text": 7},
                                                    {"type": "tool_use", "name": "Agent", "id": ["x"], "input": "not a dict"},
                                                    {"type": "tool_use", "name": "Read", "input": ["x"]}]}},
        {"type": "user", "toolUseResult": "a string", "message": {"content": [
            "str item", {"type": "tool_result", "tool_use_id": ["a"], "content": [{"text": 3}, "x"]},
            {"type": "text", "text": {"not": "a string"}}]}},
        {"type": "system", "subtype": "task_notification", "tool_use_id": {"a": 1}, "usage": "lots", "summary": 5, "status": 3},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "Done after odd events."}]}},
        {"type": "result", "is_error": False, "result": "Done after odd events.", "total_cost_usd": 0.01,
         "duration_ms": 1000, "num_turns": 2, "usage": "x", "subagent_stats": "x", "modelUsage": ["not", "a", "dict"]},
    ],
    "codex": [
        {"type": "thread.started", "thread_id": ["x"]},
        {"type": "item.completed", "item": "a string"},
        {"type": "item.started", "item": {"id": ["x"], "type": "command_execution", "command": 5}},
        {"type": "item.completed", "item": {"id": {"a": 1}, "type": "command_execution", "command": None, "status": "failed"}},
        {"type": "item.completed", "item": {"type": "file_change", "changes": ["a", {"path": 3, "kind": [1]}]}},
        {"type": "item.started", "item": {"type": "mcp_tool_call", "server": 1, "tool": None, "arguments": "x"}},
        {"type": "item.completed", "item": {"type": "mcp_tool_call", "error": "boom", "status": "failed"}},
        {"type": "item.started", "item": {"type": "collab_tool_call", "tool": "spawn_agent", "prompt": 9}},
        {"type": "item.completed", "item": {"type": "collab_tool_call", "tool": "spawn_agent", "receiver_thread_ids": "t1",
                                            "agents_states": "x"}},
        {"type": "item.completed", "item": {"type": "collab_tool_call", "agents_states": {"t1": "running", "t2": {"status": "completed", "message": 4}}}},
        {"type": "error", "message": {"x": 1}},
        {"type": "turn.completed", "usage": "lots"},
        {"type": "turn.completed", "usage": {"input_tokens": "10", "output_tokens": 5, "reasoning_output_tokens": None}},
        {"type": "item.completed", "item": {"id": "item_9", "type": "agent_message", "text": "Done after odd events."}},
        {"type": "turn.completed", "usage": {"input_tokens": 100, "output_tokens": 20}},
    ],
    "opencode": [
        {"type": "text", "part": "a string"},
        {"type": "text", "part": {"text": ["x"]}},
        {"type": "tool_use", "part": {"tool": 5, "state": "x"}},
        {"type": "tool_use", "part": {"tool": "read", "state": {"input": "x", "status": "error", "error": {"m": 1}}}},
        {"type": "tool_use", "part": {"tool": "task", "callID": ["c"], "state": {"input": "x", "time": {"start": "a", "end": None}, "output": 7}}},
        {"type": "step_finish", "part": {"tokens": "x", "cost": "1", "reason": ["stop"]}},
        {"type": "step_finish", "part": {"tokens": {"cache": "x", "input": "5", "output": None}, "cost": True}},
        {"type": "text", "part": {"text": "Done after odd events."}},
        {"type": "step_finish", "part": {"tokens": {"input": 10, "output": 2}, "cost": 0.002, "reason": "stop"}},
    ],
}


class MalformedEventTests(unittest.TestCase):
    """A tracking or translation problem must never stop a run (a night shift once crashed on
    every lead with "'str' object has no attribute 'get'")."""

    def setUp(self):
        for d in (live.LIVE, live.TRANSCRIPTS):
            if d.exists():
                shutil.rmtree(d)
        self.errors = live.LOGS / ".live_errors.jsonl"
        if self.errors.exists():
            self.errors.unlink()
        fake = ROOT / "fake-cli"
        fake.write_text(FAKE_CLI)
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        os.environ["FAKE_ARGV"] = str(ROOT / "argv.json")
        nightly.BINARIES.update({"codex": str(fake), "opencode": str(fake)})
        self.old_claude = nightly.CLAUDE
        nightly.CLAUDE = str(fake)
        (ROOT / "agents").mkdir(exist_ok=True)
        (ROOT / "agents" / "acme-lead.md").write_text(LEAD)

    def tearDown(self):
        nightly.BINARIES.clear()
        nightly.CLAUDE = self.old_claude
        os.environ.pop("FAKE_EXIT", None)

    def replay(self, runner, events):
        write_registry(runner)
        path = ROOT / f"malformed-{runner}.jsonl"
        path.write_text("".join(json.dumps(e) + "\n" for e in events) + "not json at all\n[1, 2]\n")
        os.environ["FAKE_FIXTURE"] = str(path)
        return nightly.run("acme-lead", "NIGHTLY run", "sonnet", timeout=20, entity="acme", doing="Night shift for Acme")

    def test_each_adapter_survives_malformed_events(self):
        for runner, events in MALFORMED.items():
            with self.subTest(runner=runner):
                for name, session in (("claude-code", runners.ClaudeSession), ("codex", runners.CodexSession),
                                      ("opencode", runners.OpenCodeSession)):
                    if name == runner:
                        s = session()
                        for ev in events:
                            s.feed(ev)                  # (b): the translators type-check, nothing raises
                res = self.replay(runner, events)
                self.assertTrue(res["ok"], (runner, res))
                self.assertIn("Done after odd events.", res["result"])
                f = json.loads((live.LIVE / f"{res['run_id']}.json").read_text())
                self.assertEqual(f["state"], "finished")
                t = [json.loads(l) for l in (live.TRANSCRIPTS / f"{res['run_id']}.jsonl").read_text().splitlines()]
                self.assertEqual((t[0]["t"], t[-1]["t"]), ("start", "result"))
                self.assertFalse(self.errors.exists(), self.errors.read_text() if self.errors.exists() else "")

    def test_an_error_event_with_a_string_body_fails_the_run_cleanly(self):
        s = runners.OpenCodeSession()
        self.assertEqual(s.feed({"type": "error", "error": "a string"})[0]["text"], "a string")
        self.assertEqual((s.summary(0)["ok"], s.summary(0)["result"]), (False, "a string"))
        c = runners.CodexSession()
        c.feed({"type": "turn.failed", "error": "plain text"})
        self.assertEqual((c.summary(1)["ok"], c.summary(1)["result"]), (False, "plain text"))

    def test_a_tracking_exception_is_logged_redacted_and_the_run_finishes(self):
        key = "sk-" + "ant-" + "api03-" + "k" * 30
        boom = runners.OpenCodeSession.feed

        def flaky(session, ev):
            if ev.get("type") == "tool_use":
                raise AttributeError(f"'str' object has no attribute 'get' ({key})")
            return boom(session, ev)
        runners.OpenCodeSession.feed = flaky
        try:
            events = [{"type": "tool_use", "part": {"tool": "bash", "state": {"input": {"command": f"echo {key}"}}}},
                      {"type": "text", "part": {"text": "Done after odd events."}},
                      {"type": "step_finish", "part": {"reason": "stop", "tokens": {"input": 1, "output": 1}}}]
            res = self.replay("opencode", events)
        finally:
            runners.OpenCodeSession.feed = boom
        self.assertTrue(res["ok"], res)                                   # (a): the run continued
        rows = [json.loads(l) for l in self.errors.read_text().splitlines()]
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["run_id"], rows[0]["event_type"]), (res["run_id"], "tool_use"))
        self.assertIn("AttributeError", rows[0]["error"])
        self.assertNotIn(key, self.errors.read_text())                    # redacted


if __name__ == "__main__":
    unittest.main(verbosity=1)
