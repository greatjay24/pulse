# Pulse starter kit

Everything Pulse needs behind it: an organization of AI agents that runs your businesses'
busywork overnight and brings you only the decisions. The agents run on Codex (a ChatGPT
plan), Claude Code or opencode (any provider); see "Runners" below. No data in here: you
describe your own businesses when you run setup.

```
python3 kit/setup.py                       # asks a few questions, shows the plan, then writes
python3 kit/setup.py --config my-org.json  # same, from a file (see example-config.json)
python3 kit/setup.py --dry-run             # show what it would write, write nothing
```

Setup creates `~/portfolio` (the org Pulse reads), writes the agents to `~/portfolio/agents`
and installs them where the chosen runner reads them. It never overwrites a file that exists, and it's safe to re-run: add an
entity to your config and run it again. It prints, but doesn't run, the two things that
change your Mac's behavior: the nightly schedule (`sh ~/portfolio/launchd/install.sh`) and
(Claude Code only) the hooks snippet that lets Pulse show your own chat sessions.

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
| `org/bin/runners.py` | One adapter per agent CLI (claude-code, codex, opencode): the command, the guardrails, and the translation of its events into Pulse's transcript lines. |
| `org/bin/talk.py` | Opens a lead interactively on the org's runner, fenced the same way. |
| `org/bin/fixtures/` | Recorded codex and opencode event streams the runner tests replay. |
| `org/bin/test_*.py` | Tests. `python3 ~/portfolio/bin/test_act.py` and `test_live.py`. |
| `agents/director.md` | The template for each entity's lead (`<id>-lead`). Model-neutral: frontmatter `name`, `description`, `role` (lead, chief, manager), `tier` (deep, fast); each runner translates it. |
| `agents/chief-of-staff.md` | The weekly reviewer who writes `WEEK.md`. |
| `agents/*-manager.md` | Sales, marketing, delivery, finance and admin, shared by every lead. |
| `launchd/` | Schedule templates (nightly 5:30am, Mondays 6:30am) and `install.sh`. |
| `setup.py`, `test_setup.py` | Setup, and its end-to-end test (runs in a throwaway HOME). |

## Runners

`"runner"` in portfolio.json picks the agent CLI for the whole org; an entity can override it.
Switching is that one field (or `setup.py --runner NAME`, which also installs the files).

| Runner | Runs | Instructions | Guardrails | Teams | Usage shown |
|---|---|---|---|---|---|
| `claude-code` | `claude -p --agent <lead> --output-format stream-json` | `~/.claude/agents/<lead>.md` | `--allowedTools` / `--disallowedTools` from policy.py | yes | cost |
| `codex` | `codex exec --json --sandbox workspace-write -c approval_policy="never"` | the lead's file as `developer_instructions` | sandbox (writes only under home; network on unless `"network": false`), never asks for approval, `~/.codex/rules/pulse-org.rules` forbids the never and ask-first commands | no (works solo) | tokens |
| `opencode` | `opencode run --format json --agent <lead>` | `~/.config/opencode/agents/<lead>.md` | a `permission` block per agent: bash deny-by-default with the allow list, the never and ask-first lists denied, nothing outside the run's folder | yes | cost (as opencode reports it) and tokens |

Options: `{"name": "codex", "model": "...", "plan_model": "...", "network": true, "read_also": [...], "temp": true}`;
`max_turns` applies to Claude Code only.

### Where a lead can read and write

Every run starts in the org folder. Extra folders (a business's repos) go in `"dirs"` on the
entity, or at the top of portfolio.json for every lead. Each runner fences reads to those:

| Runner | How | What it covers | What it doesn't |
|---|---|---|---|
| `codex` | an OS-level permission profile (`default_permissions`, codex 0.138+): `":root"="deny"`, the work dirs as workspace roots, `:minimal` system paths, `read_also` (default `~/.gitconfig`, `~/.config/git`, `~/.config/gh`) | every command and subprocess | network destinations (on unless `"network": false`) |
| `claude-code` | cwd = org, `--add-dir` for the dirs, `--settings` with `permissions.blockReadsOutsideWorkingDirectories`; `ls`/`cat`/`grep`... are not pre-approved, so a read outside prompts and an unattended run refuses it | Read, Grep, Glob, LSP, and the shell commands Claude Code recognizes as file reads | other programs (git, node, python scripts); Claude Code's OS sandbox would cover those but also blocks `~/.ssh` and tool credentials, so it is left off |
| `opencode` | `--dir` = org; `external_directory` deny except the dirs; bash deny-by-default with `ls`/`cat`/... allowed only on paths under the dirs (inline per run via `OPENCODE_CONFIG_CONTENT`; the agent files alone allow only the org) | read, edit, grep, glob and other file tools | the shell rules match command text, so they are best-effort; other programs aren't fenced |

Checked offline (no model called): `codex sandbox` with the generated profile allows the org and
the dirs and refuses the rest of home; `opencode debug agent --tool` with the generated
permissions does the same; `codex execpolicy check` for every forbidden command. The tests
re-run these when the CLIs are installed. Live view of your own chat sessions in Pulse uses
Claude Code's hooks; with the other runners, Pulse shows the night shift and decision runs.

## Optional extras

The scripts work with nothing but one runner and python3. These are used only if present:

- **A task tracker** (`PULSE_TRACKER_DIR`, default `~/project-tracker`, with `todos.json`
  and `add_todo.py`): approving a decision also closes its matching "Decide: ..." task.
  Without one, decisions live in `status.json` and Pulse. Leads can read it only if its folder is in the top-level
  `"dirs"` of portfolio.json.
- **Sales learning** (`~/portfolio/sales/sales_learn.py`): run before the night shift.
- **Money and inbox data** in Pulse's Money page come from the same optional tracker.
  Without it, Pulse hides those sections.
