#!/usr/bin/env python3
"""Talk to a lead on whichever runner the org (or that entity) uses.

    talk.py acme                 the Acme lead
    talk.py chief-of-staff       the chief of staff
    talk.py acme "what's slipping?"

Claude Code:  claude --agent <lead> --settings <reads fenced> [--add-dir <dirs>] [prompt]
Codex:        codex -C <org> -a on-request <the permission profile> -c developer_instructions=<the lead's file> [prompt]
opencode:     opencode --agent <lead> [--prompt ...], with the run's permissions inline

Like the night shift, the session starts in the org folder and reads stay inside it and the
entity's "dirs" (see runners.py).

Interactive sessions ask before anything outside the guardrails, because you are there to
answer. Only Claude Code sessions show under Working now in Pulse (through its hooks);
codex and opencode sessions don't report live, though everything they change does.
"""
import json, os, pathlib, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import runners  # noqa: E402
from live import ORG  # noqa: E402


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    who, prompt = argv[0], " ".join(argv[1:])
    reg = json.loads((ORG / "portfolio.json").read_text())
    ent = next((e for e in reg.get("entities", []) if who in (e.get("id"), e.get("lead"))), None)
    agent = ent["lead"] if ent else who
    adapter = runners.get(runners.resolve(reg, ent["id"] if ent else None))
    binary = adapter.find()
    if not binary:
        print(f"{adapter.label} is not installed. {adapter.install_hint}", file=sys.stderr)
        return 1
    adapter.ensure_agents([agent])
    dirs = runners.work_dirs(reg, ent["id"] if ent else None)
    model = adapter.model("sonnet")
    if adapter.name == "claude-code":
        settings = json.dumps({"permissions": {"blockReadsOutsideWorkingDirectories": True}})
        cmd = [binary, "--agent", agent, "--settings", settings] + (["--add-dir", *dirs[1:]] if len(dirs) > 1 else [])
        cmd += ([prompt] if prompt else [])
    elif adapter.name == "codex":
        cmd = [binary, "-C", dirs[0], "-a", "on-request", *adapter.profile(dirs),
               "-c", "developer_instructions=" + json.dumps(adapter.instructions(agent), ensure_ascii=False)]
        cmd += (["-m", model] if model else []) + ([prompt] if prompt else [])
    else:
        cmd = [binary, "--agent", agent] + (["-m", model] if model else []) + (["--prompt", prompt] if prompt else [])
        os.environ.update(adapter.env(agent, dirs))
    os.chdir(dirs[0])
    os.execv(binary, cmd)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
