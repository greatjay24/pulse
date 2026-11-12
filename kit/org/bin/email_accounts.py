"""The mailboxes the Outbox drafts in and sends from. Stdlib only.

Accounts live in portfolio.json, one per mailbox, keyed by a short id the agents use
(outbox_add.py --account <id>):

    "email_accounts": {
      "acme": {"address": "you@acme.example", "entity": "acme", "label": "Acme",
               "imap_host": "imap.gmail.com", "imap_port": 993,      // defaults shown
               "smtp_host": "smtp.gmail.com", "smtp_port": 465}
    }

(A list of objects with an "id" works too.) The password is an app password (Gmail: Google
Account > Security > App passwords), kept in the macOS Keychain under the account id, never
in a file. Store it once yourself; it prompts, so the password never lands in your shell history:

    python3 ~/portfolio/bin/keyring_store.py set acme

Optional: an existing task tracker (PULSE_TRACKER_DIR, default ~/project-tracker) with an
accounts.json {"accounts": [{"id", "address", "host", "port", "auth"}]} is read too, for
accounts not in portfolio.json. Its "auth": "oauth" accounts use the tracker's oauth_google.py
when it is there. Nothing here needs the tracker.

What this module does with a mailbox: saves a draft into its Drafts folder (IMAP APPEND, the
same message the Outbox holds), reads a message's References header read-only (EXAMINE and
BODY.PEEK, so nothing is marked read), and hands outbox_send.py the account for the SMTP send
the owner's click makes. It never sends, deletes, moves or flags mail.
"""
import email.message, email.utils, imaplib, json, os, pathlib, re, sys, time

HOME = pathlib.Path.home()
ORG = pathlib.Path(os.environ.get("PORTFOLIO_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
TRACKER = pathlib.Path(os.environ.get("PULSE_TRACKER_DIR") or HOME / "project-tracker")
ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
SMTP_FOR = {"imap.gmail.com": ("smtp.gmail.com", 465)}
DEFAULT_IMAP = "imap.gmail.com"


class Unknown(ValueError):
    pass


def _rows(v):
    if isinstance(v, dict):
        return [{**a, "id": k} for k, a in v.items() if isinstance(a, dict)]
    if isinstance(v, list):
        return [a for a in v if isinstance(a, dict)]
    return []


def _norm(a, source):
    a = dict(a)
    a["imap_host"] = a.get("imap_host") or a.get("host") or DEFAULT_IMAP
    a["host"] = a["imap_host"]
    a["imap_port"] = a.get("imap_port") or a.get("port") or 993
    a["source"] = source
    return a


def accounts():
    """{id: account}: portfolio.json "email_accounts", then the optional tracker's accounts.json."""
    out = {}
    try:
        reg = json.loads((ORG / "portfolio.json").read_text())
    except (OSError, json.JSONDecodeError):
        reg = {}
    for a in _rows(reg.get("email_accounts") if isinstance(reg, dict) else None):
        if ID.match(str(a.get("id") or "")) and a.get("address"):
            out[a["id"]] = _norm(a, "portfolio")
    try:
        tracker = json.loads((TRACKER / "accounts.json").read_text())
    except (OSError, json.JSONDecodeError):
        tracker = {}
    for a in _rows(tracker.get("accounts") if isinstance(tracker, dict) else None):
        if ID.match(str(a.get("id") or "")) and a.get("address") and a["id"] not in out:
            out[a["id"]] = _norm(a, "tracker")
    return out


def ids():
    return sorted(accounts())


def account(aid):
    acct = accounts().get(aid or "")
    if not acct:
        have = ", ".join(ids()) or "none yet"
        raise Unknown(f"no email account {aid!r} (accounts: {have}); add it to \"email_accounts\" in portfolio.json")
    return acct


def _tracker_module(name):
    if str(TRACKER) not in sys.path:
        sys.path.insert(0, str(TRACKER))
    return __import__(name)


def password(acct):
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import keyring_store
    pw = keyring_store.fetch(acct["id"])
    if not pw:
        raise Unknown(f"{acct['id']}: no password in the Keychain; run: python3 ~/portfolio/bin/keyring_store.py set {acct['id']}")
    return pw


def connect_imap(acct):
    pw = None if acct.get("auth") == "oauth" else password(acct)     # no password: no connection at all
    M = imaplib.IMAP4_SSL(acct["imap_host"], int(acct.get("imap_port") or 993), timeout=30)
    if pw is None:
        oauth_google = _tracker_module("oauth_google")
        tok, err = oauth_google.access_token_for(acct["id"], acct.get("oauth_client", "default"))
        if err:
            raise Unknown(f"{acct['id']}: {err}")
        M.authenticate("XOAUTH2", lambda _: oauth_google.xoauth2_string(acct["address"], tok).encode())
    else:
        M.login(acct["address"], pw)
    return M


def message(item, acct):
    """The email the Outbox holds, as an EmailMessage from the account's address."""
    msg = email.message.EmailMessage()
    msg["From"] = acct["address"]
    msg["To"] = ", ".join(item["to"])
    if item.get("cc"):
        msg["Cc"] = ", ".join(item["cc"])
    msg["Subject"] = item["subject"]
    msg["Date"] = email.utils.formatdate(localtime=True)
    msg["Message-ID"] = email.utils.make_msgid(domain=acct["address"].split("@")[-1])
    if item.get("in_reply_to"):
        msg["In-Reply-To"] = f"<{item['in_reply_to']}>"
        refs = item.get("references") or [item["in_reply_to"]]
        msg["References"] = " ".join(f"<{r}>" for r in refs)
    msg.set_content(item["body"].rstrip() + "\n")
    return msg


def save_draft(item):
    """Writes the item into its mailbox's Drafts folder. Returns (saved, error). Never raises."""
    try:
        acct = account(item.get("account"))
        M = connect_imap(acct)
    except Exception as e:
        return False, str(e)[:200] if isinstance(e, Unknown) else type(e).__name__
    try:
        for name in ('"[Gmail]/Drafts"', '"Drafts"', '"INBOX.Drafts"'):
            ok, _ = M.select(name)
            if ok == "OK":
                ok, resp = M.append(name, r"(\Draft \Seen)", imaplib.Time2Internaldate(time.time()),
                                    message(item, acct).as_bytes())
                return (True, None) if ok == "OK" else (False, f"append failed: {str(resp)[:150]}")
        return False, "no Drafts folder found"
    except Exception as e:
        return False, type(e).__name__
    finally:
        try:
            M.logout()
        except Exception:
            pass


def find_references(aid, mid):
    """References chain for a reply: the original's References + its Message-ID. Read-only
    (EXAMINE, header PEEK). Best effort: falls back to [mid]."""
    try:
        M = connect_imap(account(aid))
    except Exception:
        return [mid]
    try:
        for folder in ('"[Gmail]/All Mail"', "INBOX"):
            ok, _ = M.select(folder, readonly=True)
            if ok != "OK":
                continue
            ok, data = M.uid("SEARCH", None, "HEADER", "Message-ID", mid)
            uids = (data[0] or b"").split() if ok == "OK" and data else []
            if uids:
                ok, data = M.uid("FETCH", uids[0], "(BODY.PEEK[HEADER.FIELDS (REFERENCES)])")
                for part in data or []:
                    if isinstance(part, tuple):
                        refs = re.findall(r"<([^<>\s]+)>", part[1].decode("utf-8", "replace"))
                        return [r for r in refs if r != mid][-20:] + [mid]
    except Exception:
        pass
    finally:
        try:
            M.logout()
        except Exception:
            pass
    return [mid]
