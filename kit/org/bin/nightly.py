#!/usr/bin/env python3
"""Run the organization's scheduled shift.

    nightly.py                 every entity with schedule "nightly" (in parallel)
    nightly.py acme globex     just these entities (any schedule)
    nightly.py --weekly        chief-of-staff weekly review
    nightly.py --check         auth/tooling smoke test, no work done

Each run is a headless `claude -p --agent <lead>` under the allow/deny lists in
policy.py, so a scheduled run physically cannot send, pay, merge, or deploy to
production. Gate items reach the owner as decisions in each status.json, which
Pulse shows (and, if an optional task tracker is set up, as tracker tasks).

Optional integrations run only when present:
    <org>/sales/sales_learn.py     a read-only sales-learning pass before the directors start

PORTFOLIO_ROOT overrides the org folder (default: the folder this bin/ lives in).
"""
import contextlib, json, os, pathlib, shutil, signal, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from live import HOME, ORG, LiveRun, redact  # noqa: E402
from policy import ALLOWED, NEVER, NEEDS_YES  # noqa: E402

LOGS = ORG / "logs"
EXTRA_PATH = [str(HOME / ".local" / "bin"), "/opt/homebrew/bin", "/usr/local/bin"]
RUN_PATH = ":".join(EXTRA_PATH + ["/usr/bin", "/bin"])


def find_claude():
    """The Claude Code CLI. launchd starts jobs with a bare PATH, so look where installers put it."""
    path = ":".join(EXTRA_PATH + [os.environ.get("PATH", "")])
    return shutil.which("claude", path=path) or str(HOME / ".local" / "bin" / "claude")


CLAUDE = find_claude()

SWEEP_MODEL = "sonnet"     # nightly sweeps are cheap; weekly planning gets opus
PLAN_MODEL = "opus"


def registry():
    return json.loads((ORG / "portfolio.json").read_text())


def prompt_for(e):
    projects = e.get("tracker_projects") or []
    tracker = f" Your tracker project ids: {', '.join(projects)}." if projects else ""
    return (f"NIGHTLY run for {e['name']} ({e['path']}). It is "
            f"{time.strftime('%A %Y-%m-%d %H:%M')}. Follow the 'Nightly run' section of "
            f"{ORG}/OPERATING.md: sweep, act within the gates, rewrite "
            f"{ORG}/{e['path']}/status.json per STATUS_SCHEMA.md (gate items go in `decisions` "
            f"and `owner_actions`), refresh BRIEF.md. Do NOT git-commit {ORG} (the runner commits "
            f"once for everyone).{tracker} End with a 3-line summary.")


def claude_cmd(agent, prompt, model, max_turns):
    # stream-json (needs --verbose under -p) emits each message as it happens; the last
    # event is the same `result` object --output-format json used to print.
    return [CLAUDE, "-p", prompt, "--agent", agent, "--model", model,
            "--output-format", "stream-json", "--verbose", "--max-turns", str(max_turns),
            "--permission-mode", "acceptEdits",
            "--allowedTools", *ALLOWED, "--disallowedTools", *(NEVER + NEEDS_YES)]


def run(agent, prompt, model, max_turns=60, timeout=1800, kind="nightly", entity=None, doing=""):
    """Run one lead headlessly. Writes logs/live/<run_id>.json while it works and
    logs/transcripts/<run_id>.jsonl as it goes; returns the result row the logs keep."""
    env = dict(os.environ)
    env["PATH"] = RUN_PATH
    t0 = time.time()
    res = {"agent": agent, "ok": False, "result": ""}
    with LiveRun(kind, agent, entity=entity, doing=doing or f"{kind.title()} run", prompt=prompt) as live:
        env["PORTFOLIO_RUN_ID"] = live.run_id     # session_hook.py leaves runner sessions alone
        res["run_id"] = live.run_id
        try:
            final = stream(claude_cmd(agent, prompt, model, max_turns), env, timeout, live)
            if final is None:
                res["result"] = live.stderr_tail or "no result from claude"
            else:
                res.update(ok=not final.get("is_error"), result=(final.get("result") or "")[-1500:],
                           cost_usd=final.get("total_cost_usd"), models=list((final.get("modelUsage") or {}).keys()))
        except subprocess.TimeoutExpired:
            res["result"] = f"timeout after {timeout}s"
        except Exception as e:
            res["result"] = f"{type(e).__name__}: {e}"
        res["secs"] = int(time.time() - t0)
        res["result"] = redact(res["result"])
        res["agents"] = len(live.team())      # 0 = worked solo
        live.finish(res["ok"], res["result"], res.get("cost_usd"), res["secs"],
                    append_result="cost_usd" not in res)
    return res


def stream(cmd, env, timeout, live):
    """Runs claude, feeding each stream-json line to `live`. Returns the final `result`
    event (None if there was none). Kills the run and raises TimeoutExpired after `timeout`."""
    with tempfile.TemporaryFile(mode="w+") as err:
        # Its own process group, so a timeout also stops what claude started (MCP servers,
        # shells) and nothing is left holding stdout open.
        p = subprocess.Popen(cmd, cwd=str(HOME), env=env, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=err, text=True, bufsize=1, start_new_session=True)
        live.set(child_pid=p.pid)
        timed_out = threading.Event()

        def kill():
            timed_out.set()
            with contextlib.suppress(OSError):
                os.killpg(p.pid, signal.SIGKILL)

        timer = threading.Timer(timeout, kill)
        timer.start()
        final = None
        try:
            for line in p.stdout:
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(ev, dict):
                    continue
                if ev.get("type") == "result":
                    final = ev
                try:
                    live.event(ev)
                except OSError:
                    pass    # a transcript that can't be written never stops the run
            p.wait()
        finally:
            timer.cancel()
            if p.poll() is None:
                kill()
                p.wait()
            p.stdout.close()
        if timed_out.is_set():
            raise subprocess.TimeoutExpired(cmd, timeout)
        err.seek(0)
        live.stderr_tail = redact(err.read()[-800:])
        return final


def sales_learning():
    """Optional pre-step: if the org has sales/sales_learn.py, run it (read-only) so the
    directors see fresh reply data. Skipped when absent. Never raises: a learning error
    must not stop the night shift. Returns "skipped" | "ok" | "warn"."""
    script = ORG / "sales" / "sales_learn.py"
    if not script.is_file():
        return "skipped"
    try:
        p = subprocess.run([sys.executable, str(script), "--all"],
                           cwd=str(ORG / "sales"), capture_output=True, text=True, timeout=600)
        out = (p.stdout + p.stderr).strip()
        (LOGS / f"{time.strftime('%Y-%m-%d_%H%M')}_sales_learn.log").write_text(out + "\n")
        print(f"[{'ok' if p.returncode == 0 else 'WARN'}] sales_learn\n{out[-600:]}\n")
        return "ok" if p.returncode == 0 else "warn"
    except Exception as e:
        print(f"[WARN] sales_learn skipped: {type(e).__name__}: {e}\n")
        return "warn"


def main(argv):
    LOGS.mkdir(exist_ok=True)
    reg = registry()
    # (agent, prompt, model, {kind, entity, doing} for the live file)
    if "--check" in argv:
        first = next((e for e in reg["entities"] if e.get("schedule") == "nightly"), None) or \
            (reg["entities"][0] if reg.get("entities") else None)
        if not first:
            print("No entities in portfolio.json; run setup.py first.")
            return 1
        jobs = [(first["lead"], "Reply with exactly: ok", SWEEP_MODEL,
                 {"kind": "check", "entity": first["id"], "doing": "Smoke test"})]
    elif "--weekly" in argv:
        jobs = [(reg["chief_of_staff"]["lead"], "Weekly review. Follow your instructions.", PLAN_MODEL,
                 {"kind": "weekly", "entity": None, "doing": "Weekly review"})]
    else:
        want = [a for a in argv if not a.startswith("-")]
        ents = [e for e in reg["entities"] if (e["id"] in want if want else e.get("schedule") == "nightly")]
        jobs = [(e["lead"], prompt_for(e), SWEEP_MODEL,
                 {"kind": "nightly", "entity": e["id"], "doing": f"Night shift for {e['name']}"}) for e in ents]
        sales_learning()
    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(lambda j: run(j[0], j[1], j[2], **j[3]), jobs))
    if "--check" not in argv:
        subprocess.run(["git", "-C", str(ORG), "add", "-A"], capture_output=True)
        subprocess.run(["git", "-C", str(ORG), "commit", "-q", "-m",
                        f"{'weekly' if '--weekly' in argv else 'nightly'}: {', '.join(j[0] for j in jobs)}"],
                       capture_output=True)
    stamp = time.strftime("%Y-%m-%d_%H%M")
    (LOGS / f"{stamp}.json").write_text(json.dumps(results, indent=2))
    for r in results:
        print(f"[{'ok' if r['ok'] else 'FAIL'}] {r['agent']} {r['secs']}s ${r.get('cost_usd')} {r.get('models')}\n{r['result']}\n")
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
