#!/usr/bin/env python3
"""Unit checks for live.py, nightly.run's streaming and session_hook.py against a throwaway
portfolio. Run: python3 bin/test_live.py"""
import json, os, pathlib, stat, sys, tempfile, time, unittest

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="live-test-"))
os.environ["PORTFOLIO_ROOT"] = str(ROOT)
os.environ.pop("PORTFOLIO_RUN_ID", None)
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import live  # noqa: E402
import nightly  # noqa: E402
import session_hook  # noqa: E402

# Built at runtime so this file never holds a whole key-shaped string.
FAKE = {
    "stripe": "sk_" + "live_" + "a1B2c3D4e5F6g7H8",
    "restricted": "rk_" + "live_" + "Zz9Yy8Xx7Ww6",
    "resend": "re_" + "AbCd1234_EfGh5678IjKl",
    "posthog": "phx_" + "q" * 30,
    "supabase": "sb_" + "secret_" + "Qw3rTy-uiop",
    "google": "AIza" + "S" * 35,
    "github": "ghp_" + "x" * 36,
    "github_pat": "github_" + "pat_" + "11AB" + "c" * 30,
    "jwt": "eyJ" + "hbGciOiJIUzI1NiJ9" + "." + "eyJzdWIiOiIxMjM0In0" + "." + "abcDEF123456ghiJKL",
    "slack": "xox" + "b-1234567890-abcdefghij",
    "anthropic": "sk-" + "ant-" + "api03-" + "k" * 30,
    "aws": "AKIA" + "ABCDEFGHIJKLMNOP",
}

FAKE_CLAUDE = r'''#!/usr/bin/env python3
import json, sys, time, os
mode = os.environ.get("FAKE_MODE", "ok")
key = os.environ.get("FAKE_KEY", "")
def emit(e):
    print(json.dumps(e), flush=True)
emit({"type": "system", "subtype": "init", "session_id": "s"})
emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Read",
      "input": {"file_path": os.environ["PORTFOLIO_ROOT"] + "/companies/acme/BRIEF.md"}}]}})
emit({"type": "user", "message": {"content": [{"type": "tool_result", "content": "secret file body " + key}]}})
emit({"type": "assistant", "message": {"content": [{"type": "text", "text": "Found the key " + key + " in env."}]}})
emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash",
      "input": {"command": "python3 ~/tools/draft_email.py --to x@y.z"}}]}})
if mode == "team":
    emit({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": "Agent", "id": "tu1", "input": {"subagent_type": "sales-manager",
         "description": "Find prospects", "prompt": "List ten prospects.\nMore detail", "run_in_background": False}},
        {"type": "tool_use", "name": "Agent", "id": "tu2", "input": {"subagent_type": "researcher",
         "description": "Market scan", "prompt": "Scan the market", "run_in_background": True}}]}})
    emit({"type": "system", "subtype": "task_started", "tool_use_id": "tu1", "task_id": "a1"})
    emit({"type": "assistant", "parent_tool_use_id": "tu1", "message": {"content": [
        {"type": "tool_use", "name": "Read", "input": {"file_path": "/x/LEADS.md"}}]}})
    emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "tu2", "content": "launched"}]}})
    emit({"type": "user", "tool_use_result": {"status": "completed", "content": [{"type": "text", "text": "Ten prospects " + key}],
          "totalDurationMs": 4000, "totalToolUseCount": 3},
          "message": {"content": [{"type": "tool_result", "tool_use_id": "tu1", "content": [{"type": "text", "text": "[Subagent hand-back] x\n\nTen prospects"}]}]}})
    emit({"type": "system", "subtype": "task_notification", "tool_use_id": "tu2", "status": "completed",
          "summary": "Market is busy", "usage": {"duration_ms": 9000, "tool_uses": 5}})
    emit({"type": "result", "subtype": "success", "is_error": False, "result": "Team done.", "total_cost_usd": 0.2,
          "duration_ms": 9000, "num_turns": 4, "modelUsage": {}, "subagent_stats": {"spawned": 2}})
    sys.exit(0)
if mode == "slow":
    time.sleep(30)
if mode == "noresult":
    sys.stderr.write("auth failed\n")
    sys.exit(1)
emit({"type": "result", "subtype": "success", "is_error": False, "result": "Done. Drafted one email.",
      "total_cost_usd": 0.0123, "duration_ms": 4200, "num_turns": 3, "modelUsage": {"claude-haiku": {}},
      "env_run_id": os.environ.get("PORTFOLIO_RUN_ID")})
'''


def fresh():
    for d in (live.LIVE, live.TRANSCRIPTS):
        if d.exists():
            for f in d.iterdir():
                f.unlink()


def transcript(run_id):
    return [json.loads(l) for l in (live.TRANSCRIPTS / f"{run_id}.jsonl").read_text().splitlines()]


def live_file(run_id):
    return json.loads((live.LIVE / f"{run_id}.json").read_text())


class RedactTests(unittest.TestCase):
    def test_every_key_shape_is_redacted(self):
        for name, key in FAKE.items():
            out = live.redact(f"use {key} now")
            self.assertNotIn(key, out, name)
            self.assertIn("[redacted]", out, name)

    def test_named_secrets_and_urls(self):
        name, value = "STRIPE_" + "SECRET_KEY", "abcdef" + "123456"   # built at runtime, like FAKE
        self.assertEqual(live.redact(f"{name}={value}"), f"{name}=[redacted]")
        self.assertEqual(live.redact('"api_key": "' + "hunter2" * 2 + '"'), '"api_key": "[redacted]"')
        self.assertEqual(live.redact("postgres://user:pa55word@db.host/x"), "postgres://user:[redacted]@db.host/x")
        pem = "-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----"
        self.assertEqual(live.redact(f"k: {pem} ok"), "k: [redacted] ok")

    def test_plain_text_is_left_alone(self):
        for s in ["Reading companies/acme/BRIEF.md", "Drafted 3 emails; PR #12 open", "pk_live is public", "the re_ prefix"]:
            self.assertEqual(live.redact(s), s)

    def test_redact_obj_walks_structures(self):
        out = live.redact_obj({"a": [FAKE["github"], {"b": FAKE["jwt"]}], "n": 3})
        self.assertNotIn(FAKE["github"], json.dumps(out))
        self.assertNotIn(FAKE["jwt"], json.dumps(out))
        self.assertEqual(out["n"], 3)


class NormalizeTests(unittest.TestCase):
    def test_tool_summaries(self):
        self.assertEqual(live.tool_summary("Read", {"file_path": str(ROOT / "companies/acme/BRIEF.md")}),
                         "Reading companies/acme/BRIEF.md")
        self.assertEqual(live.tool_summary("Bash", {"command": "python3 ~/tools/draft_email.py --to a"}),
                         "Drafting an email")
        self.assertEqual(live.tool_summary("Bash", {"command": "git -C ~/portfolio commit -m x"}), "Committing")
        self.assertEqual(live.tool_summary("mcp__claude_ai_Gmail__create_draft", {}), "Drafting an email")
        self.assertEqual(live.tool_summary("Agent", {"subagent_type": "sales-manager", "description": "Prospects"}),
                         "Asking sales-manager: Prospects")
        self.assertTrue(live.tool_summary("Bash", {"command": "ls " + "x" * 300}).endswith("…"))

    def test_events(self):
        lines = live.normalize({"type": "assistant", "message": {"content": [
            {"type": "thinking", "thinking": "hmm"},
            {"type": "text", "text": "Hello " + FAKE["stripe"]},
            {"type": "tool_use", "name": "Write", "input": {"file_path": "/tmp/x"}}]}})
        self.assertEqual([x["t"] for x in lines], ["text", "tool"])
        self.assertNotIn(FAKE["stripe"], json.dumps(lines))
        # Tool output is dropped unless it is an error; subagent turns are marked.
        self.assertEqual(live.normalize({"type": "user", "message": {"content": [
            {"type": "tool_result", "content": "big file"}]}}), [])
        err = live.normalize({"type": "user", "message": {"content": [
            {"type": "tool_result", "is_error": True, "content": [{"type": "text", "text": "denied"}]}]}})
        self.assertEqual(err[0]["t"], "error")
        sub = live.normalize({"type": "assistant", "parent_tool_use_id": "t1",
                              "message": {"content": [{"type": "text", "text": "sub says"}]}})
        self.assertTrue(sub[0]["sub"])
        # Session transcripts: the owner's prompts count, injected command output doesn't.
        self.assertEqual(live.normalize({"type": "user", "message": {"content": "Plan my week"}})[0]["text"], "Plan my week")
        self.assertEqual(live.normalize({"type": "user", "message": {"content": "<command-name>/clear</command-name>"}}), [])
        self.assertEqual(live.normalize({"type": "user", "isMeta": True, "message": {"content": "meta"}}), [])
        res = live.normalize({"type": "result", "is_error": False, "result": "ok", "total_cost_usd": 0.5,
                              "duration_ms": 61000, "num_turns": 4, "modelUsage": {"m": {}}})[0]
        self.assertEqual((res["ok"], res["cost_usd"], res["secs"], res["models"]), (True, 0.5, 61, ["m"]))


class LiveRunTests(unittest.TestCase):
    def setUp(self):
        fresh()

    def test_finalizes_on_exception(self):
        with self.assertRaises(RuntimeError):
            with live.LiveRun("act", "acme-lead", entity="acme", doing="Approve: X") as r:
                self.assertEqual(live_file(r.run_id)["state"], "running")
                raise RuntimeError("boom")
        f = live_file(r.run_id)
        self.assertEqual((f["state"], f["ok"]), ("failed", False))
        self.assertIn("boom", f["result"])
        self.assertEqual(transcript(r.run_id)[0]["t"], "start")

    def test_run_ids_are_slugs(self):
        rid = live.new_run_id("Acme Lead!")
        self.assertRegex(rid, live.RUN_ID)
        with self.assertRaises(ValueError):
            live.LiveRun("x", "a", run_id="../etc")
        with self.assertRaises(ValueError):
            live.LiveRun.load("../../x")

    def test_prune_keeps_running_and_recent(self):
        live.LIVE.mkdir(parents=True, exist_ok=True)
        old = time.time() - 3 * 86400
        for name, state in (("old-done", "finished"), ("old-running", "running"), ("old-dead", "running"), ("new-done", "failed")):
            p = live.LIVE / f"{name}.json"
            p.write_text(json.dumps({"state": state, "pid": 999999 if name == "old-dead" else os.getpid()}))
            if name.startswith("old"):
                os.utime(p, (old, old))
        live.prune()
        self.assertEqual(sorted(p.stem for p in live.LIVE.glob("*.json")), ["new-done", "old-running"])


class NightlyRunTests(unittest.TestCase):
    def setUp(self):
        fresh()
        fake = ROOT / "fake-claude"
        fake.write_text(FAKE_CLAUDE)
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        self.old = nightly.CLAUDE
        nightly.CLAUDE = str(fake)
        os.environ["FAKE_KEY"] = FAKE["resend"]

    def tearDown(self):
        nightly.CLAUDE = self.old
        os.environ.pop("FAKE_MODE", None)

    def test_streams_live_and_transcript_and_keeps_result_shape(self):
        res = nightly.run("acme-lead", "NIGHTLY run", "haiku", max_turns=3, timeout=20,
                          kind="nightly", entity="acme", doing="Night shift for Acme")
        self.assertEqual({k for k in res}, {"agent", "ok", "result", "cost_usd", "models", "secs", "run_id", "agents"})
        self.assertEqual(res["agents"], 0)   # worked solo
        self.assertEqual((res["ok"], res["cost_usd"], res["models"]), (True, 0.0123, ["claude-haiku"]))
        self.assertEqual(res["result"], "Done. Drafted one email.")
        f = live_file(res["run_id"])
        self.assertEqual((f["state"], f["entity"], f["kind"], f["doing"]), ("finished", "acme", "nightly", "Night shift for Acme"))
        self.assertEqual(f["step"], "Drafting an email")
        self.assertEqual(f["cost_usd"], 0.0123)
        t = transcript(res["run_id"])
        self.assertEqual([x["t"] for x in t], ["start", "tool", "text", "tool", "result"])
        self.assertEqual(t[1]["summary"], "Reading companies/acme/BRIEF.md")
        raw = (live.TRANSCRIPTS / f"{res['run_id']}.jsonl").read_text()
        self.assertNotIn(FAKE["resend"], raw)
        self.assertNotIn("secret file body", raw)   # tool output is never stored
        self.assertIn("[redacted]", raw)

    def test_team_deployments(self):
        os.environ["FAKE_MODE"] = "team"
        res = nightly.run("acme-lead", "x", "haiku", timeout=20, entity="acme", doing="Night shift for Acme")
        self.assertEqual(res["agents"], 2)
        f = live_file(res["run_id"])
        self.assertEqual(f["deployments"], 1)
        team = {a["id"]: a for a in f["team"]}
        self.assertEqual((team["tu1"]["type"], team["tu1"]["description"], team["tu1"]["prompt"], team["tu1"]["batch"]),
                         ("sales-manager", "Find prospects", "List ten prospects.", 0))
        self.assertEqual((team["tu1"]["status"], team["tu1"]["secs"]), ("completed", 4))
        self.assertNotIn(FAKE["resend"], json.dumps(f))
        # The background agent's launch receipt is not its end; the notification is.
        self.assertEqual((team["tu2"]["status"], team["tu2"]["summary"]), ("completed", "Market is busy"))
        t = transcript(res["run_id"])
        kinds = [x["t"] for x in t]
        self.assertEqual(kinds, ["start", "tool", "text", "tool", "deploy", "tool", "agent_done", "agent_done", "result"])
        self.assertTrue(t[5]["sub"])                      # the subagent's own tool call
        self.assertEqual(t[-1]["agents"], 2)
        self.assertEqual(t[6]["summary"].split(" ")[0:2], ["Ten", "prospects"])

    def test_async_launch_receipt_is_not_the_end(self):
        n = live.Normalizer()
        n.feed({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Agent", "id": "tx",
                "input": {"subagent_type": "qa", "description": "d", "prompt": "p"}}]}})
        receipt = n.feed({"type": "user", "tool_use_result": {"status": "async_launched"},
                          "message": {"content": [{"type": "tool_result", "tool_use_id": "tx", "content": "Async agent launched successfully."}]}})
        self.assertEqual(receipt, [])
        end = n.feed({"type": "system", "subtype": "task_notification", "tool_use_id": "tx", "status": "completed",
                      "summary": "ok", "usage": {"duration_ms": 1500, "tool_uses": 1}})
        self.assertEqual((end[0]["t"], end[0]["summary"], end[0]["secs"]), ("agent_done", "ok", 2))

    def test_close_deployments_share_a_batch(self):
        with live.LiveRun("act", "acme-lead", entity="acme") as r:
            r.deploy([{"id": "a", "type": "qa"}])
            r.deploy([{"id": "b", "type": "qa"}])
            self.assertEqual([m["batch"] for m in r.team()], [0, 0])
            r.team()[-1]["started"] = "2020-01-01T00:00:00+00:00"
            r.deploy([{"id": "c", "type": "qa"}])
            self.assertEqual(r.team()[-1]["batch"], 1)
            r.finish(True)

    def test_unfinished_agents_are_marked(self):
        with live.LiveRun("act", "acme-lead", entity="acme") as r:
            r.deploy([{"id": "x", "type": "qa", "description": "", "prompt": "", "background": True, "by": None}])
            r.finish(True, "done")
        self.assertEqual(live_file(r.run_id)["team"][0]["status"], "unfinished")

    def test_runner_marks_its_sessions(self):
        # claude sees PORTFOLIO_RUN_ID, so session_hook.py leaves runner sessions alone.
        nightly.run("acme-lead", "x", "haiku", timeout=20, entity="acme")
        self.assertIsNone(session_hook.handle({"agent_type": "acme-lead", "session_id": "abc",
                                               "hook_event_name": "SessionStart"},
                                              env={"PORTFOLIO_RUN_ID": "r"}))

    def test_no_result_fails_with_stderr(self):
        os.environ["FAKE_MODE"] = "noresult"
        res = nightly.run("acme-lead", "x", "haiku", timeout=20, entity="acme")
        self.assertFalse(res["ok"])
        self.assertIn("auth failed", res["result"])
        self.assertEqual(live_file(res["run_id"])["state"], "failed")
        self.assertEqual(transcript(res["run_id"])[-1]["t"], "result")

    def test_timeout_kills_and_fails(self):
        os.environ["FAKE_MODE"] = "slow"
        t0 = time.time()
        res = nightly.run("acme-lead", "x", "haiku", timeout=2, entity="acme")
        self.assertLess(time.time() - t0, 15)
        self.assertEqual((res["ok"], res["result"]), (False, "timeout after 2s"))
        f = live_file(res["run_id"])
        self.assertEqual(f["state"], "failed")


class OptionalIntegrationTests(unittest.TestCase):
    def test_org_defaults_to_the_parent_of_bin(self):
        import subprocess
        out = subprocess.run([sys.executable, "-c", "import live; print(live.ORG)"], capture_output=True, text=True,
                             cwd=str(pathlib.Path(__file__).resolve().parent),
                             env={k: v for k, v in os.environ.items() if k != "PORTFOLIO_ROOT"}).stdout.strip()
        self.assertEqual(out, str(pathlib.Path(__file__).resolve().parent.parent))

    def test_sales_learning_is_skipped_without_a_sales_folder(self):
        self.assertFalse((ROOT / "sales").exists())
        self.assertEqual(nightly.sales_learning(), "skipped")

    def test_sales_learning_runs_when_present(self):
        (ROOT / "sales").mkdir(exist_ok=True)
        (ROOT / "logs").mkdir(exist_ok=True)
        (ROOT / "sales" / "sales_learn.py").write_text("print('learned')\n")
        try:
            self.assertEqual(nightly.sales_learning(), "ok")
        finally:
            (ROOT / "sales" / "sales_learn.py").unlink()
            (ROOT / "sales").rmdir()

    def test_prompt_without_tracker_projects(self):
        p = nightly.prompt_for({"name": "Acme", "path": "companies/acme"})
        self.assertNotIn("tracker", p)
        self.assertIn(f"{nightly.ORG}/companies/acme/status.json", p)
        self.assertIn("ids: acme, acme-web", nightly.prompt_for({"name": "Acme", "path": "x", "tracker_projects": ["acme", "acme-web"]}))

    def test_policy_blocks_sending_and_merging(self):
        cmd = nightly.claude_cmd("acme-lead", "x", "sonnet", 5)
        denied = cmd[cmd.index("--disallowedTools") + 1:]
        for t in ("mcp__claude_ai_Gmail__send_message", "Bash(gh pr merge*)", "Bash(git push --force*)", "Bash(vercel --prod*)"):
            self.assertIn(t, denied)

    def test_check_with_no_entities_says_so(self):
        (ROOT / "portfolio.json").write_text(json.dumps({"entities": []}))
        self.assertEqual(nightly.main(["--check"]), 1)

    def test_finds_claude_somewhere(self):
        self.assertTrue(nightly.find_claude().endswith("claude"))


class SessionHookTests(unittest.TestCase):
    def setUp(self):
        fresh()
        (ROOT / "portfolio.json").write_text(json.dumps({
            "entities": [{"id": "acme", "name": "Acme", "path": "companies/acme", "lead": "acme-lead"}],
            "chief_of_staff": {"lead": "chief-of-staff"}, "managers": ["sales-manager"]}))
        self.projects = ROOT / "claude-projects"
        (self.projects / "-p").mkdir(parents=True, exist_ok=True)
        session_hook.CLAUDE_PROJECTS = self.projects
        self.tpath = self.projects / "-p" / "abc.jsonl"
        self.tpath.write_text("")

    def hook(self, event, **kw):
        return session_hook.handle({"agent_type": "acme-lead", "session_id": "ABC-123", "hook_event_name": event,
                                    "transcript_path": str(self.tpath), **kw}, env={})

    def test_skips_agents_outside_the_org(self):
        self.assertIsNone(session_hook.handle({"agent_type": "general-purpose", "session_id": "x",
                                               "hook_event_name": "SessionStart"}, env={}))
        self.assertIsNone(session_hook.handle({"session_id": "x", "hook_event_name": "SessionStart"}, env={}))
        self.assertFalse(live.LIVE.exists() and any(live.LIVE.iterdir()))

    def test_lifecycle(self):
        s = self.hook("SessionStart", source="startup")
        self.assertEqual((s["run_id"], s["kind"], s["entity"], s["state"]), ("session-abc-123", "interactive", "acme", "idle"))
        s = self.hook("UserPromptSubmit", prompt="\nWhat's the pipeline look like?\nmore")
        self.assertEqual((s["state"], s["doing"]), ("running", "What's the pipeline look like?"))
        self.tpath.write_text("\n".join(json.dumps(x) for x in [
            {"type": "user", "message": {"content": "What's the pipeline look like? " + FAKE["github"]}},
            {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Read", "input": {"file_path": "/x/BRIEF.md"}}]}},
            {"type": "user", "message": {"content": [{"type": "tool_result", "content": "brief"}]}},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "Three deals open."}]}},
        ]))
        s = self.hook("Stop", last_assistant_message="Three deals open.")
        self.assertEqual((s["state"], s["last"]), ("idle", "Three deals open."))
        t = transcript("session-abc-123")
        self.assertEqual([x["t"] for x in t], ["start", "user", "tool", "text"])
        self.assertNotIn(FAKE["github"], json.dumps(t))
        s = self.hook("SessionEnd", reason="prompt_input_exit")
        self.assertEqual((s["state"], s["ok"]), ("finished", True))
        self.assertEqual(len(transcript("session-abc-123")), 4)   # re-copied, not appended twice

    def test_subagents_in_a_session(self):
        self.hook("SessionStart", source="startup")
        for tid, kind in (("tu1", "researcher"), ("tu2", "builder")):
            self.hook("PreToolUse", tool_name="Agent", tool_use_id=tid,
                      tool_input={"subagent_type": kind, "description": f"{kind} task", "prompt": "Do it"})
        self.hook("PreToolUse", tool_name="Read", tool_use_id="tu3", tool_input={})    # not a deployment
        # Subagent events carry the subagent's agent_type, not the lead's.
        session_hook.handle({"session_id": "ABC-123", "hook_event_name": "SubagentStart", "agent_id": "a2", "agent_type": "builder"}, env={})
        session_hook.handle({"session_id": "ABC-123", "hook_event_name": "SubagentStart", "agent_id": "a1", "agent_type": "researcher"}, env={})
        s = session_hook.handle({"session_id": "ABC-123", "hook_event_name": "SubagentStop", "agent_id": "a1",
                                 "agent_type": "researcher", "last_assistant_message": "Found three " + FAKE["github"]}, env={})
        team = {m["id"]: m for m in s["team"]}
        self.assertEqual(len(team), 2)
        self.assertEqual({m["batch"] for m in team.values()}, {0})          # one deployment
        self.assertEqual((team["tu1"]["agent_id"], team["tu1"]["status"]), ("a1", "completed"))
        self.assertEqual((team["tu2"]["agent_id"], team["tu2"]["status"]), ("a2", "running"))
        self.assertNotIn(FAKE["github"], team["tu1"]["summary"])
        self.assertEqual(s["step"], "Deployed 2 agents: researcher, builder")
        # Subagent events for a session nobody registered are ignored.
        self.assertIsNone(session_hook.handle({"session_id": "zzz", "hook_event_name": "SubagentStart", "agent_id": "q", "agent_type": "x"}, env={}))

    def test_session_transcript_pairs_agent_results(self):
        self.tpath.write_text("\n".join(json.dumps(x) for x in [
            {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Agent", "id": "tu9",
             "input": {"subagent_type": "qa", "description": "Check the build", "prompt": "Run tests"}}]}},
            {"type": "user", "toolUseResult": {"status": "completed", "content": [{"type": "text", "text": "All green"}], "totalDurationMs": 2000},
             "message": {"content": [{"type": "tool_result", "tool_use_id": "tu9", "content": "All green"}]}},
        ]))
        lines = session_hook.session_lines(str(self.tpath))
        self.assertEqual([x["t"] for x in lines], ["deploy", "agent_done"])
        self.assertEqual((lines[1]["summary"], lines[1]["secs"]), ("All green", 2))

    def test_reads_transcripts_only_under_claude_projects(self):
        outside = ROOT / "elsewhere.jsonl"
        outside.write_text(json.dumps({"type": "user", "message": {"content": "leak"}}))
        self.assertEqual(session_hook.session_lines(str(outside)), [])
        self.assertEqual(session_hook.session_lines(str(self.projects / "-p" / "../../elsewhere.jsonl")), [])

    def test_main_never_raises_or_prints(self):
        import io, contextlib
        buf = io.StringIO()
        old = sys.stdin
        sys.stdin = io.StringIO("not json")
        try:
            with contextlib.redirect_stdout(buf):
                self.assertEqual(session_hook.main(), 0)
        finally:
            sys.stdin = old
        self.assertEqual(buf.getvalue(), "")


if __name__ == "__main__":
    unittest.main(verbosity=1)
