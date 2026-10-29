# Pulse starter kit

Everything Pulse needs behind it: an organization of Claude Code agents that runs your
businesses' busywork overnight and brings you only the decisions. No data in here: you
describe your own businesses when you run setup.

```
python3 kit/setup.py                       # asks a few questions, shows the plan, then writes
python3 kit/setup.py --config my-org.json  # same, from a file (see example-config.json)
python3 kit/setup.py --dry-run             # show what it would write, write nothing
```

Setup creates `~/portfolio` (the org Pulse reads) and installs the agents into
`~/.claude/agents`. It never overwrites a file that exists, and it's safe to re-run: add an
entity to your config and run it again. It prints, but doesn't run, the two things that
change your Mac's behavior: the nightly schedule (`sh ~/portfolio/launchd/install.sh`) and
the Claude Code hooks snippet that lets Pulse show your own sessions.

## What's in it

| Path | What it is |
|---|---|
| `org/OPERATING.md` | The rules every agent follows: the four gates, the guardrails (draft, never send; ask first for production, money, DNS, deletes), nightly runs, teams. |
| `org/STATUS_SCHEMA.md` | The `status.json` each lead writes and Pulse reads, and how health colors are earned. |
| `org/README.md` | The org at a glance, with the commands. |
| `org/bin/nightly.py` | Runs the leads headlessly: nightly, `--weekly` (chief of staff), `--check` (smoke test). |
| `org/bin/act.py` | What Pulse calls when you Approve, Reject or Discuss a decision. Appends to `decisions.jsonl` and runs the lead. |
| `org/bin/live.py` | Live state and redacted transcripts for every run (Pulse's Working now and Conversations). |
| `org/bin/session_hook.py` | Claude Code hook: shows your own `claude --agent <lead>` sessions in Pulse. |
| `org/bin/policy.py` | The allow and deny lists for headless runs. No sending, no force-push, no merges, no production deploys. |
| `org/bin/test_*.py` | Tests. `python3 ~/portfolio/bin/test_act.py` and `test_live.py`. |
| `agents/director.md` | The template for each entity's lead (`<id>-lead`). |
| `agents/chief-of-staff.md` | The weekly reviewer who writes `WEEK.md`. |
| `agents/*-manager.md` | Sales, marketing, delivery, finance and admin, shared by every lead. |
| `launchd/` | Schedule templates (nightly 5:30am, Mondays 6:30am) and `install.sh`. |
| `setup.py`, `test_setup.py` | Setup, and its end-to-end test (runs in a throwaway HOME). |

## Optional extras

The scripts work with nothing but Claude Code and python3. These are used only if present:

- **A task tracker** (`PULSE_TRACKER_DIR`, default `~/project-tracker`, with `todos.json`
  and `add_todo.py`): approving a decision also closes its matching "Decide: ..." task.
  Without one, decisions live in `status.json` and Pulse.
- **Sales learning** (`~/portfolio/sales/sales_learn.py`): run before the night shift.
- **Money and inbox data** in Pulse's Money page come from the same optional tracker.
  Without it, Pulse hides those sections.
