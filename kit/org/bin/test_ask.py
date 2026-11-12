#!/usr/bin/env python3
"""Unit checks for ask.py against a throwaway portfolio and a fake claude. Run: python3 bin/test_ask.py"""
import contextlib, fcntl, json, os, pathlib, stat, subprocess, sys, tempfile, threading, time, unittest

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="ask-test-"))
os.environ["PORTFOLIO_ROOT"] = str(ROOT)
os.environ.pop("PORTFOLIO_RUN_ID", None)
FAKE_BIN = ROOT / "fake-claude"
os.environ["PULSE_CLAUDE"] = str(FAKE_BIN)
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ask  # noqa: E402
import live  # noqa: E402

# Emits a stream like claude -p: init (with a session id), the env it saw, a result.
# FAKE_MODE=nosession fails a --resume the way claude does; FAKE_MODE=slow waits to be stopped.
FAKE_CLAUDE = r'''#!/usr/bin/env python3
import contextlib, fcntl, json, os, sys, time
args = sys.argv[1:]
resume = args[args.index("--resume") + 1] if "--resume" in args else None
mode = os.environ.get("FAKE_MODE", "ok")
if resume and mode == "nosession":
    print("No conversation found with session ID: " + resume, file=sys.stderr)
    sys.exit(1)
message = sys.stdin.read()
sid = resume or "11111111-2222-3333-4444-555555555555"
def emit(e):
    print(json.dumps(e), flush=True)
emit({"type": "system", "subtype": "init", "session_id": sid})
keys = sorted(k for k in os.environ if k.startswith("ANTHROPIC_") or k.startswith("CLAUDE_CODE_USE"))
emit({"type": "assistant", "session_id": sid, "message": {"content": [{"type": "text",
      "text": "env=" + ",".join(keys) + " resume=" + str(resume) + " agent=" + args[args.index("--agent") + 1] + " msg=" + message}]}})
if mode == "slow":
    time.sleep(30)
emit({"type": "result", "session_id": sid, "is_error": False, "result": "ok", "total_cost_usd": 0.001, "duration_ms": 10})
'''


def setup():
    for d in ["companies/acme", "logs/live", "logs/transcripts"]:
        (ROOT / d).mkdir(parents=True, exist_ok=True)
    (ROOT / "portfolio.json").write_text(json.dumps({
        "chief_of_staff": {"lead": "chief-of-staff"},
        "entities": [
            {"id": "acme", "name": "Acme", "path": "companies/acme", "lead": "acme-lead", "model": "haiku"},
            {"id": "globex", "name": "Globex", "path": "companies/globex", "lead": "globex-lead"},
            {"id": "nolead", "name": "No lead", "path": "companies/x"},
        ]}))
    FAKE_BIN.write_text(FAKE_CLAUDE)
    FAKE_BIN.chmod(FAKE_BIN.stat().st_mode | stat.S_IEXEC)
    for f in ask.SESSIONS, *(ROOT / "logs/live").glob("*"), *(ROOT / "logs/transcripts").glob("*"):
        if f.exists():
            f.unlink()


SPECS = []
REAL_LAUNCH = ask.launch_worker
ask.launch_worker = lambda spec: SPECS.append(spec)


def run_job(spec):
    """Runs the worker in this process, as launch_worker's child would."""
    path = ROOT / f"job-{spec['run_id']}.json"
    path.write_text(json.dumps(spec))
    ask.worker(str(path))
    return json.loads((ROOT / "logs/live" / f"{spec['run_id']}.json").read_text())


def transcript(run_id):
    return [json.loads(l) for l in (ROOT / "logs/transcripts" / f"{run_id}.jsonl").read_text().splitlines()]


class AskTests(unittest.TestCase):
    def setUp(self):
        setup()
        SPECS.clear()
        os.environ.pop("FAKE_MODE", None)

    # ---- argument validation

    def test_rejects_bad_inputs(self):
        bad = [
            ("nope", "hi", {}), ("../acme", "hi", {}), ("--worker", "hi", {}), ("Acme", "hi", {}),
            ("nolead", "hi", {}), ("acme", "", {}), ("acme", "   \n", {}), ("acme", "x" * 8001, {}),
            ("acme", "hi", {"session": "../../etc"}), ("acme", "hi", {"session": "not-a-uuid"}),
            ("acme", "hi", {"model": "--dangerously"}), ("acme", "hi", {"model": "a b"}),
            ("acme", "hi", {"session": "11111111-2222-3333-4444-555555555555", "new": True}),
        ]
        for target, msg, kw in bad:
            with self.assertRaises(ask.Invalid, msg=(target, kw)):
                ask.ask(target, msg, **kw)
        self.assertEqual(SPECS, [])

    def test_targets_resolve_to_leads(self):
        self.assertEqual(ask.target_for("acme"), ("acme-lead", "acme", "haiku"))
        self.assertEqual(ask.target_for("acme-lead"), ("acme-lead", "acme", "haiku"))
        for alias in ("org", "chief-of-staff", "cos"):
            self.assertEqual(ask.target_for(alias)[:2], ("chief-of-staff", None))
        with self.assertRaises(ask.Invalid):
            ask.target_for("pulse")                     # no front door in this registry

    def test_front_door_takes_pulse_and_org(self):
        reg = json.loads((ROOT / "portfolio.json").read_text())
        reg["front_door"] = {"lead": "pulse", "model": "sonnet"}
        (ROOT / "portfolio.json").write_text(json.dumps(reg))
        for alias in ("pulse", "org", "front-door"):
            self.assertEqual(ask.target_for(alias), ("pulse", None, "sonnet"))
        for alias in ("chief-of-staff", "cos"):
            self.assertEqual(ask.target_for(alias)[:2], ("chief-of-staff", None))
        self.assertEqual(ask.front_door(), "pulse")

    def test_extra_fields_are_checked_and_recorded(self):
        for bad in ({"parent_run": "../x"}, {"group": "A B"}, {"trigger": "--x"}, {"nope": "x"}):
            with self.assertRaises(ask.Invalid, msg=bad):
                ask.ask("acme", "hi", extra=bad)
        ask.ask("acme", "Long brief for the lead", extra={"parent_run": "20261029-000000-pulse-abcd", "source": "pulse",
                                                          "display": "Short ask"})
        state = run_job(SPECS[0])
        self.assertEqual((state["parent_run"], state["source"], state["doing"]), ("20261029-000000-pulse-abcd", "pulse", "Short ask"))
        lines = transcript(state["run_id"])
        self.assertEqual(lines[0]["parent_run"], "20261029-000000-pulse-abcd")
        self.assertEqual(lines[0]["prompt"], "Long brief for the lead")
        self.assertEqual(next(l for l in lines if l["t"] == "user")["text"], "Short ask")

    def test_report_runs_show_one_folded_line(self):
        ask.ask("acme", "[Report-back] long results", extra={"trigger": "report", "display": "Report back from x"})
        lines = transcript(run_job(SPECS[0])["run_id"])
        self.assertFalse(any(l["t"] == "user" for l in lines))
        rep = next(l for l in lines if l["t"] == "report")
        self.assertEqual((rep["text"], rep["detail"]), ("Report back from x", "[Report-back] long results"))

    def test_ask_launches_and_answers_at_once(self):
        r = ask.ask("acme", "  Build the pricing page\r\nlike the other one \x07")
        self.assertTrue(r["ok"])
        self.assertEqual((r["agent"], r["entity"], r["queued"]), ("acme-lead", "acme", False))
        self.assertTrue(live.RUN_ID.match(r["run_id"]))
        self.assertEqual(SPECS[0]["message"], "Build the pricing page\nlike the other one")
        self.assertEqual(SPECS[0]["model"], "haiku")            # from portfolio.json
        self.assertEqual(ask.ask("globex", "hi", model="sonnet")["agent"], "globex-lead")
        self.assertEqual(SPECS[1]["model"], "sonnet")

    def test_message_that_looks_like_a_flag_stays_data(self):
        r = ask.ask("acme", "--dangerously-skip-permissions", dry_run=True)
        self.assertNotIn("--dangerously-skip-permissions", r["command"])
        self.assertNotIn("-p", r["command"][r["command"].index("--agent"):])   # prompt goes on stdin

    def test_cli_prints_one_json_line(self):
        p = subprocess.run([sys.executable, str(pathlib.Path(ask.__file__)), "acme", "--message=-x", "--dry-run"],
                           capture_output=True, text=True, env={**os.environ})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(json.loads(p.stdout)["dry_run"])
        p = subprocess.run([sys.executable, str(pathlib.Path(ask.__file__)), "nope", "--message", "x"],
                           capture_output=True, text=True, env={**os.environ})
        self.assertEqual(p.returncode, 2)
        self.assertEqual(json.loads(p.stdout), {"ok": False, "error": "unknown entity or lead: nope"})

    # ---- env stripping

    def test_child_env_drops_billing_vars(self):
        env = ask.child_env({"ANTHROPIC_API_KEY": "k", "ANTHROPIC_AUTH_TOKEN": "t", "CLAUDE_CODE_USE_BEDROCK": "1",
                             "ANTHROPIC_BASE_URL": "http://x", "HOME": "/h", "LANG": "en"})
        self.assertEqual({k for k in env if k.startswith(("ANTHROPIC_", "CLAUDE_CODE_USE"))}, set())
        self.assertEqual((env["HOME"], env["LANG"]), ("/h", "en"))

    def test_worker_child_never_sees_an_api_key(self):
        os.environ["ANTHROPIC_API_KEY"] = "sk-" + "ant-" + "x" * 30
        os.environ["ANTHROPIC_AUTH_TOKEN"] = "tok"
        try:
            ask.ask("acme", "hello")
            state = run_job(SPECS[0])
        finally:
            os.environ.pop("ANTHROPIC_API_KEY")
            os.environ.pop("ANTHROPIC_AUTH_TOKEN")
        said = [l["text"] for l in transcript(state["run_id"]) if l["t"] == "text"][0]
        self.assertIn("env= ", said)       # no ANTHROPIC_* / CLAUDE_CODE_USE_* at all
        self.assertIn("msg=hello", said)

    # ---- runs, transcripts and session resume

    def test_run_writes_live_and_transcript(self):
        r = ask.ask("acme", "what's open?")
        state = run_job(SPECS[0])
        self.assertEqual((state["kind"], state["state"], state["ok"]), ("chat", "finished", True))
        self.assertEqual(state["session_id"], "11111111-2222-3333-4444-555555555555")
        self.assertEqual(state["doing"], "what's open?")
        lines = transcript(r["run_id"])
        self.assertEqual([l["t"] for l in lines][:2], ["start", "user"])
        self.assertEqual(lines[1]["text"], "what's open?")
        self.assertEqual(lines[-1]["t"], "result")
        self.assertIn("agent=acme-lead", [l for l in lines if l["t"] == "text"][0]["text"])

    def test_second_message_resumes_the_latest_session(self):
        ask.ask("acme", "first")
        first = run_job(SPECS[0])
        self.assertIsNone(first.get("resumed"))
        self.assertEqual(json.loads(ask.SESSIONS.read_text())["acme-lead"]["session_id"], first["session_id"])
        ask.ask("acme", "second")
        second = run_job(SPECS[1])
        self.assertEqual(second["resumed"], first["session_id"])
        said = [l["text"] for l in transcript(second["run_id"]) if l["t"] == "text"][0]
        self.assertIn(f"resume={first['session_id']}", said)
        # --new starts fresh even with a session on file; another lead has its own.
        ask.ask("acme", "third", new=True)
        self.assertIn("resume=None", [l["text"] for l in transcript(run_job(SPECS[2])["run_id"]) if l["t"] == "text"][0])
        ask.ask("globex", "hi")
        self.assertIn("resume=None", [l["text"] for l in transcript(run_job(SPECS[3])["run_id"]) if l["t"] == "text"][0])

    def test_explicit_session_is_used(self):
        sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        ask.ask("acme", "go on", session=sid)
        self.assertEqual(run_job(SPECS[0])["resumed"], sid)

    def test_unresumable_session_starts_fresh(self):
        ask.SESSIONS.parent.mkdir(parents=True, exist_ok=True)
        ask.SESSIONS.write_text(json.dumps({"acme-lead": {"session_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}}))
        os.environ["FAKE_MODE"] = "nosession"
        ask.ask("acme", "hello again")
        state = run_job(SPECS[0])
        self.assertEqual((state["state"], state["session_id"]), ("finished", "11111111-2222-3333-4444-555555555555"))
        self.assertIn("started a new one", " ".join(l.get("text", "") for l in transcript(state["run_id"]) if l["t"] == "error"))

    def test_bad_sessions_file_is_ignored(self):
        ask.SESSIONS.parent.mkdir(parents=True, exist_ok=True)
        ask.SESSIONS.write_text(json.dumps({"acme-lead": {"session_id": "--evil"}}))
        self.assertIsNone(ask.latest_session("acme-lead"))

    # ---- stop

    def test_stop_validates(self):
        for bad in ["", "../x", "X", "--worker"]:
            with self.assertRaises(ask.Invalid):
                ask.stop(bad)
        with self.assertRaises(ask.Invalid):
            ask.stop("20260101-000000-none-0000")
        live.write_json_atomic(ROOT / "logs/live/20260101-000000-me-0000.json", {"kind": "interactive", "state": "running"})
        with self.assertRaises(ask.Invalid):
            ask.stop("20260101-000000-me-0000")

    def test_stop_kills_a_running_reply(self):
        os.environ["FAKE_MODE"] = "slow"
        r = ask.ask("acme", "take your time")
        t = threading.Thread(target=run_job, args=(SPECS[0],))
        t.start()
        path = ROOT / "logs/live" / f"{r['run_id']}.json"
        deadline = time.time() + 10
        while time.time() < deadline:
            st = json.loads(path.read_text()) if path.exists() else {}
            if st.get("child_pid") and st.get("session_id"):
                break
            time.sleep(0.05)
        self.assertTrue(ask.stop(r["run_id"])["stopped"])
        t.join(10)
        self.assertFalse(t.is_alive())
        state = json.loads(path.read_text())
        self.assertEqual((state["state"], state["result"]), ("failed", "Stopped by you"))
        self.assertFalse(live.pid_alive(state["child_pid"]))
        # A stopped reply still leaves its session to continue.
        self.assertEqual(ask.latest_session("acme-lead"), "11111111-2222-3333-4444-555555555555")
        self.assertFalse(ask.stop(r["run_id"])["stopped"])      # already over


    # ---- queue: one reply per lead at a time

    def wait_state(self, run_id, want, secs=15):
        path = ROOT / "logs/live" / f"{run_id}.json"
        deadline = time.time() + secs
        while time.time() < deadline:
            with contextlib.suppress(OSError, json.JSONDecodeError):
                st = json.loads(path.read_text())
                if st.get("state") in want:
                    return st
            time.sleep(0.05)
        self.fail(f"{run_id} never reached {want}")

    def test_message_while_busy_is_queued_then_continues(self):
        ask.SESSIONS.parent.mkdir(parents=True, exist_ok=True)
        sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        ask.SESSIONS.write_text(json.dumps({"acme-lead": {"session_id": sid}}))
        with open(ask.run_lock("acme-lead"), "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)              # a reply in progress
            r = ask.ask("acme", "and one more thing")
            self.assertTrue(r["queued"])
            REAL_LAUNCH(SPECS[0])
            self.assertEqual(self.wait_state(r["run_id"], {"queued"})["step"], "Queued: waiting for the current reply")
        st = self.wait_state(r["run_id"], {"finished", "failed"})
        self.assertEqual((st["state"], st["resumed"]), ("finished", sid))

    def test_stop_cancels_a_queued_message(self):
        with open(ask.run_lock("acme-lead"), "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            r = ask.ask("acme", "never mind")
            REAL_LAUNCH(SPECS[0])
            self.wait_state(r["run_id"], {"queued"})
            self.assertTrue(ask.stop(r["run_id"])["stopped"])
            st = self.wait_state(r["run_id"], {"failed"})
        self.assertEqual(st["result"], "Stopped by you")
        self.assertFalse(any(l["t"] == "text" for l in transcript(r["run_id"])))   # claude never ran

    # ---- runners: the org's guardrails on every runner

    def set_runner(self, runner):
        reg = json.loads((ROOT / "portfolio.json").read_text())
        reg["runner"] = runner
        (ROOT / "portfolio.json").write_text(json.dumps(reg))

    def test_claude_chat_keeps_the_policy(self):
        cmd = ask.ask("acme", "hi", dry_run=True)["command"]
        self.assertEqual(cmd[cmd.index("--permission-mode") + 1], "acceptEdits")
        self.assertNotIn("bypassPermissions", cmd)
        self.assertIn("--append-system-prompt", cmd)
        # The chat's own options come before --allowedTools, which takes every argument after it.
        self.assertLess(cmd.index("--append-system-prompt"), cmd.index("--allowedTools"))
        denied = cmd[cmd.index("--disallowedTools") + 1:]
        self.assertIn("Bash(gh pr merge*)", denied)
        self.assertIn("mcp__claude_ai_Gmail__send_message", denied)
        sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        cmd = ask.ask("acme", "hi", session=sid, dry_run=True)["command"]
        self.assertEqual(cmd[cmd.index("--resume") + 1], sid)
        self.assertLess(cmd.index("--resume"), cmd.index("--allowedTools"))

    def test_other_runners_get_the_message_as_a_guarded_prompt(self):
        for runner in ("codex", "opencode"):
            self.set_runner(runner)
            r = ask.ask("acme", "--rm everything", session="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", dry_run=True)
            self.assertEqual(r["runner"], runner)
            self.assertIsNone(r["resume"])                      # only Claude Code resumes
            prompt = r["command"][-1]
            self.assertFalse(prompt.startswith("-"), runner)
            self.assertIn("never send email", prompt)
            self.assertTrue(prompt.endswith("--rm everything") or "--rm everything" in prompt)
            self.assertNotIn("--rm everything", r["command"][:-1])
            self.assertNotEqual(r["command"][r["command"].index("-m") + 1] if "-m" in r["command"] else None, "haiku")
        self.set_runner("claude-code")

    def test_opencode_chat_runs_and_keeps_provider_keys(self):
        fake = ROOT / "fake-opencode"
        fake.write_text(r'''#!/usr/bin/env python3
import json, os, sys
print(json.dumps({"type": "text", "sessionID": "ses_1", "part": {"type": "text", "text": "key=" + str(bool(os.environ.get("ANTHROPIC_API_KEY")))}}), flush=True)
''')
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        self.set_runner("opencode")
        ask.BINARIES["opencode"] = str(fake)
        os.environ["ANTHROPIC_API_KEY"] = "provider-key"
        try:
            ask.ask("acme", "hello")
            state = run_job(SPECS[0])
        finally:
            os.environ.pop("ANTHROPIC_API_KEY")
            ask.BINARIES.pop("opencode")
            self.set_runner("claude-code")
        self.assertEqual(state.get("runner"), "opencode")
        self.assertIsNone(state.get("session_id"))
        lines = transcript(state["run_id"])
        self.assertEqual(lines[-1]["t"], "result")


if __name__ == "__main__":
    unittest.main(verbosity=2)
