#!/usr/bin/env python3
"""Set up an agent-run organization for Pulse.

    python3 kit/setup.py                         ask questions, show the plan, then write
    python3 kit/setup.py --config org.json       no questions (see example-config.json)
    python3 kit/setup.py --dry-run               show what would be written, write nothing

Flags:
    --org-dir DIR      where the org lives (default ~/portfolio; Pulse only reads ~/portfolio)
    --runner NAME      claude-code | codex | opencode (default: ask, offering what's installed;
                       with --config, the config's "runner" or claude-code). Re-running with a
                       different runner switches the org and installs that runner's agent files.
    --agents-dir DIR   where Claude Code agents live (default ~/.claude/agents)
    --yes              don't ask before writing
    --update-bin       replace bin/ scripts that differ from this kit (they are kit code, not your data)

Config file (JSON):
    {
      "owner": "Sam",                                  // first name
      "runner": "codex",                               // optional: claude-code (default) | codex | opencode
      "groups": ["Companies", "Family", "Personal"],   // or [{"id": "companies", "name": "Companies"}]
      "entities": [
        {"id": "acme", "name": "Acme", "group": "companies",
         "description": "One line: what it is.",
         "color": "#3B5BDB",                           // optional hex
         "logo": "~/Desktop/acme.svg",                 // optional: svg, png, jpg or webp, 1 MB max
         "schedule": "nightly",                        // nightly (default) | weekly | on-call
         "parent": null,                               // another entity's id, for a venture under it
         "stage": "active"}                            // active (default) | pending | paused | idea
      ]
    }

What it does (and never does):
- Creates the org folder: portfolio.json, OPERATING.md, STATUS_SCHEMA.md, README.md, bin/,
  launchd/, logs/, history/, assets/logos/ and one folder per entity with a starter
  BRIEF.md, a valid status.json and an empty decisions.jsonl. Then git init and a first commit.
- Writes the agents, model-neutral, to <org>/agents/: <id>-lead.md per entity,
  chief-of-staff.md and the five managers. Then installs them where the runner reads them:
  Claude Code ~/.claude/agents, opencode ~/.config/opencode/agents; Codex reads <org>/agents
  directly and gets ~/.codex/rules/pulse-org.rules (the guardrails as execpolicy rules).
- Never overwrites a file that already exists. A file that differs from what setup would
  write is reported and left alone. portfolio.json is merged: existing entities are kept,
  new ones added, nothing dropped.
- Prints, but does not run, the launchd install command and the Claude Code hooks snippet.
- Safe to re-run: a second run with the same answers changes nothing and says so.
"""
import argparse, datetime, json, os, pathlib, re, shutil, subprocess, sys

KIT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(KIT / "org" / "bin"))
import runners  # noqa: E402
HOME = pathlib.Path.home()
MANAGERS = ["sales-manager", "marketing-manager", "delivery-manager", "finance-manager", "admin-manager"]
DEFAULT_GROUPS = ["Companies", "Family", "Personal"]
PALETTE = ["#3B5BDB", "#9C36B5", "#2B8A3E", "#E8590C", "#0B7285", "#C2255C", "#5C7CFA", "#B08900"]
SCHEDULES = {"nightly", "weekly", "on-call"}
STAGES = {"active", "pending", "paused", "idea"}
LOGO_EXTS = {".svg", ".png", ".jpg", ".webp"}
LOGO_MAX = 1024 * 1024
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
LANES = ["sales", "marketing", "delivery", "finance", "admin"]
BIN_FILES = ["act.py", "live.py", "nightly.py", "session_hook.py", "policy.py", "runners.py", "talk.py",
             "test_act.py", "test_live.py", "test_runners.py"]
HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd", "PreToolUse", "SubagentStart", "SubagentStop"]


class SetupError(ValueError):
    pass


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:40].strip("-")


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


# --------------------------------------------------------------------------
# The answers: from a config file or from questions
# --------------------------------------------------------------------------

def normalize(cfg):
    """Validates a config and fills defaults. Returns {"owner", "groups", "entities"}."""
    if not isinstance(cfg, dict):
        raise SetupError("config must be a JSON object")
    owner = (cfg.get("owner") or "").strip()
    if not owner:
        raise SetupError("owner (a first name) is required")
    groups = []
    for g in cfg.get("groups") or DEFAULT_GROUPS:
        g = {"id": slugify(g), "name": g.strip()} if isinstance(g, str) else {"id": g.get("id") or slugify(g.get("name")), "name": g.get("name") or g.get("id")}
        if not SLUG.match(g["id"] or ""):
            raise SetupError(f"bad group: {g}")
        if g["id"] not in [x["id"] for x in groups]:
            groups.append(g)
    entities = []
    for i, e in enumerate(cfg.get("entities") or []):
        if not isinstance(e, dict):
            raise SetupError("each entity must be an object")
        eid = (e.get("id") or slugify(e.get("name"))).strip()
        if not SLUG.match(eid):
            raise SetupError(f"entity id {eid!r}: use lowercase letters, digits and dashes")
        if eid in [x["id"] for x in entities]:
            raise SetupError(f"entity id {eid!r} is listed twice")
        group = e.get("group") or groups[0]["id"]
        gids = {g["id"]: g["id"] for g in groups}
        gids.update({slugify(g["name"]): g["id"] for g in groups})
        if slugify(group) not in gids:
            raise SetupError(f"{eid}: group {group!r} is not one of {[g['id'] for g in groups]}")
        color = e.get("color") or PALETTE[i % len(PALETTE)]
        if not HEX.match(color):
            raise SetupError(f"{eid}: color must be a hex like #3B5BDB")
        schedule = e.get("schedule") or "nightly"
        if schedule not in SCHEDULES:
            raise SetupError(f"{eid}: schedule must be one of {sorted(SCHEDULES)}")
        stage = e.get("stage") or "active"
        if stage not in STAGES:
            raise SetupError(f"{eid}: stage must be one of {sorted(STAGES)}")
        logo = None
        if e.get("logo"):
            logo = pathlib.Path(os.path.expanduser(e["logo"]))
            if not logo.is_file():
                raise SetupError(f"{eid}: logo {logo} not found")
            if logo.suffix.lower() not in LOGO_EXTS:
                raise SetupError(f"{eid}: logo must be svg, png, jpg or webp")
            if logo.stat().st_size > LOGO_MAX:
                raise SetupError(f"{eid}: logo is over 1 MB")
        entities.append({"id": eid, "name": (e.get("name") or eid).strip(), "group": gids[slugify(group)],
                         "description": (e.get("description") or "").strip(), "color": color.upper(),
                         "logo": logo, "schedule": schedule, "parent": e.get("parent") or None, "stage": stage})
    ids = [e["id"] for e in entities]
    for e in entities:
        if e["parent"] and e["parent"] not in ids:
            raise SetupError(f"{e['id']}: parent {e['parent']!r} is not an entity here")
        if e["parent"] == e["id"]:
            raise SetupError(f"{e['id']}: an entity can't be its own parent")
    if not entities:
        raise SetupError("add at least one entity")
    runner = cfg.get("runner") or runners.DEFAULT
    name = runner.get("name") if isinstance(runner, dict) else runner
    if name not in runners.ADAPTERS:
        raise SetupError(f"runner must be one of {sorted(runners.ADAPTERS)}")
    return {"owner": owner, "groups": groups, "entities": entities, "runner": name}


def ask(prompt, default=""):
    shown = f" [{default}]" if default else ""
    try:
        answer = input(f"{prompt}{shown}: ").strip()
    except EOFError:
        answer = ""
    return answer or default


def choose_runner():
    """Which agent CLI runs the leads. Offers all three, defaulting to the first installed."""
    found = dict(runners.detect())
    print("Which AI runs your agents? (you can switch later: one field in portfolio.json)")
    names = list(runners.ADAPTERS)
    for i, n in enumerate(names, 1):
        print(f"    {i}. {runners.ADAPTERS[n].label:<26} {'installed' if n in found else 'not installed'}")
    default = next((n for n in names if n in found), runners.DEFAULT)
    pick = ask("  Runner (number or name)", str(names.index(default) + 1))
    return names[int(pick) - 1] if pick.isdigit() and 0 < int(pick) <= len(names) else pick


def interview():
    print("Pulse org setup. Press Enter to take the default in [brackets].\n")
    owner = ask("Your first name")
    groups = [g.strip() for g in ask("Groups, comma separated", ", ".join(DEFAULT_GROUPS)).split(",") if g.strip()]
    print("\nNow your businesses (and anything else you want a lead for). Leave the id blank to finish.")
    entities = []
    while True:
        n = len(entities)
        eid = slugify(ask(f"\nEntity {n + 1} id (short, like acme)"))
        if not eid:
            if entities:
                break
            print("Add at least one.")
            continue
        name = ask("  Name", eid.replace("-", " ").title())
        for i, g in enumerate(groups, 1):
            print(f"    {i}. {g}")
        pick = ask("  Group (number or name)", "1")
        group = groups[int(pick) - 1] if pick.isdigit() and 0 < int(pick) <= len(groups) else pick
        desc = ask("  One line: what it is")
        color = ask("  Color (hex)", PALETTE[n % len(PALETTE)])
        logo = ask("  Logo file (optional: svg, png, jpg, webp)")
        schedule = ask("  Runs nightly, weekly or on-call", "nightly")
        parent = slugify(ask("  Part of another entity? Its id (optional)"))
        entities.append({"id": eid, "name": name, "group": group, "description": desc, "color": color,
                         "logo": logo or None, "schedule": schedule, "parent": parent or None})
    print()
    runner = choose_runner()
    return {"owner": owner, "groups": groups, "entities": entities, "runner": runner}


def runner_check(name):
    """One line on whether the runner is installed and signed in. Never blocks setup."""
    adapter = runners.ADAPTERS[name]()
    binary = adapter.find()
    if not binary:
        return False, f"{adapter.label} is not installed. {adapter.install_hint}"
    ok, detail = adapter.signed_in(binary)
    if ok:
        return True, f"{adapter.label}: installed ({tilde(binary)}) and signed in."
    if ok is None:
        return True, f"{adapter.label}: installed ({tilde(binary)}); couldn't tell if it's signed in."
    return False, f"{adapter.label}: installed, but not signed in: {detail}."


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def render(text, values):
    for k, v in values.items():
        text = text.replace("{{" + k + "}}", v)
    return text


def entity_path(e, by_id):
    if e.get("parent"):
        return f"{entity_path(by_id[e['parent']], by_id)}/ventures/{e['id']}"
    # An entity named like its group (Personal in Personal) is the group's folder itself.
    return e["group"] if e["id"] == e["group"] else f"{e['group']}/{e['id']}"


def org_tree(owner, groups, entities):
    lines = [owner, "└── chief-of-staff       weekly: review → WEEK.md, your 3 moves"]
    shown = [g for g in groups if any(e["group"] == g["id"] for e in entities)]
    for gi, g in enumerate(shown):
        last_g = gi == len(shown) - 1
        lines.append(f"    {'└' if last_g else '├'}── {g['name'].upper()}")
        pad = "    " if last_g else "│   "
        tops = [e for e in entities if e["group"] == g["id"] and not e.get("parent")]
        for ei, e in enumerate(tops):
            last_e = ei == len(tops) - 1
            role = "director" if e["schedule"] != "on-call" else "on call"
            lines.append(f"    {pad}{'└' if last_e else '├'}── {e['lead']:<20} {role}, {e['name']:<18} {e['path']}")
            kids = [k for k in entities if k.get("parent") == e["id"]]
            for ki, k in enumerate(kids):
                lines.append(f"    {pad}{'    ' if last_e else '│   '}{'└' if ki == len(kids) - 1 else '├'}── "
                             f"{k['lead']:<16} venture, {k['name']:<19} {k['path']}")
    return "\n".join(lines)


def entity_table(org, groups, entities):
    names = {g["id"]: g["name"] for g in groups}
    rows = ["| Group | Entity | Lead | Folder |", "|---|---|---|---|"]
    for e in entities:
        group = names.get(e["group"], e["group"]) + (" › venture" if e.get("parent") else "")
        rows.append(f"| {group} | {e['name']} | {e['lead']} | {org}/{e['path']} |")
    return "\n".join(rows)


def brief(e, owner):
    return f"""# {e['name']}

{e['description'] or 'One line: what this business is.'}

Lead: `{e['lead']}` · Owner: {owner} · Folder: `{e['path']}`

## Now
Nothing yet. The lead fills this in after its first run.

## Next three moves
1. Run `python3 ~/portfolio/bin/talk.py {e['id']}` and tell it about the business: customers, offer, what's in flight.
2. List where its repos, documents and data live (below), so the nightly run can sweep them.
3. Let the first nightly run write status.json.

## Where things live
- Repos:
- Documents:
- Data (payments, bank, analytics exports):
- Task tracker (optional):

## Decided
(Answers the owner has given, so they never come back.)
"""


def starter_status(e):
    return {
        "entity": e["id"], "name": e["name"], "group": e["group"], "parent": e.get("parent"),
        "stage": e["stage"], "updated": now_iso(), "health": "yellow",
        "health_why": "No report yet: the lead hasn't run",
        "headline": e["description"] or f"{e['name']}: no report yet.",
        "metrics": [], "lanes": {k: {"status": "", "next": ""} for k in LANES},
        "decisions": [], "owner_actions": [], "waiting_on": [], "risks": [], "next": [], "done": [],
    }


# --------------------------------------------------------------------------
# The plan: every file, and whether it is new, the same, or left alone
# --------------------------------------------------------------------------

class Plan:
    def __init__(self, dry_run):
        self.dry_run = dry_run
        self.rows = []          # (status, path, note)
        self.writes = []        # (path, bytes | None for mkdir, mode)

    def dir(self, path):
        if not path.is_dir():
            self.rows.append(("create", path, ""))
            self.writes.append((path, None, None))

    def file(self, path, content, mode=None, replace=False, hint=""):
        data = content.encode() if isinstance(content, str) else content
        if not path.exists():
            self.rows.append(("create", path, ""))
            self.writes.append((path, data, mode))
        elif path.is_file() and path.read_bytes() == data:
            self.rows.append(("same", path, ""))
        elif replace:
            self.rows.append(("update", path, ""))
            self.writes.append((path, data, mode))
        else:
            self.rows.append(("left alone", path, "exists and differs from the kit" + (f"; {hint}" if hint else "")))

    def changes(self):
        return [r for r in self.rows if r[0] in ("create", "update")]

    def apply(self):
        for path, data, mode in self.writes:
            if data is None:
                path.mkdir(parents=True, exist_ok=True)
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(f".{path.name}.setup.tmp")
            tmp.write_bytes(data)
            if mode:
                tmp.chmod(mode)
            os.replace(tmp, path)


def merged_registry(path, owner, groups, entities, runner=None, switch=False):
    """The existing portfolio.json with new groups and entities added. Nothing is dropped."""
    reg = {}
    if path.exists():
        try:
            reg = json.loads(path.read_text())
        except json.JSONDecodeError:
            raise SetupError(f"{path} is not valid JSON; fix or move it, then re-run")
    reg.setdefault("_comment", "The org registry. Pulse and bin/nightly.py read this. 'schedule' = nightly | weekly | "
                   "on-call. 'logo' / 'logo_dark' are paths under assets/ (svg, png, jpg, webp; 1 MB max). "
                   "'color' (hex) tints the entity's initial when it has no logo.")
    reg.setdefault("owner", {"name": owner})
    # The runner is one field: set on the first run, changed only when asked (--runner).
    if runner and ("runner" not in reg or switch):
        current = reg.get("runner")
        if isinstance(current, dict):
            if current.get("name") != runner:
                reg["runner"] = {"name": runner}
        elif current != runner:
            reg["runner"] = runner
    have = {g.get("id") for g in reg.setdefault("groups", [])}
    reg["groups"].extend({"id": g["id"], "name": g["name"]} for g in groups if g["id"] not in have)
    have = {e.get("id") for e in reg.setdefault("entities", [])}
    for e in entities:
        if e["id"] in have:
            continue
        row = {"id": e["id"], "name": e["name"], "group": e["group"], "parent": e.get("parent"),
               "path": e["path"], "lead": e["lead"], "schedule": e["schedule"], "color": e["color"]}
        if e.get("logo_rel"):
            row["logo"] = row["logo_dark"] = e["logo_rel"]
        reg["entities"].append(row)
    reg.setdefault("managers", list(MANAGERS))
    reg.setdefault("chief_of_staff", {"lead": "chief-of-staff", "schedule": "weekly", "output": "WEEK.md"})
    return reg


def build(answers, org, agents_dir, plan, update_bin=False, switch_runner=False):
    owner, groups = answers["owner"], answers["groups"]
    entities = [dict(e) for e in answers["entities"]]
    by_id = {e["id"]: e for e in entities}
    for e in entities:
        e["path"] = entity_path(e, by_id)
        e["lead"] = f"{e['id']}-lead"

    # Entities already in portfolio.json keep their paths; a re-run adds, never moves.
    reg_path = org / "portfolio.json"
    registry_preview = merged_registry(reg_path, owner, groups, [])
    existing = {x["id"]: x for x in registry_preview.get("entities", [])}
    for e in entities:
        if e["id"] in existing:
            e["path"] = existing[e["id"]].get("path") or e["path"]
            e["lead"] = existing[e["id"]].get("lead") or e["lead"]

    for d in ["", "bin", "launchd", "logs", "logs/live", "logs/transcripts", "history", "assets/logos"]:
        plan.dir(org / d)

    for e in entities:
        if e["logo"]:
            rel = f"assets/logos/{e['id']}{e['logo'].suffix.lower()}"
            plan.file(org / rel, e["logo"].read_bytes())
            e["logo_rel"] = rel

    registry = merged_registry(reg_path, owner, groups, entities, answers.get("runner"), switch_runner)
    runner = runners.resolve(registry)["name"]
    all_entities = [{**x, "schedule": x.get("schedule", "nightly")} for x in registry["entities"]]
    all_groups = registry["groups"]
    owner_name = (registry.get("owner") or {}).get("name") or owner
    plan.file(reg_path, json.dumps(registry, indent=2, ensure_ascii=False) + "\n", replace=True)

    values = {"OWNER": owner_name, "ORG": str(org), "ORG_TREE": org_tree(owner_name, all_groups, all_entities)}
    for name in ["OPERATING.md", "STATUS_SCHEMA.md", "README.md"]:
        plan.file(org / name, render((KIT / "org" / name).read_text(), values),
                  hint="the org chart in it may be out of date; edit it by hand")
    plan.file(org / ".gitignore", ".cache/\nlogs/live/\nlogs/transcripts/\n__pycache__/\n*.tmp\n")

    for name in BIN_FILES:
        plan.file(org / "bin" / name, (KIT / "org" / "bin" / name).read_bytes(), mode=0o755, replace=update_bin,
                  hint="pass --update-bin to replace it")
    plan.dir(org / "bin" / "fixtures")
    for f in sorted((KIT / "org" / "bin" / "fixtures").glob("*.jsonl")):
        plan.file(org / "bin" / "fixtures" / f.name, f.read_bytes(), replace=update_bin)

    python = shutil.which("python3") or sys.executable
    for job in ["nightly", "weekly"]:
        name = f"com.pulse.org.{job}.plist"
        plan.file(org / "launchd" / name, render((KIT / "launchd" / name).read_text(), {"ORG": str(org), "PYTHON": python}))
    plan.file(org / "launchd" / "install.sh", (KIT / "launchd" / "install.sh").read_bytes(), mode=0o755)

    for e in entities:
        if e["id"] in existing:
            continue
        d = org / e["path"]
        plan.dir(d)
        plan.file(d / "BRIEF.md", brief(e, owner_name))
        plan.file(d / "status.json", json.dumps(starter_status(e), indent=2, ensure_ascii=False) + "\n")
        plan.file(d / "decisions.jsonl", "")

    group_names = {g["id"]: g["name"] for g in all_groups}
    director = (KIT / "agents" / "director.md").read_text()
    agents = {}             # name -> rendered, model-neutral text
    for e in entities:
        if e["id"] in existing and existing[e["id"]].get("lead") != f"{e['id']}-lead":
            continue
        agents[e["lead"]] = render(director, {
            "OWNER": owner_name, "ENTITY": e["name"], "ENTITY_ID": e["id"], "GROUP": group_names.get(e["group"], e["group"]),
            "ENTITY_DESC": (e["description"] or f"{e['name']}.").rstrip(".") + ".", "PATH": e["path"], "ORG": str(org)})
    agents["chief-of-staff"] = render((KIT / "agents" / "chief-of-staff.md").read_text(), {
        "OWNER": owner_name, "ORG": str(org), "ENTITY_TABLE": entity_table(org, all_groups, all_entities),
        "ENTITY_NAMES": ", ".join(x["name"] for x in all_entities)})
    for m in MANAGERS:
        agents[m] = render((KIT / "agents" / f"{m}.md").read_text(), {"OWNER": owner_name, "ORG": str(org)})

    cos_hint = "it lists the entities; add new ones to its table by hand"
    plan.dir(org / "agents")
    for name, text in agents.items():
        plan.file(org / "agents" / f"{name}.md", text, hint=cos_hint if name == "chief-of-staff" else "")
    install_for_runner(runner, agents, agents_dir, plan, cos_hint)
    return registry


def install_for_runner(runner, agents, agents_dir, plan, cos_hint=""):
    """Where the runner reads agents from, translated from the neutral files."""
    if runner == "claude-code":
        plan.dir(agents_dir)
        for name, text in agents.items():
            plan.file(agents_dir / f"{name}.md", runners.for_claude(*runners.split_agent(text)),
                      hint=cos_hint if name == "chief-of-staff" else "")
    elif runner == "opencode":
        d = runners.OpenCode.AGENTS
        plan.dir(d)
        for name, text in agents.items():
            plan.file(d / f"{name}.md", runners.for_opencode(*runners.split_agent(text)),
                      hint=cos_hint if name == "chief-of-staff" else "")
    elif runner == "codex":
        plan.dir(runners.Codex.RULES.parent)
        plan.file(runners.Codex.RULES, runners.codex_rules(), hint="your edits are kept; delete it to get the kit's again")


# --------------------------------------------------------------------------
# git, and what to run next
# --------------------------------------------------------------------------

def git(org, *args):
    return subprocess.run(["git", "-C", str(org), *args], capture_output=True, text=True)


def commit(org, message):
    """git init if needed, then commit when there is something to commit. Returns a short line."""
    if not shutil.which("git"):
        return "git not found: skipped the first commit"
    if not (org / ".git").exists():
        git(org, "init", "-q")
    git(org, "add", "-A")
    if not git(org, "status", "--porcelain").stdout.strip():
        return "nothing new to commit"
    ident = []
    if not git(org, "config", "user.email").stdout.strip():
        ident = ["-c", "user.name=Pulse setup", "-c", "user.email=setup@localhost"]
    out = subprocess.run(["git", *ident, "-C", str(org), "commit", "-q", "-m", message], capture_output=True, text=True)
    return "committed" if out.returncode == 0 else f"commit failed: {(out.stderr or out.stdout).strip()[:200]}"


def hooks_snippet(org):
    cmd = {"type": "command", "command": f"python3 {org}/bin/session_hook.py"}
    hooks = {ev: [{"matcher": "Agent|Task", "hooks": [cmd]}] if ev == "PreToolUse" else [{"hooks": [cmd]}]
             for ev in HOOK_EVENTS}
    return json.dumps({"hooks": hooks}, indent=2)


def tilde(p):
    s = str(p)
    return "~" + s[len(str(HOME)):] if s == str(HOME) or s.startswith(str(HOME) + "/") else s


def report(plan, org):
    width = max([len(r[0]) for r in plan.rows] + [6])
    for status, path, note in plan.rows:
        if status == "same":
            continue
        print(f"  {status:<{width}}  {tilde(path)}{'  (' + note + ')' if note else ''}")
    same = sum(1 for r in plan.rows if r[0] == "same")
    if same:
        print(f"  {'same':<{width}}  {same} file(s) already up to date")


def next_steps(org, registry):
    first = next((e for e in registry["entities"] if e.get("schedule") == "nightly"), registry["entities"][0])
    runner = runners.resolve(registry)["name"]
    ok, line = runner_check(runner)
    print(f"\nRunner: {line}")
    hooks = (f"""
4. So Pulse shows your own lead sessions under Working now, merge this
   into ~/.claude/settings.json (keep any hooks you already have):
{hooks_snippet(org)}
""" if runner == "claude-code" else """
4. (Claude Code only) Live view of your own chat sessions in Pulse needs Claude Code's
   hooks; with this runner, Pulse shows the night shift and decision runs live.
""")
    print(f"""
Next steps (setup ran none of these):

1. Talk to a lead and tell it about the business:
     python3 {tilde(org)}/bin/talk.py {first['id']}

2. Check the night shift can run (signs in, does no work):
     python3 {tilde(org)}/bin/nightly.py --check

3. Schedule it (directors nightly at 5:30am, chief of staff Mondays at 6:30am):
     sh {tilde(org)}/launchd/install.sh
{hooks}
5. Open Pulse. It reads ~/portfolio.

To switch runners later, set "runner" in {tilde(org)}/portfolio.json to claude-code, codex
or opencode (or re-run setup with --runner NAME, which also installs that runner's agents).""")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", help="answers as JSON (see example-config.json); no questions asked")
    ap.add_argument("--org-dir", default=str(HOME / "portfolio"))
    ap.add_argument("--agents-dir", default=str(HOME / ".claude" / "agents"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--yes", "-y", action="store_true")
    ap.add_argument("--update-bin", action="store_true")
    ap.add_argument("--runner", choices=sorted(runners.ADAPTERS))
    a = ap.parse_args(argv)

    org = pathlib.Path(os.path.expanduser(a.org_dir)).resolve()
    agents_dir = pathlib.Path(os.path.expanduser(a.agents_dir)).resolve()
    try:
        raw = json.loads(pathlib.Path(os.path.expanduser(a.config)).read_text()) if a.config else interview()
        if a.runner:
            raw["runner"] = a.runner
        answers = normalize(raw)
        plan = Plan(a.dry_run)
        registry = build(answers, org, agents_dir, plan, a.update_bin, switch_runner=bool(a.runner))
    except (SetupError, OSError, json.JSONDecodeError) as ex:
        print(f"Setup stopped: {ex}", file=sys.stderr)
        return 2

    if org != (HOME / "portfolio").resolve():
        print(f"Note: Pulse reads ~/portfolio only. {tilde(org)} works for the agents and the night shift, "
              "but Pulse won't show it unless ~/portfolio points there.\n")

    changes = plan.changes()
    print(f"Org: {tilde(org)}   Agents: {tilde(agents_dir)}")
    report(plan, org)
    if a.dry_run:
        print(f"\nDry run: {len(changes)} file(s) would be written. Nothing was written.")
        return 0
    if not changes:
        print("\nNothing to do: everything is already set up.")
        print(f"git: {commit(org, 'setup: re-run')}" if (org / ".git").exists() else "")
        next_steps(org, registry)
        return 0
    if not a.yes and not a.config:
        if ask(f"\nWrite {len(changes)} file(s)? (y/n)", "y").lower() not in ("y", "yes"):
            print("Nothing written.")
            return 1
    plan.apply()
    first = not (org / ".git").exists()
    print(f"\nWrote {len(changes)} file(s). git: {commit(org, 'setup: the org' if first else 'setup: add entities')}")
    next_steps(org, registry)
    return 0


if __name__ == "__main__":
    sys.exit(main())
