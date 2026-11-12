#!/usr/bin/env python3
"""The org's credentials, in one place: the macOS login Keychain (service
"project-tracker-imap", the service Roo itself reads org credentials from), or on Linux a
JSON file at ~/.config/pulse/secrets.json, mode 0600 in a 0700 folder.

The owner stores a key once (it prompts; the secret never goes on a command line):

    python3 ~/portfolio/bin/keyring_store.py set <name>     store or replace
    python3 ~/portfolio/bin/keyring_store.py check <name>   is it there? (never prints it)

Names the Outbox uses:
    <email account id>       the mailbox's app password (email_accounts.py)
    resend:send              a Resend "Sending access" key, re_... (resend_api.py)
    stripe:<entity>          a Stripe restricted key for agents: reads and drafts (stripe_api.py)
    stripe-action:<entity>   the Stripe key the owner's Approve click runs with (stripe_api.py)
    youtube:<channel>        written by connect_youtube.py (JSON)

Nothing in this module is ever logged or echoed. There is no delete command: remove an item
in Keychain Access if you need to.
"""
import getpass, json, os, pathlib, platform, re, subprocess, sys

SERVICE = "project-tracker-imap"
_DARWIN = platform.system() == "Darwin"
_FILE = pathlib.Path.home() / ".config" / "pulse" / "secrets.json"
NAME = re.compile(r"^[a-z0-9][a-z0-9:._-]{0,80}$")


# ---------------- macOS: Keychain ----------------

def _mac_store(account_id, password):
    subprocess.run(["security", "add-generic-password",
                    "-a", account_id, "-s", SERVICE, "-w", password, "-U"],
                   check=True, capture_output=True)


def _mac_fetch(account_id):
    r = subprocess.run(["security", "find-generic-password",
                        "-a", account_id, "-s", SERVICE, "-w"],
                       capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


# ---------------- Linux: locked file ----------------

def _file_load():
    try:
        return json.loads(_FILE.read_text())
    except Exception:
        return {}


def _file_save(d):
    _FILE.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(_FILE.parent, 0o700)
    tmp = _FILE.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(d, f)
    os.replace(tmp, _FILE)
    os.chmod(_FILE, 0o600)


def _file_store(account_id, password):
    d = _file_load()
    d[account_id] = password
    _file_save(d)


def _file_fetch(account_id):
    return _file_load().get(account_id)


# ---------------- public API ----------------

def store(account_id, password):
    (_mac_store if _DARWIN else _file_store)(account_id, password)


def fetch(account_id):
    return (_mac_fetch if _DARWIN else _file_fetch)(account_id)


def main(argv):
    if len(argv) != 2 or argv[0] not in ("set", "check") or not NAME.match(argv[1]):
        print(__doc__.strip().split("\n\n")[1], file=sys.stderr)
        return 2
    cmd, name = argv
    if cmd == "check":
        ok = bool(fetch(name))
        print(f"{name}: {'stored' if ok else 'not stored'}")
        return 0 if ok else 1
    secret = getpass.getpass(f"Secret for {name} (input hidden): ").strip()
    if not secret:
        print("Nothing stored.", file=sys.stderr)
        return 1
    store(name, secret)
    print(f"{name}: stored")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
