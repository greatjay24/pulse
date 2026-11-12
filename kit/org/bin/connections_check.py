#!/usr/bin/env python3
"""Refresh the status of every system in <org>/connections.json (Roo's Connections page).

    connections_check.py            check everything, rewrite statuses, print a summary
    connections_check.py --json     print the summary as JSON (Roo's Refresh button)
    connections_check.py --dry-run  check and print, write nothing
    connections_check.py --no-mcp   skip `claude mcp list` (slow: it pings every server)

Each entry's `check` says how to tell whether agents can reach it:
  {"type": "mcp", "name": "claude.ai Gmail"}       a line in `claude mcp list`
  {"type": "cli", "cmd": "gh"}                     gh auth status / vercel whoami succeed
  {"type": "mailbox"}                              every portfolio.json email_accounts id has its
                                                   password in the Keychain (the secret is never read)
  {"type": "imap"}                                 an optional tracker's email feed: every account ok
  {"type": "tracker_data", "file": "stripe.json"}  <tracker>/data/<file> has ok: true (PULSE_TRACKER_DIR,
                                                   default ~/project-tracker; "not-set-up" without one)
  {"type": "keychain", "service": "...", "account": "..."}  the item exists (secret never read)
  {"type": "readable", "path": "~/Library/Messages/chat.db"} openable (Full Disk Access); nothing read
  {"type": "manual"}                               nothing to check; status stays as set
Status is connected | needs-auth | not-set-up. Never prints or stores a secret: commands
run with their output parsed for status words only, and `security` is called without -w.

Without a connections.json, the first run writes a starter one (STARTER below: mailboxes, the
claude.ai connectors, GitHub, Vercel, Stripe) for every entity in portfolio.json. Edit it freely
afterwards; this script only rewrites the status fields.
PORTFOLIO_ROOT overrides the org folder (default: the parent of this bin/).
"""
import argparse, datetime, json, os, pathlib, re, shutil, subprocess, sys

HOME = pathlib.Path.home()
ORG = pathlib.Path(os.environ.get("PORTFOLIO_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
FILE = ORG / "connections.json"
DATA = pathlib.Path(os.environ.get("PULSE_TRACKER_DIR") or HOME / "project-tracker") / "data"
KEYCHAIN_SERVICE = "project-tracker-imap"     # keyring_store.py's service (Roo reads the same one)
PATH = f"{HOME}/.local/bin:{HOME}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
STATUSES = ("connected", "needs-auth", "not-set-up")
KIT_BIN = str(ORG / "bin")


def starter(reg):
    """A first connections.json: what agents commonly reach, each with how to connect it."""
    ents = [e["id"] for e in reg.get("entities", []) if isinstance(e, dict) and e.get("id")]
    def row(id_, name, category, for_, access, mode, check, steps, notes=""):
        return {"id": id_, "name": name, "category": category, "for": for_, "entities": list(ents), "access": access,
                "mode": mode, "status": "not-set-up", "check": check, "connect_steps": steps, "notes": notes, "sources": []}
    return {
        "_comment": "What the agents can reach. bin/connections_check.py refreshes each status from its `check`.",
        "systems": [
            row("email", "Email (Outbox mailboxes)", "Communication",
                "Save drafts and send on your click from the Outbox",
                "IMAP drafts and SMTP with an app password in the Keychain; SMTP only on the owner's click",
                "draft; send on your click", {"type": "mailbox"},
                ['Add the mailbox to "email_accounts" in portfolio.json: {"<id>": {"address": "you@example.com", "entity": "<entity id>"}}.',
                 f"python3 {KIT_BIN}/keyring_store.py set <id>   (paste the mailbox's app password)"]),
            row("gmail-connector", "Gmail (claude.ai connector)", "Communication", "Search and read mail, write drafts",
                "Claude Code's claude.ai Gmail connector", "read + draft", {"type": "mcp", "name": "claude.ai Gmail"},
                ["In Claude Code: /mcp, then connect claude.ai Gmail (or connect it at claude.ai, Settings > Connectors)."],
                "Its send, reply and trash tools are on the agents' deny list."),
            row("calendar", "Google Calendar (claude.ai connector)", "Scheduling", "Read your calendar, propose holds",
                "Claude Code's claude.ai Google Calendar connector", "read + holds",
                {"type": "mcp", "name": "claude.ai Google Calendar"},
                ["In Claude Code: /mcp, then connect claude.ai Google Calendar."]),
            row("github", "GitHub", "Engineering", "Branches, pull requests, CI", "the gh CLI, signed in",
                "branches and PRs; merges need your yes", {"type": "cli", "cmd": "gh"}, ["brew install gh && gh auth login"]),
            row("vercel", "Vercel", "Engineering", "Preview deploys", "the vercel CLI, signed in",
                "previews; production needs your yes", {"type": "cli", "cmd": "vercel"}, ["npm i -g vercel && vercel login"]),
            row("stripe", "Stripe", "Money", "Draft invoices and quotes; refunds and charges only on your click",
                "a restricted key per business in the Keychain (stripe:<entity>), and an action key (stripe-action:<entity>)",
                "draft; act on your click", {"type": "keychain", "service": KEYCHAIN_SERVICE, "account": f"stripe:{ents[0]}" if ents else "stripe"},
                [f"python3 {KIT_BIN}/keyring_store.py set stripe:<entity>   (a restricted key)",
                 f"python3 {KIT_BIN}/keyring_store.py set stripe-action:<entity>   (used only by the Approve click)"]),
        ],
    }


def registry():
    try:
        reg = json.loads((ORG / "portfolio.json").read_text())
        return reg if isinstance(reg, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def keychain_has(account, service=KEYCHAIN_SERVICE):
    code, _ = run(["security", "find-generic-password", "-s", service, "-a", account])   # no -w: nothing read
    return code == 0


def run(cmd, timeout=30):
    env = dict(os.environ, PATH=PATH)
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env,
                           stdin=subprocess.DEVNULL, cwd=str(HOME))
        return p.returncode, p.stdout + p.stderr
    except (OSError, subprocess.TimeoutExpired) as e:
        return -1, type(e).__name__


_mcp_cache = None


def mcp_lines():
    """{server name: status word} from `claude mcp list`. Cached per run."""
    global _mcp_cache
    if _mcp_cache is None:
        _mcp_cache = {}
        claude = shutil.which("claude", path=PATH)
        if not claude:
            return _mcp_cache
        code, out = run([claude, "mcp", "list"], timeout=180)
        for line in out.splitlines():
            m = re.match(r"^(.+?): .* - (✔|!|✘|⊘)\s*(.*)$", line.strip())
            if m:
                word = {"✔": "connected", "!": "needs-auth", "✘": "failed", "⊘": "disabled"}[m.group(2)]
                _mcp_cache[m.group(1).strip()] = word
    return _mcp_cache


def check_one(spec, skip_mcp=False):
    """(status, detail) or None to keep the current status."""
    t = (spec or {}).get("type", "manual")
    if t == "mcp":
        if skip_mcp:
            return None
        word = mcp_lines().get(spec["name"])
        if word is None:
            return "not-set-up", f"{spec['name']} is not in `claude mcp list`"
        if word == "connected":
            return "connected", f"{spec['name']}: connected"
        return "needs-auth", f"{spec['name']}: {word}"
    if t == "cli":
        cmd = spec["cmd"]
        if not shutil.which(cmd, path=PATH):
            return "not-set-up", f"{cmd} is not installed"
        probe = {"gh": [cmd, "auth", "status"], "vercel": [cmd, "whoami"]}.get(cmd, [cmd, "--version"])
        code, _ = run(probe)
        return ("connected", f"{cmd}: signed in") if code == 0 else ("needs-auth", f"{cmd}: not signed in")
    if t == "mailbox":
        accts = registry().get("email_accounts") or {}
        ids = list(accts) if isinstance(accts, dict) else [a.get("id") for a in accts if isinstance(a, dict) and a.get("id")]
        if not ids:
            return "not-set-up", "no email_accounts in portfolio.json"
        missing = [i for i in ids if not keychain_has(i)]
        if missing:
            return "needs-auth", f"no password in the Keychain for: {', '.join(missing)}"
        return "connected", f"{len(ids)} mailbox(es): {', '.join(ids)}"
    if t == "imap":
        try:
            accts = json.loads((DATA / "email.json").read_text()).get("accounts", {})
        except (OSError, json.JSONDecodeError):
            return "not-set-up", "no email feed yet"
        bad = [k for k, v in accts.items() if not (isinstance(v, dict) and v.get("ok"))]
        if not accts:
            return "not-set-up", "no accounts in the email feed"
        if bad:
            return "needs-auth", f"failing: {', '.join(bad)}"
        return "connected", f"{len(accts)} accounts reading ({', '.join(accts)})"
    if t == "tracker_data":
        try:
            d = json.loads((DATA / spec["file"]).read_text())
        except (OSError, json.JSONDecodeError):
            return "not-set-up", f"no {spec['file']} yet"
        if d.get("ok"):
            return "connected", f"{spec['file']}: ok"
        reason = str(d.get("reason") or "not ok")[:80]
        return ("not-set-up" if "not configured" in reason else "needs-auth"), f"{spec['file']}: {reason}"
    if t == "keychain":
        args = ["security", "find-generic-password", "-s", spec["service"]]
        if spec.get("account"):
            args += ["-a", spec["account"]]
        code, _ = run(args)            # no -w: attributes only, and the output is discarded
        return ("connected", "key in Keychain") if code == 0 else ("not-set-up", "no key in Keychain")
    if t == "readable":
        p = pathlib.Path(os.path.expanduser(spec["path"]))
        if not p.exists():
            return "not-set-up", "not found"
        try:
            with open(p, "rb"):
                pass                    # open only: proves access, reads nothing
            return "connected", "readable now: this terminal already has Full Disk Access"
        except PermissionError:
            return "needs-auth", "needs Full Disk Access for the agent's terminal"
        except OSError as e:
            return "needs-auth", type(e).__name__
    return None


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-mcp", action="store_true")
    a = ap.parse_args(argv)
    try:
        doc = json.loads(FILE.read_text())
    except FileNotFoundError:
        doc = starter(registry())
    except (OSError, json.JSONDecodeError) as e:
        print(json.dumps({"ok": False, "error": f"connections.json: {type(e).__name__}"}) if a.json else f"connections.json: {e}")
        return 2
    now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    summary = []
    for c in doc.get("systems", []):
        try:
            res = check_one(c.get("check"), skip_mcp=a.no_mcp)
        except (KeyError, TypeError) as e:
            res = ("needs-auth", f"bad check in connections.json: {type(e).__name__}")
        if res:
            status, detail = res
            if status not in STATUSES:
                status = "needs-auth"
            c["status"], c["status_detail"], c["checked_at"] = status, detail, now
        summary.append({"id": c["id"], "status": c.get("status"), "detail": c.get("status_detail")})
    if not a.dry_run:
        doc["checked_at"] = now
        tmp = FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
        os.replace(tmp, FILE)
    if a.json:
        print(json.dumps({"ok": True, "checked_at": now, "systems": summary}))
    else:
        for s in summary:
            print(f"{s['status'] or '?':<11} {s['id']:<16} {s['detail'] or ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
