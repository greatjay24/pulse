"""Resend over HTTPS for the Outbox, stdlib only. One door:

  approved_send(item, approval_text)
      Sends one queued `resend_email` item, after the owner's click in Roo. Only
      outbox_send.py calls it. It re-checks the signed approval (sendguard.check with
      after_burn=True: the signature, the content hash, and that outbox_send.py already
      spent this exact approval), that the sender is on a verified Resend domain, and
      sends with an Idempotency-Key per item so a retry can't send twice.

Key: the macOS Keychain (service "project-tracker-imap", account "resend:send"), through
keyring_store.py. A Resend "Sending access" key, account-wide. Store it once with
`python3 ~/portfolio/bin/keyring_store.py set resend:send`. Never printed, never logged, never in argv.

Verified sender domains: <portfolio>/resend_domains.json {"domains": ["notify.example.com"]},
written by hand after you verify the domain in Resend (not a secret). A sender's domain must
be exactly one of them.
"""
import json, os, pathlib, re, sys, urllib.error, urllib.request

API = "https://api.resend.com"
KEY_NAME = "resend:send"
ORG = pathlib.Path(os.environ.get("PORTFOLIO_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
DOMAINS = ORG / "resend_domains.json"
DOMAIN = re.compile(r"^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


class ResendError(Exception):
    def __init__(self, status, msg, name=None):
        super().__init__(msg)
        self.status, self.name = status, name


class NotAllowed(Exception):
    pass


def domains():
    """Verified sender domains, lowercase. Empty when the setup script hasn't run."""
    try:
        d = json.loads(DOMAINS.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    return [x.lower() for x in (d.get("domains") or []) if isinstance(x, str) and DOMAIN.match(x.lower())]


def sender_ok(address, allowed=None):
    """True when the address's domain is a verified domain. Resend verifies exact domains
    (notify.example.com covers anything@notify.example.com, not anything@example.com)."""
    allowed = domains() if allowed is None else allowed
    dom = (address or "").rsplit("@", 1)[-1].lower()
    return bool(dom) and dom in allowed


def key():
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import keyring_store
    k = keyring_store.fetch(KEY_NAME)
    if not k:
        raise NotAllowed("no Resend key in the Keychain (resend:send): run: python3 ~/portfolio/bin/keyring_store.py set resend:send")
    if not k.startswith("re_"):
        raise NotAllowed("the Keychain item resend:send is not a Resend key")
    return k


def _gist(raw, status):
    try:
        err = json.loads(raw)
    except Exception:
        err = {}
    msg = (err.get("message") or "").split(" re_")[0][:200]
    return msg or f"HTTP {status}", err.get("name")


def _http(k, method, path, body=None, idem=None):
    """The one network function. Tests replace it."""
    headers = {"Authorization": f"Bearer {k}", "User-Agent": "portfolio-outbox/1.0", "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if idem:
        headers["Idempotency-Key"] = idem
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        msg, name = _gist(e.read(), e.code)
        raise ResendError(e.code, msg, name)


def payload(item):
    """The Resend request body for an item: plain text, threaded when it is a reply."""
    sender = item["from"]
    if item.get("from_name"):
        name = item["from_name"].replace('"', "'")
        sender = f'"{name}" <{item["from"]}>'
    body = {"from": sender, "to": item["to"], "subject": item["subject"], "text": item["body"]}
    if item.get("cc"):
        body["cc"] = item["cc"]
    if item.get("reply_to"):
        body["reply_to"] = [item["reply_to"]]
    if item.get("in_reply_to"):
        refs = item.get("references") or [item["in_reply_to"]]
        body["headers"] = {"In-Reply-To": f"<{item['in_reply_to']}>", "References": " ".join(f"<{r}>" for r in refs)}
    return body


def approved_send(item, approval_text, http=None):
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import sendguard
    sendguard.check(approval_text, item, after_burn=True)
    if item.get("kind") != "resend_email":
        raise NotAllowed(f"{item.get('kind')} doesn't go through Resend")
    if not sender_ok(item.get("from")):
        raise NotAllowed(f"{item.get('from')} is not on a verified Resend domain ({', '.join(domains()) or 'none recorded'})")
    res = (http or _http)(key(), "POST", "/emails", payload(item), idem=f"outbox-{item['id']}")
    return {"resend_id": res.get("id")}
