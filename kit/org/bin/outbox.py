#!/usr/bin/env python3
"""The Outbox: things agents prepared that wait for the owner's one click in Roo.

    outbox.py list [--status pending|sent|skipped|approved|all]   JSON list (newest first)
    outbox.py edit <id>        reads the kind's editable fields as JSON on stdin (Roo's Edit)
    outbox.py skip <id> [--note "..."]                            Roo's Skip
    outbox.py published <id>   Roo's "Mark published" after the owner posted it by hand

Agents add with outbox_add.py. Only Roo sends, through outbox_send.py (see sendguard.py).
Each item is <portfolio>/outbox/<id>.json. Every kind has:

  id, kind, entity, account, to [..], cc [..], subject, body, why, created_by, created_at,
  status pending|sending|sent|approved|published|skipped|failed,
  sent_at, skipped_at, edited_at, approved_at, published_at, error, history [{at, what}],
  original {field: the agent's text before the owner's first edit of it}

  email   account (an id from portfolio.json "email_accounts", see email_accounts.py), to/cc addresses, in_reply_to, references [..],
          thread, draft {saved, error}, sent_message_id. Sent over SMTP on the click.
  resend_email  from (an address on a verified Resend domain), from_name, reply_to, to/cc,
          in_reply_to, references [..]; account "resend". Sent through the Resend API on the
          click with the Keychain key resend:send (resend_api.py). resend_id after sending.
  post    channel (instagram|linkedin|x|newsletter|site|youtube|tiktok), title, link, media [..]
  text    to [phone numbers]          dm  channel, to [handles], link     slack  channel, link
          No publishing connector yet: the click marks them "approved" and Roo offers
          copy-to-clipboard and the place to post. "published" once the owner says so.
  tiktok_post  account (@handle), title, body (the caption), media [one video path or URL],
          ai_label yes|no, privacy public|friends|followers|private, schedule (date or
          YYYY-MM-DDTHH:MM, "post on"), notes (cover frame, music, ...). Approve-then-publish
          by hand like a post: TikTok publishing through Higgsfield needs its interactive
          publish form, so there's no headless path yet (publish_hooks.py has the details).
  youtube_upload  channel (Keychain youtube:<channel>, set by connect_youtube.py), title,
          body (the description), tags [..], privacy private|unlisted|public (default
          private), publish_at (YYYY-MM-DDTHH:MM local, with privacy private: YouTube makes
          it public then), category_id, made_for_kids yes|no, ai_altered yes|no,
          media [one local video file], notes. Uploaded through the YouTube Data API on the
          click, in the background (youtube_api.py) -> "published" with the video link.
  stripe_send_invoice  stripe_id (in_), customer_id, customer, amount (minor units), currency, due_date
  stripe_send_quote    stripe_id (qt_), customer_id, customer, amount, currency
  stripe_refund        stripe_id (ch_ or pi_), amount, currency, reason, customer
  stripe_subscription  action (create|update), stripe_id (sub_, for update), customer_id, customer,
                       items ["price_..:qty"], amount (per interval), currency, interval, days_until_due
  stripe_charge        customer_id, customer, payment_method (pm_, resolved when queued), card
                       ("Visa •••• 4242, exp 04/28"), amount, currency, description,
                       statement_descriptor_suffix. Charges the saved card off-session on the click.
          Run on the click with the entity's action key (Keychain stripe-action:<entity>, stored with
          keyring_store.py set); result {...} and link land on the item.

Every executed click is also logged to <portfolio>/logs/outbox-actions.jsonl (Roo Activity).

Every write goes through here under a per-item lock and lands atomically.
PORTFOLIO_ROOT overrides the org folder (default: the parent of this bin/).
"""
import argparse, contextlib, datetime, fcntl, json, os, pathlib, re, sys

ORG = pathlib.Path(os.environ.get("PORTFOLIO_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
OUTBOX = ORG / "outbox"
STATUSES = ("pending", "sending", "sent", "approved", "published", "skipped", "failed")
KINDS = ("email", "resend_email", "post", "text", "dm", "slack", "tiktok_post", "youtube_upload",
         "stripe_send_invoice", "stripe_send_quote", "stripe_refund", "stripe_subscription", "stripe_charge")
PUBLISH_KINDS = ("post", "text", "dm", "slack", "tiktok_post")      # approved, then published by hand
UPLOAD_KINDS = ("youtube_upload",)                   # carried out through an API on the click
STRIPE_KINDS = tuple(k for k in KINDS if k.startswith("stripe_"))
POST_CHANNELS = ("instagram", "linkedin", "x", "newsletter", "site", "youtube", "tiktok")
DM_CHANNELS = ("instagram", "linkedin", "x", "facebook", "whatsapp", "other")
# Where the owner posts by hand when the item has no link of its own.
CHANNEL_HOME = {"instagram": "https://www.instagram.com/", "linkedin": "https://www.linkedin.com/feed/",
                "x": "https://x.com/compose/post", "tiktok": "https://www.tiktok.com/tiktokstudio/upload",
                "facebook": "https://www.facebook.com/messages/",
                "whatsapp": "https://web.whatsapp.com/", "youtube": "https://studio.youtube.com/"}
# Editable in Roo, by kind. Stripe items are edited in Stripe (by the agent), then re-queued.
EMAIL_KINDS = ("email", "resend_email")
EDITABLE = {"email": {"to", "cc", "subject", "body"}, "resend_email": {"to", "cc", "subject", "body"}, "post": {"title", "body", "link"},
            "text": {"to", "body"}, "dm": {"to", "body", "link"}, "slack": {"body", "link"},
            "tiktok_post": {"title", "body"}, "youtube_upload": {"title", "body"}}
PHONE = re.compile(r"^\+?[0-9]{7,15}$")
HANDLE = re.compile(r"^@?[A-Za-z0-9._-]{1,60}$")
URL = re.compile(r"^https://[^\s<>\"']{3,500}$")
SLACK_CHANNEL = re.compile(r"^[a-z0-9-]{0,40}/?#[a-z0-9._-]{1,80}$")
STRIPE_ID = re.compile(r"^(in|qt|ch|pi|sub|cus|pm)_[A-Za-z0-9]{6,80}$")
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,99}$")
EMAIL = re.compile(r"^[^@\s,;<>\"']+@[^@\s,;<>\"']+\.[^@\s,;<>\"']+$")
SUBJECT_MAX, BODY_MAX, WHY_MAX, RECIPIENTS_MAX = 300, 20000, 1000, 20
TEXT_MAX = 1600            # a long SMS; DMs and Slack share it
TIKTOK_CAPTION_MAX, YT_TITLE_MAX, YT_DESC_MAX, YT_TAGS_MAX, NOTES_MAX = 2200, 100, 5000, 500, 2000
TIKTOK_PRIVACY = ("public", "friends", "followers", "private")
YT_PRIVACY = ("private", "unlisted", "public")
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
SCHEDULE = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$")
PLACEHOLDER = re.compile(r"\[[^\]\n]{3,80}\]")      # "[their TikTok handle]": not filled in yet


class Invalid(ValueError):
    pass


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def printable(s, keep="\n\t"):
    s = (s or "").replace("\r\n", "\n")
    return "".join(ch for ch in s if ch in keep or ch.isprintable())


def addresses(v):
    """A list of plain addresses from a list or a comma/semicolon string."""
    if v is None:
        return []
    if isinstance(v, str):
        v = re.split(r"[,;]", v)
    out = []
    for a in v:
        a = (a or "").strip().lower()
        if not a:
            continue
        if not EMAIL.match(a):
            raise Invalid(f"not an email address: {a[:80]}")
        if a not in out:
            out.append(a)
    if len(out) > RECIPIENTS_MAX:
        raise Invalid("too many recipients")
    return out


def msgid(v):
    v = printable(v or "", keep="").strip().strip("<>").strip()
    if v and (len(v) > 250 or not re.match(r"^[^\s<>]+@[^\s<>]+$", v)):
        raise Invalid("in_reply_to is not a Message-ID")
    return v or None


def clean_fields(f, partial=False):
    """Validate the editable fields. partial=True accepts a subset (edits)."""
    out = {}
    if "to" in f or not partial:
        out["to"] = addresses(f.get("to"))
        if not out["to"]:
            raise Invalid("needs at least one recipient")
    if "cc" in f or not partial:
        out["cc"] = addresses(f.get("cc"))
    if "subject" in f or not partial:
        out["subject"] = printable(f.get("subject"), keep="").strip()
        if not out["subject"]:
            raise Invalid("needs a subject")
        if len(out["subject"]) > SUBJECT_MAX:
            raise Invalid("subject is too long")
    if "body" in f or not partial:
        out["body"] = printable(f.get("body")).rstrip() + "\n"
        if not out["body"].strip():
            raise Invalid("needs a body")
        if len(out["body"]) > BODY_MAX:
            raise Invalid("body is too long")
    return out


def kind_of(item):
    return item.get("kind") or "email"


def _list(v, pattern, what, norm=lambda x: x):
    if v is None:
        return []
    if isinstance(v, str):
        v = re.split(r"[,;\n]", v)
    out = []
    for x in v:
        x = printable(x or "", keep="").strip()
        if what == "phone number":
            x = re.sub(r"[\s().-]", "", x)
        x = norm(x) if x else x
        if not x:
            continue
        if not pattern.match(x):
            raise Invalid(f"not a {what}: {x[:80]}")
        if x not in out:
            out.append(x)
    if len(out) > RECIPIENTS_MAX:
        raise Invalid("too many recipients")
    return out


def _text(v, name, maxlen, required=False, keep="\n\t"):
    t = printable(v, keep=keep).strip() if keep == "" else printable(v, keep=keep).rstrip()
    if required and not t.strip():
        raise Invalid(f"needs {name}")
    if len(t) > maxlen:
        raise Invalid(f"{name} is too long")
    return t


def _link(v):
    v = printable(v or "", keep="").strip()
    if v and not URL.match(v):
        raise Invalid("link must be an https:// URL")
    return v or None


def clean_kind_fields(kind, f, partial=False):
    """Validate a non-email kind's editable/queued fields. partial=True accepts a subset."""
    out = {}
    has = lambda k: k in f or not partial
    if kind == "post":
        if has("channel"):
            if f.get("channel") not in POST_CHANNELS:
                raise Invalid(f"channel must be one of {list(POST_CHANNELS)}")
            out["channel"] = f["channel"]
        if has("title"):
            out["title"] = _text(f.get("title"), "title", SUBJECT_MAX, keep="") or None
        if has("body"):
            out["body"] = _text(f.get("body"), "a body", BODY_MAX, required=True)
        if has("link"):
            out["link"] = _link(f.get("link"))
        if has("media"):
            media = [printable(m or "", keep="").strip() for m in (f.get("media") or [])]
            media = [m for m in media if m]
            if len(media) > 10 or any(len(m) > 500 for m in media):
                raise Invalid("media: at most 10 paths or URLs")
            out["media"] = media
    elif kind in ("text", "dm", "slack"):
        if kind == "dm" and has("channel"):
            if f.get("channel") not in DM_CHANNELS:
                raise Invalid(f"channel must be one of {list(DM_CHANNELS)}")
            out["channel"] = f["channel"]
        if kind == "slack" and has("channel"):
            ch = printable(f.get("channel") or "", keep="").strip().lower()
            if not SLACK_CHANNEL.match(ch):
                raise Invalid("slack channel looks like #general or workspace/#general")
            out["channel"] = ch
        if kind == "text" and has("to"):
            out["to"] = _list(f.get("to"), PHONE, "phone number")
            if not out["to"]:
                raise Invalid("needs at least one phone number")
        if kind == "dm" and has("to"):
            out["to"] = _list(f.get("to"), HANDLE, "handle", lambda h: h if h.startswith("@") else "@" + h)
            if not out["to"]:
                raise Invalid("needs at least one handle")
        if has("body"):
            out["body"] = _text(f.get("body"), "a body", TEXT_MAX, required=True)
        if kind in ("dm", "slack") and has("link"):
            out["link"] = _link(f.get("link"))
    elif kind == "tiktok_post":
        if has("account"):
            out["account"] = _list(f.get("account"), HANDLE, "TikTok handle", lambda h: h if h.startswith("@") else "@" + h)[:1]
            if not out["account"]:
                raise Invalid("needs the TikTok account (@handle)")
            out["account"] = out["account"][0]
        if has("title"):
            out["title"] = _text(f.get("title"), "title", SUBJECT_MAX, keep="") or None
        if has("body"):
            out["body"] = _text(f.get("body"), "a caption", TIKTOK_CAPTION_MAX, required=True)
        if has("media"):
            out["media"] = _one_video(f.get("media"), allow_url=True)
        if has("ai_label"):
            out["ai_label"] = _yes_no(f.get("ai_label"), "ai_label")
        if has("privacy"):
            out["privacy"] = _choice(f.get("privacy") or "public", TIKTOK_PRIVACY, "privacy")
        if has("schedule"):
            out["schedule"] = _schedule(f.get("schedule"))
        if has("notes"):
            out["notes"] = _text(f.get("notes"), "notes", NOTES_MAX) or None
    elif kind == "youtube_upload":
        if has("channel"):
            ch = printable(f.get("channel") or "", keep="").strip().lower()
            if not SLUG.match(ch):
                raise Invalid("channel is the YouTube connection name, e.g. acme (connect_youtube.py acme)")
            out["channel"] = ch
        if has("title"):
            out["title"] = _text(f.get("title"), "a title", YT_TITLE_MAX, required=True, keep="")
            if re.search(r"[<>]", out["title"]):
                raise Invalid("YouTube titles can't contain < or >")
        if has("body"):
            out["body"] = _text(f.get("body"), "a description", YT_DESC_MAX)
            if re.search(r"[<>]", out["body"]):
                raise Invalid("YouTube descriptions can't contain < or >")
        if has("tags"):
            tags = f.get("tags") or []
            if isinstance(tags, str):
                tags = tags.split(",")
            tags = [printable(t or "", keep="").strip().replace('"', "") for t in tags]
            tags = list(dict.fromkeys(t for t in tags if t))
            if sum(len(t) + (2 if " " in t else 0) for t in tags) + max(0, len(tags) - 1) > YT_TAGS_MAX:
                raise Invalid(f"tags: at most {YT_TAGS_MAX} characters in all")
            out["tags"] = tags
        if has("privacy"):
            out["privacy"] = _choice(f.get("privacy") or "private", YT_PRIVACY, "privacy")
        if has("publish_at"):
            pa = _schedule(f.get("publish_at"))
            if pa and "T" not in pa:
                raise Invalid("publish_at needs a time: YYYY-MM-DDTHH:MM")
            out["publish_at"] = pa
        if has("category_id"):
            cat = str(f.get("category_id") or "22").strip()
            if not re.fullmatch(r"[0-9]{1,3}", cat):
                raise Invalid("category_id is YouTube's number, e.g. 22 (People & Blogs) or 10 (Music)")
            out["category_id"] = cat
        if has("made_for_kids"):
            out["made_for_kids"] = _yes_no(f.get("made_for_kids"), "made_for_kids")
        if has("ai_altered"):
            out["ai_altered"] = _yes_no(f.get("ai_altered"), "ai_altered")
        if has("media"):
            out["media"] = _one_video(f.get("media"), allow_url=False)
        if has("notes"):
            out["notes"] = _text(f.get("notes"), "notes", NOTES_MAX) or None
        if out.get("publish_at") and out.get("privacy", "private") != "private":
            raise Invalid("a scheduled YouTube upload stays private until publish_at: use privacy private")
    else:
        raise Invalid(f"{kind} has no editable fields here")
    return out


VIDEO_EXT = (".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv")


def _one_video(v, allow_url):
    media = [printable(m or "", keep="").strip() for m in ([v] if isinstance(v, str) else (v or []))]
    media = [m for m in media if m]
    if len(media) != 1:
        raise Invalid("media: exactly one video")
    m = media[0]
    if allow_url and URL.match(m):
        return [m]
    p = pathlib.Path(m).expanduser()
    if not p.is_absolute() or ".." in p.parts:
        raise Invalid("media: the video's full path" + (" or an https URL" if allow_url else ""))
    if p.suffix.lower() not in VIDEO_EXT:
        raise Invalid(f"media: a video file ({', '.join(VIDEO_EXT)})")
    return [str(p)]


def _yes_no(v, name):
    if v in (True, "yes", "true", "1", "on"):
        return "yes"
    if v in (None, False, "", "no", "false", "0", "off"):
        return "no"
    raise Invalid(f"{name} is yes or no")


def _choice(v, allowed, name):
    v = printable(str(v), keep="").strip().lower()
    if v not in allowed:
        raise Invalid(f"{name} must be one of {list(allowed)}")
    return v


def _schedule(v):
    v = printable(v or "", keep="").strip()
    if not v:
        return None
    if not SCHEDULE.match(v):
        raise Invalid("schedule is YYYY-MM-DD or YYYY-MM-DDTHH:MM (local time)")
    try:
        datetime.datetime.strptime(v, "%Y-%m-%dT%H:%M" if "T" in v else "%Y-%m-%d")
    except ValueError:
        raise Invalid("schedule is not a real date")
    return v


def default_subject(kind, item):
    if kind == "tiktok_post":
        return f"TikTok {item.get('account') or ''}".strip()
    return f"{item.get('channel')} post"


def placeholders(item):
    """Unfilled "[...]" placeholders in the text the owner approves (title, body)."""
    return sorted({m.group(0) for f in ("title", "body") for m in PLACEHOLDER.finditer(item.get(f) or "")})


def target_link(item):
    """Where the owner finishes a publish-by-hand item."""
    kind = kind_of(item)
    if item.get("link") and kind != "post":
        return item["link"]
    if kind == "post":
        return CHANNEL_HOME.get(item.get("channel")) or item.get("link")
    if kind == "tiktok_post":
        return CHANNEL_HOME["tiktok"]
    if kind == "dm":
        return CHANNEL_HOME.get(item.get("channel"))
    if kind == "text" and item.get("to"):
        return "sms:" + ",".join(item["to"])
    if kind == "slack":
        return "slack://open"
    return None


def path_for(item_id):
    if not ID.match(item_id or ""):
        raise Invalid("bad outbox id")
    return OUTBOX / f"{item_id}.json"


@contextlib.contextmanager
def locked(item_id):
    locks = ORG / ".cache" / "locks"
    locks.mkdir(parents=True, exist_ok=True)
    with open(locks / f"outbox__{item_id}.lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        yield


def load(item_id):
    p = path_for(item_id)
    try:
        item = json.loads(p.read_text())
    except FileNotFoundError:
        raise Invalid(f"no outbox item {item_id}")
    except (OSError, json.JSONDecodeError) as e:
        raise Invalid(f"{item_id}: unreadable ({type(e).__name__})")
    if not isinstance(item, dict) or item.get("id") != item_id:
        raise Invalid(f"{item_id}: malformed")
    return item


def save(item, new=False):
    OUTBOX.mkdir(parents=True, exist_ok=True)
    p = path_for(item["id"])
    text = json.dumps(item, indent=2, ensure_ascii=False) + "\n"
    if new:
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(text)
        return
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(text)
    os.chmod(tmp, 0o600)
    os.replace(tmp, p)


def note(item, what):
    item.setdefault("history", []).append({"at": now_iso(), "what": what})


ACTIONS_LOG = ORG / "logs" / "outbox-actions.jsonl"


def log_action(item, ok, what, link=None):
    """One row in Roo Activity for an executed click: what ran, never recipients or bodies.
    Best effort: a full disk must not turn a sent message into a reported failure."""
    row = {"at": now_iso(), "id": item.get("id"), "kind": kind_of(item), "entity": item.get("entity"),
           "status": item.get("status"), "ok": bool(ok), "what": printable(what, keep="")[:300],
           "link": link if isinstance(link, str) and URL.match(link) else None}
    try:
        ACTIONS_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(ACTIONS_LOG, "a") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError:
        pass
    return row


def all_items(status="all"):
    out = []
    if OUTBOX.is_dir():
        for p in OUTBOX.glob("*.json"):
            try:
                item = json.loads(p.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(item, dict) and (status == "all" or item.get("status") == status):
                out.append(item)
    out.sort(key=lambda i: i.get("created_at") or "", reverse=True)
    return out


def edit(item_id, fields):
    with locked(item_id):
        item = load(item_id)
        kind = kind_of(item)
        allowed = EDITABLE.get(kind)
        if not allowed:
            raise Invalid(f"{kind} items can't be edited here: ask the agent to change it in Stripe, or Skip")
        if not isinstance(fields, dict) or not fields or set(fields) - allowed:
            raise Invalid(f"edit takes only {sorted(allowed)}")
        clean = clean_fields(fields, partial=True) if kind in EMAIL_KINDS else clean_kind_fields(kind, fields, partial=True)
        if item.get("status") != "pending":
            raise Invalid(f"can't edit: it is {item.get('status')}")
        changed = [k for k, v in clean.items() if item.get(k) != v]
        if not changed:
            return {"ok": True, "changed": False, "item": item}
        # What the agent wrote, kept from the first edit on, so bin/learn.py can see what the owner changed.
        original = item.setdefault("original", {})
        for k in changed:
            original.setdefault(k, item.get(k))
        item.update(clean)
        item["edited_at"] = now_iso()
        note(item, "edited in Roo: " + ", ".join(changed))
        if kind in ("post", "tiktok_post", "youtube_upload") and "title" in clean:
            item["subject"] = clean["title"] or default_subject(kind, item)
        save(item)
    return {"ok": True, "changed": True, "item": item}


def published(item_id):
    """The owner posted an approved item by hand and says so in Roo."""
    with locked(item_id):
        item = load(item_id)
        if item.get("status") == "published":
            return {"ok": True, "changed": False, "item": item}
        if item.get("status") != "approved" or kind_of(item) not in PUBLISH_KINDS:
            raise Invalid(f"can't mark published: it is {item.get('status')}")
        item.update(status="published", published_at=now_iso())
        note(item, "marked published in Roo")
        save(item)
    return {"ok": True, "changed": True, "item": item}


def skip(item_id, why=""):
    with locked(item_id):
        item = load(item_id)
        if item.get("status") == "skipped":
            return {"ok": True, "changed": False, "item": item}
        if item.get("status") != "pending":
            raise Invalid(f"can't skip: it is {item.get('status')}")
        item.update(status="skipped", skipped_at=now_iso())
        note(item, "skipped in Roo" + (f": {printable(why, keep='')[:300]}" if why else ""))
        save(item)
    return {"ok": True, "changed": True, "item": item}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["list", "edit", "skip", "published"])
    ap.add_argument("id", nargs="?")
    ap.add_argument("--status", default="pending", choices=["all", *STATUSES])
    ap.add_argument("--note", default="")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "list":
            res = {"ok": True, "items": all_items(a.status)}
        elif a.cmd == "edit":
            try:
                fields = json.loads(sys.stdin.read())
            except json.JSONDecodeError:
                raise Invalid("edit reads a JSON object on stdin")
            res = edit(a.id, fields)
        elif a.cmd == "published":
            res = published(a.id)
        else:
            res = skip(a.id, a.note)
    except Invalid as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 2
    print(json.dumps(res, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
