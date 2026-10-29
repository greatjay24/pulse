#!/usr/bin/env python3
"""Run the organization's scheduled shift.

    nightly.py                 every entity with schedule "nightly" (in parallel)
    nightly.py acme globex     just these entities (any schedule)
    nightly.py --weekly        chief-of-staff weekly review
    nightly.py --check         auth/tooling smoke test, no work done

Each run is a headless lead run on the org's runner (portfolio.json "runner", per-entity
override; see runners.py): Claude Code, Codex or opencode, under the allow/deny lists in
policy.py, so a scheduled run cannot send, pay, merge, or deploy to production. Gate items reach the owner as decisions in each status.json, which
Pulse shows (and, if an optional task tracker is set up, as tracker tasks).

Optional integrations run only when present:
    <org>/sales/sales_learn.py     a read-only sales-learning pass before the directors start

PORTFOLIO_ROOT overrides the org folder (default: the folder this bin/ lives in).
"""
import contextlib, json, os, pathlib, shutil, signal, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from live import HOME, ORG, LiveRun, redact  # noqa: E402
import runners  # noqa: E402

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
    return runners.ClaudeCode().command(CLAUDE, agent, prompt, model, max_turns)


# Runner binaries by name, for tests (a fake CLI); otherwise found on the extended PATH.
BINARIES = {}


def _registry_or_empty():
    try:
        return registry()
    except (OSError, json.JSONDecodeError):
        return {}


def runner_for(entity):
    """The adapter for an entity's runner (the org's when entity is None)."""
    return runners.get(runners.resolve(_registry_or_empty(), entity))


def run(agent, prompt, model, max_turns=60, timeout=1800, kind="nightly", entity=None, doing=""):
    """Run one lead headlessly on its runner. Writes logs/live/<run_id>.json while it works and
    logs/transcripts/<run_id>.jsonl as it goes; returns the result row the logs keep.
    `model` is a tier hint ("sonnet" = the night shift, "opus" = planning) that Claude Code
    takes as is and other runners map to their configured models."""
    env = dict(os.environ)
    env["PATH"] = RUN_PATH
    t0 = time.time()
    res = {"agent": agent, "ok": False, "result": ""}
    reg = _registry_or_empty()
    adapter = runners.get(runners.resolve(reg, entity))
    dirs = runners.work_dirs(reg, entity)       # the org folder first; reads stay inside these
    claude = adapter.name == "claude-code"
    with LiveRun(kind, agent, entity=entity, doing=doing or f"{kind.title()} run", prompt=prompt) as live:
        env["PORTFOLIO_RUN_ID"] = live.run_id     # session_hook.py leaves runner sessions alone
        res["run_id"] = live.run_id
        summary = None
        try:
            binary = CLAUDE if claude else (BINARIES.get(adapter.name) or adapter.find())
            if not binary:
                raise RuntimeError(f"{adapter.label} is not installed. {adapter.install_hint}")
            if not claude:
                live.set(runner=adapter.name)
                adapter.ensure_agents([agent])
            cmd = adapter.command(binary, agent, prompt + adapter.solo_note(), adapter.model(model), max_turns, dirs)
            env.update(adapter.env(agent, dirs))
            session = adapter.session()
            code = stream(cmd, env, timeout, live, session, cwd=adapter.cwd(dirs))
            summary = session.summary(code)
            if summary is None:
                res["result"] = live.stderr_tail or "no result from claude"
            else:
                res.update(ok=summary["ok"], result=(summary["result"] or "")[-1500:], cost_usd=summary.get("cost_usd"))
                if claude:
                    res["models"] = summary.get("models", [])
                else:
                    res["runner"] = adapter.name
                    res["models"] = [m for m in [adapter.model(model)] if m]
                    if summary.get("tokens"):
                        res["tokens"] = summary["tokens"]
                    if not summary["ok"] and not summary["result"]:
                        res["result"] = live.stderr_tail or f"{adapter.label} stopped without an answer"
        except subprocess.TimeoutExpired:
            res["result"] = f"timeout after {timeout}s"
        except Exception as e:
            res["result"] = f"{type(e).__name__}: {e}"
        res["secs"] = int(time.time() - t0)
        res["result"] = redact(res["result"])
        res["agents"] = len(live.team())      # 0 = worked solo
        # Claude Code's stream already ends with its result line; other runners get one here.
        native = bool(summary and summary.get("native_result"))
        live.finish(res["ok"], res["result"], res.get("cost_usd"), res["secs"],
                    append_result=("cost_usd" not in res) if claude else not native,
                    tokens=res.get("tokens"),
                    extra=None if claude else {"models": res.get("models", []), "agents": res["agents"], "runner": adapter.name})
    return res


def stream(cmd, env, timeout, live, session=None, cwd=None):
    """Runs the runner's CLI, feeding each JSON line through `session` (its adapter's
    translator) into `live`. Returns the exit code. Kills the run and raises
    TimeoutExpired after `timeout`."""
    session = session or runners.ClaudeSession()
    with tempfile.TemporaryFile(mode="w+") as err:
        # Its own process group, so a timeout also stops what claude started (MCP servers,
        # shells) and nothing is left holding stdout open.
        p = subprocess.Popen(cmd, cwd=cwd or str(ORG), env=env, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=err, text=True, bufsize=1, start_new_session=True)
        live.set(child_pid=p.pid)
        timed_out = threading.Event()

        def kill():
            timed_out.set()
            with contextlib.suppress(OSError):
                os.killpg(p.pid, signal.SIGKILL)

        timer = threading.Timer(timeout, kill)
        timer.start()
        try:
            for line in p.stdout:
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(ev, dict):
                    continue
                try:
                    live.add(session.feed(ev))
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
        return p.returncode


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
