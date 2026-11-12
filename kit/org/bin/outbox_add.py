#!/usr/bin/env python3
"""Agents: queue something for the owner to approve with one click in Roo.

Email (the default kind):
    python3 ~/portfolio/bin/outbox_add.py --entity acme --account acme \
        --to client@example.com [--cc a@x.com,b@y.com] --subject "Re: logo files" \
        --body-file /tmp/reply.txt --why "Client asked for the final files on Tue" \
        --created-by acme-lead [--in-reply-to <Message-ID>] [--thread <gmail thread id>]
    --account is a mailbox id from portfolio.json "email_accounts" (email_accounts.py).

Email through Resend, from any address on a verified Resend domain (no mailbox needed):
    outbox_add.py --entity acme --via resend --from notify@notify.acme.example [--from-name "Acme"] \
        [--reply-to owner@acme.example] --to client@example.com --subject "Your site is live" \
        --body-file /tmp/note.txt --why "..." --created-by acme-lead [--in-reply-to <Message-ID>]
    Verified domains are in ~/portfolio/resend_domains.json (see resend_api.py).
    The click in Roo sends it with the Keychain key resend:send. No Gmail draft is made.

Posts, texts, DMs and Slack (the owner approves, then publishes by hand; no connector yet):
    outbox_add.py --kind post  --entity E --channel instagram|linkedin|x|newsletter|site|youtube \
        --body-file post.txt [--title "Newsletter subject"] [--link https://...] [--media a.jpg,b.jpg] --why "..."
    outbox_add.py --kind text  --entity E --to +15550102030 --body "..." --why "..."
    outbox_add.py --kind dm    --entity E --channel instagram|linkedin|x|facebook|whatsapp|other \
        --to @handle --body "..." [--link https://profile-or-thread] --why "..."
    outbox_add.py --kind slack --entity E --channel "#general" --body "..." [--link https://...] --why "..."

TikTok (approve in Roo, then finish in TikTok Studio; Roo copies the caption and shows the file):
    outbox_add.py --kind tiktok_post --entity acme --tiktok-account @acme.studio \
        --media "/full/path/clip.mp4" --body-file caption.txt [--title "TikTok 1/3: title drop"] \
        [--ai-label yes] [--privacy public|friends|followers|private] [--schedule 2026-11-10T18:00] \
        [--notes "Cover: title frame at 0:04"] --why "..."

YouTube (the click uploads it through the YouTube Data API; connect once with connect_youtube.py):
    outbox_add.py --kind youtube_upload --entity acme [--yt-channel acme] \
        --media "/full/path/video.mp4" --title "..." --body-file description.txt \
        [--tags "a,b,c"] [--privacy private|unlisted|public] [--publish-at 2026-11-10T09:00] \
        [--category 10] [--made-for-kids no] [--ai-altered no] [--notes "Pin a comment ..."] --why "..."
    privacy defaults to private. --publish-at keeps it private until then and YouTube makes it
    public at that time. --yt-channel defaults to the entity.

Charge a customer's saved card (the click charges it off-session; amount in minor units):
    outbox_add.py --kind stripe_charge --entity acme --customer cus_... --amount 25000 \
        --description "November retainer" [--currency usd] [--payment-method pm_...] \
        [--statement-descriptor-suffix "RETAINER"] --why "..." [--created-by acme-lead]
    Reads the customer and their cards with the agent key (stripe_agent.py queue_charge) and
    shows the card it will use: --payment-method, else their default card, else their only card.

Other money and client billing (stripe_send_invoice, stripe_send_quote, stripe_refund,
stripe_subscription) are queued by ~/portfolio/bin/stripe_agent.py, which reads Stripe to
fill in what the owner approves. This script refuses them on the command line.

What it does:
  1. Validates everything and writes ~/portfolio/outbox/<id>.json with status "pending".
  2. Saves the same message as a draft in that mailbox (IMAP, email_accounts.py), so it
     exists in the mail app either way. Best effort: without a stored password it is skipped
     and the item says why (draft {saved: false, error}).
  3. For replies, looks up the original's References (read-only) so the reply threads.
Prints one JSON line: {"ok", "id", "draft_saved", ...}. Non-email kinds skip steps 2-3.

It never sends. Sending is the owner's click in Roo (outbox_send.py, guarded by
sendguard.py). If a pending item already goes to the same people with the same subject
from the same account, it is returned instead of a duplicate (and no second draft).

--no-draft skips step 2 (tests). PORTFOLIO_ROOT overrides the org folder (tests only).
"""
import argparse, datetime, json, pathlib, re, secrets, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import email_accounts, outbox  # noqa: E402
from outbox import Invalid  # noqa: E402



def registry_entities():
    reg = json.loads((outbox.ORG / "portfolio.json").read_text())
    return {e.get("id") for e in reg.get("entities", [])}


def new_id(entity, subject):
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    words = re.sub(r"[^a-z0-9]+", "-", subject.lower()).strip("-")[:40].rstrip("-")
    return f"{stamp}-{entity}-{words or 'message'}-{secrets.token_hex(2)}"[:100].rstrip("-")


def find_references(account, mid):
    """References chain for a reply (read-only; email_accounts.py). Falls back to [mid]."""
    return email_accounts.find_references(account, mid)


def save_draft(item):
    """Write the draft into the mailbox. Returns (saved, error). Never raises."""
    return email_accounts.save_draft(item)


def _why(why, created_by):
    why = outbox.printable(why, keep="").strip()
    if not why:
        raise Invalid("--why is required: tell the owner why this should go out")
    if len(why) > outbox.WHY_MAX:
        raise Invalid("--why is too long")
    return why, outbox.printable(created_by, keep="").strip()[:80] or "agent"


def _int(v, name, lo, hi, required=True):
    if v is None and not required:
        return None
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise Invalid(f"{name} must be a whole number between {lo} and {hi}")
    return v


def _stripe_id(v, prefix, name):
    if not (isinstance(v, str) and outbox.STRIPE_ID.match(v) and v.startswith(prefix)):
        raise Invalid(f"{name} must be a {prefix} id")
    return v


def _currency(f):
    cur = (f.get("currency") or "").lower()
    if not re.fullmatch(r"[a-z]{3}", cur):
        raise Invalid("currency must be a 3-letter code")
    return cur


def clean_charge(f):
    """stripe_charge: a saved card charged off-session. stripe_agent.queue_charge fills the
    customer label and the card from Stripe reads."""
    out = {"stripe_id": None, "customer_id": _stripe_id(f.get("customer_id"), "cus_", "customer_id"),
           "customer": outbox.printable(f.get("customer") or "", keep="").strip()[:120] or None,
           "payment_method": _stripe_id(f.get("payment_method"), "pm_", "payment_method"),
           "card": outbox.printable(f.get("card") or "", keep="").strip()[:80] or None,
           "amount": _int(f.get("amount"), "amount (minor units)", 50, 10**8),
           "currency": _currency(f)}
    if not out["card"]:
        raise Invalid("card is the brand and last 4 the owner sees")
    out["description"] = outbox.printable(f.get("description") or "", keep="").strip()[:500]
    if not out["description"]:
        raise Invalid("needs a description (it shows on the customer's receipt)")
    sfx = f.get("statement_descriptor_suffix")
    if sfx is not None and not (isinstance(sfx, str) and re.fullmatch(r"[A-Za-z0-9 .,-]{1,22}", sfx)
                                and re.search(r"[A-Za-z]", sfx)):
        raise Invalid("statement_descriptor_suffix is up to 22 letters, digits, spaces or .,- with at least one letter")
    out["statement_descriptor_suffix"] = sfx.strip() if sfx else None
    out["subject"] = outbox.printable(f.get("subject") or "", keep="").strip()[:outbox.SUBJECT_MAX]
    out["body"] = outbox.printable(f.get("body") or "").rstrip()[:outbox.BODY_MAX]
    if not out["subject"]:
        raise Invalid("needs a subject (one line the owner reads first)")
    out["link"] = None
    return out


def clean_stripe(kind, f):
    """The fields a money item carries. stripe_agent.py fills them from Stripe reads."""
    if kind == "stripe_charge":
        return clean_charge(f)
    sid = f.get("stripe_id")
    prefixes = {"stripe_send_invoice": ("in_",), "stripe_send_quote": ("qt_",),
                "stripe_refund": ("ch_", "pi_"), "stripe_subscription": ("sub_",)}[kind]
    out = {}
    if kind == "stripe_subscription":
        out["action"] = f.get("action")
        if out["action"] not in ("create", "update"):
            raise Invalid("action must be create or update")
        if out["action"] == "create":
            sid = None
    if sid is not None or kind != "stripe_subscription":
        if not (isinstance(sid, str) and outbox.STRIPE_ID.match(sid) and sid.startswith(prefixes)):
            raise Invalid(f"stripe_id must start with {' or '.join(prefixes)}")
    elif kind == "stripe_subscription" and out["action"] == "update":
        raise Invalid("an update needs the subscription id")
    out["stripe_id"] = sid
    if kind != "stripe_refund" or f.get("customer_id"):
        cid = f.get("customer_id")
        if not (isinstance(cid, str) and outbox.STRIPE_ID.match(cid) and cid.startswith("cus_")):
            raise Invalid("customer_id must be a cus_ id")
        out["customer_id"] = cid
    out["customer"] = outbox.printable(f.get("customer") or "", keep="").strip()[:120] or None
    out["amount"] = _int(f.get("amount"), "amount (minor units)", 1, 10**10)
    cur = (f.get("currency") or "").lower()
    if not re.fullmatch(r"[a-z]{3}", cur):
        raise Invalid("currency must be a 3-letter code")
    out["currency"] = cur
    if kind == "stripe_send_invoice":
        due = f.get("due_date")
        if due is not None and not (isinstance(due, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", due)):
            raise Invalid("due_date must be YYYY-MM-DD")
        out["due_date"] = due
    if kind == "stripe_refund":
        reason = f.get("reason")
        if reason not in (None, "duplicate", "fraudulent", "requested_by_customer"):
            raise Invalid("reason must be duplicate, fraudulent or requested_by_customer")
        out["reason"] = reason
    if kind == "stripe_subscription":
        items = f.get("items") or []
        if not items or len(items) > 20 or not all(isinstance(i, str) and re.fullmatch(r"price_[A-Za-z0-9]{6,80}:[0-9]{1,6}", i) for i in items):
            raise Invalid("items are price_...:quantity")
        out["items"] = items
        out["interval"] = f.get("interval") if f.get("interval") in ("day", "week", "month", "year") else None
        out["days_until_due"] = _int(f.get("days_until_due"), "days_until_due", 1, 365, required=False)
    out["subject"] = outbox.printable(f.get("subject") or "", keep="").strip()[:outbox.SUBJECT_MAX]
    out["body"] = outbox.printable(f.get("body") or "").rstrip()[:outbox.BODY_MAX]
    if not out["subject"]:
        raise Invalid("needs a subject (one line the owner reads first)")
    out["link"] = f.get("link") if isinstance(f.get("link"), str) and outbox.URL.match(f["link"]) else None
    return out


def _dedupe_key(kind, item):
    if kind in ("tiktok_post", "youtube_upload"):
        return (tuple(item.get("media") or ()), item.get("title"), item.get("body"))
    if kind == "stripe_charge":
        return (item.get("customer_id"), item.get("amount"), item.get("currency"), item.get("description"))
    if kind in outbox.STRIPE_KINDS:
        return (item.get("stripe_id"), item.get("action"), item.get("customer_id"), tuple(item.get("items") or ()))
    return (item.get("channel"), tuple(item.get("to") or ()), item.get("body"))


def add_kind(kind, entity, why, created_by, fields):
    """Queue a non-email item. `fields` are the kind's fields (see outbox.py)."""
    if kind not in outbox.KINDS or kind in outbox.EMAIL_KINDS:
        raise Invalid(f"kind must be one of {list(outbox.KINDS)}")
    if entity not in registry_entities():
        raise Invalid(f"unknown entity: {entity}")
    why, created_by = _why(why, created_by)
    if kind in outbox.STRIPE_KINDS:
        clean = clean_stripe(kind, fields)
        to = []
    else:
        clean = outbox.clean_kind_fields(kind, fields)
        to = clean.get("to", [])
        videos = clean.get("media") or [] if kind in ("tiktok_post", "youtube_upload") else []
        for m in videos:
            if m.startswith("/") and not pathlib.Path(m).is_file():
                raise Invalid(f"media: no such file: {m}")
        clean.setdefault("subject", {
            "post": clean.get("title") or f"{clean.get('channel')} post",
            "tiktok_post": clean.get("title") or outbox.default_subject("tiktok_post", clean),
            "youtube_upload": clean.get("title"),
            "text": "Text to " + ", ".join(to), "dm": f"DM on {clean.get('channel')} to " + ", ".join(to),
            "slack": f"Slack {clean.get('channel')}"}[kind])
    for other in outbox.all_items("pending"):
        if outbox.kind_of(other) == kind and other.get("entity") == entity \
                and _dedupe_key(kind, other) == _dedupe_key(kind, {**clean, "to": to}):
            return {"ok": True, "id": other["id"], "changed": False,
                    "reason": "already pending with the same content"}
    acct = clean.pop("account", None) if kind == "tiktok_post" else None
    item = {"id": new_id(entity, clean["subject"]), "kind": kind, "entity": entity, "account": acct or entity,
            "to": to, "cc": [], **clean, "why": why, "created_by": created_by, "created_at": outbox.now_iso(),
            "status": "pending", "sent_at": None, "skipped_at": None, "edited_at": None,
            "approved_at": None, "published_at": None, "result": None, "error": None, "history": []}
    sendguard_check_hashable(item)
    outbox.note(item, f"queued by {created_by}")
    outbox.save(item, new=True)
    return {"ok": True, "id": item["id"], "kind": kind, "changed": True, "path": str(outbox.path_for(item["id"]))}


def sendguard_check_hashable(item):
    import sendguard
    try:
        sendguard.content_hash(item)
    except ValueError as e:
        raise Invalid(f"can't queue: {e}")


def add(entity, account, to, cc, subject, body, why, created_by, in_reply_to=None,
        thread=None, references=None, draft=True):
    if entity not in registry_entities():
        raise Invalid(f"unknown entity: {entity}")
    known = email_accounts.ids()
    if account not in known:
        raise Invalid(f"account must be one of {known}" if known else
                      "no email accounts yet: add one to \"email_accounts\" in portfolio.json (see email_accounts.py)")
    fields = outbox.clean_fields({"to": to, "cc": cc, "subject": subject, "body": body})
    why, created_by = _why(why, created_by)
    irt = outbox.msgid(in_reply_to)
    thread = re.sub(r"[^0-9a-zA-Z]", "", thread or "")[:40] or None

    for other in outbox.all_items("pending"):
        if outbox.kind_of(other) == "email" and \
                (other.get("account"), other.get("to"), other.get("subject")) == (account, fields["to"], fields["subject"]):
            return {"ok": True, "id": other["id"], "changed": False,
                    "reason": "already pending with the same recipients and subject",
                    "draft_saved": (other.get("draft") or {}).get("saved")}

    if irt and references is None:
        references = find_references(account, irt) if draft else [irt]
    refs = [r for r in (outbox.msgid(r) for r in (references or [])) if r]
    if irt and irt not in refs:
        refs.append(irt)

    item = {
        "id": new_id(entity, fields["subject"]), "kind": "email",
        "entity": entity, "account": account, **fields,
        "in_reply_to": irt, "references": refs, "thread": thread,
        "why": why, "created_by": created_by, "created_at": outbox.now_iso(),
        "status": "pending", "draft": {"saved": False, "error": None},
        "sent_at": None, "sent_message_id": None, "skipped_at": None, "edited_at": None,
        "error": None, "history": [],
    }
    outbox.note(item, f"queued by {created_by}")
    outbox.save(item, new=True)

    if draft:
        saved, err = save_draft(item)
        with outbox.locked(item["id"]):
            cur = outbox.load(item["id"])
            cur["draft"] = {"saved": saved, "error": err}
            outbox.note(cur, "draft saved in the mailbox" if saved else f"mailbox draft not saved: {err}")
            outbox.save(cur)
        item = cur
    return {"ok": True, "id": item["id"], "changed": True, "draft_saved": item["draft"]["saved"],
            "draft_error": item["draft"]["error"], "path": str(outbox.path_for(item["id"]))}


def add_resend(entity, sender, to, cc, subject, body, why, created_by, from_name=None,
               reply_to=None, in_reply_to=None, references=None):
    """Queue an email the click sends through Resend from `sender` (a verified domain)."""
    import resend_api
    if entity not in registry_entities():
        raise Invalid(f"unknown entity: {entity}")
    found = outbox.addresses(sender)
    if len(found) != 1:
        raise Invalid("--from is one address, e.g. notify@notify.acme.example")
    sender = found[0]
    allowed = resend_api.domains()
    if not allowed:
        raise Invalid("no verified Resend domains recorded: list them in resend_domains.json (see resend_api.py)")
    if not resend_api.sender_ok(sender, allowed):
        raise Invalid(f"{sender} is not on a verified Resend domain (verified: {', '.join(allowed)})")
    fields = outbox.clean_fields({"to": to, "cc": cc, "subject": subject, "body": body})
    why, created_by = _why(why, created_by)
    from_name = outbox.printable(from_name or "", keep="").strip()[:80] or None
    rt = outbox.addresses(reply_to)
    if len(rt) > 1:
        raise Invalid("--reply-to is one address")
    irt = outbox.msgid(in_reply_to)
    refs = [r for r in (outbox.msgid(r) for r in (references or [])) if r]
    if irt and irt not in refs:
        refs.append(irt)

    for other in outbox.all_items("pending"):
        if outbox.kind_of(other) == "resend_email" and \
                (other.get("from"), other.get("to"), other.get("subject")) == (sender, fields["to"], fields["subject"]):
            return {"ok": True, "id": other["id"], "changed": False,
                    "reason": "already pending with the same sender, recipients and subject"}

    item = {
        "id": new_id(entity, fields["subject"]), "kind": "resend_email", "entity": entity, "account": "resend",
        "from": sender, "from_name": from_name, "reply_to": rt[0] if rt else None, **fields,
        "in_reply_to": irt, "references": refs, "why": why, "created_by": created_by,
        "created_at": outbox.now_iso(), "status": "pending", "sent_at": None, "resend_id": None,
        "skipped_at": None, "edited_at": None, "error": None, "history": [],
    }
    sendguard_check_hashable(item)
    outbox.note(item, f"queued by {created_by} (Resend, from {sender})")
    outbox.save(item, new=True)
    return {"ok": True, "id": item["id"], "kind": "resend_email", "changed": True, "path": str(outbox.path_for(item["id"]))}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kind", default="email", choices=["email", *outbox.PUBLISH_KINDS, *outbox.UPLOAD_KINDS, "stripe_charge"])
    ap.add_argument("--entity", required=True)
    ap.add_argument("--account", help="email: the mailbox it goes from (an id in portfolio.json email_accounts)")
    ap.add_argument("--via", default="mailbox", choices=["mailbox", "gmail", "resend"], help="email: the mailbox (SMTP) or Resend")
    ap.add_argument("--from", dest="sender", help="--via resend: the sender, on a verified Resend domain")
    ap.add_argument("--from-name", help="--via resend: display name")
    ap.add_argument("--reply-to", help="--via resend: where replies go")
    ap.add_argument("--to", default="", help="comma-separated: emails, phone numbers or @handles")
    ap.add_argument("--cc", default="")
    ap.add_argument("--subject", help="email only")
    ap.add_argument("--channel", help="post, dm, slack")
    ap.add_argument("--title", help="post: newsletter subject or headline")
    ap.add_argument("--link", help="post/dm/slack: https link")
    ap.add_argument("--media", default="", help="post: comma-separated image/video paths or URLs")
    ap.add_argument("--tiktok-account", help="tiktok_post: the @handle it posts as")
    ap.add_argument("--ai-label", default="no", help="tiktok_post: yes turns on TikTok's AI-generated label")
    ap.add_argument("--privacy", help="tiktok_post: public|friends|followers|private; youtube_upload: private|unlisted|public")
    ap.add_argument("--schedule", help="tiktok_post: post on YYYY-MM-DD[THH:MM]")
    ap.add_argument("--yt-channel", help="youtube_upload: the connected channel (default: the entity)")
    ap.add_argument("--tags", default="", help="youtube_upload: comma-separated")
    ap.add_argument("--publish-at", help="youtube_upload: YYYY-MM-DDTHH:MM local; private until then")
    ap.add_argument("--category", default="22", help="youtube_upload: category id (22 People & Blogs, 10 Music)")
    ap.add_argument("--made-for-kids", default="no")
    ap.add_argument("--ai-altered", default="no", help="youtube_upload: realistic altered or synthetic content")
    ap.add_argument("--notes", help="tiktok_post/youtube_upload: what to do by hand after (cover, pinned comment)")
    ap.add_argument("--customer", help="stripe_charge: cus_...")
    ap.add_argument("--amount", type=int, help="stripe_charge: minor units (2500 = $25.00)")
    ap.add_argument("--currency", default="usd", help="stripe_charge")
    ap.add_argument("--description", help="stripe_charge: shows on the receipt")
    ap.add_argument("--payment-method", help="stripe_charge: pm_... (default: their default or only card)")
    ap.add_argument("--statement-descriptor-suffix", help="stripe_charge: on the card statement")
    ap.add_argument("--body")
    ap.add_argument("--body-file", help="'-' for stdin")
    ap.add_argument("--why", required=True)
    ap.add_argument("--created-by", default="agent")
    ap.add_argument("--in-reply-to")
    ap.add_argument("--thread")
    ap.add_argument("--no-draft", action="store_true")
    a = ap.parse_args(argv)
    try:
        if a.kind == "stripe_charge":
            import stripe_agent
            if not (a.customer and a.amount and a.description):
                raise Invalid("stripe_charge needs --customer, --amount (minor units) and --description")
            res = stripe_agent.Agent(a.entity).queue_charge(
                a.customer, a.amount, a.currency, a.description, a.payment_method,
                a.statement_descriptor_suffix, a.why, a.created_by)
            print(json.dumps(res, ensure_ascii=False))
            return 0
        if a.body_file:
            body = sys.stdin.read() if a.body_file == "-" else pathlib.Path(a.body_file).read_text()
        elif a.body:
            body = a.body
        else:
            raise Invalid("need --body or --body-file")
        if a.kind == "email" and a.via == "resend":
            if not a.sender or not a.to or not a.subject:
                raise Invalid("--via resend needs --from, --to and --subject")
            res = add_resend(a.entity, a.sender, a.to, a.cc, a.subject, body, a.why, a.created_by,
                             from_name=a.from_name, reply_to=a.reply_to, in_reply_to=a.in_reply_to)
        elif a.kind == "email":
            if not a.account or not a.to or not a.subject:
                raise Invalid("email needs --account, --to and --subject")
            res = add(a.entity, a.account, a.to, a.cc, a.subject, body, a.why, a.created_by,
                      in_reply_to=a.in_reply_to, thread=a.thread, draft=not a.no_draft)
        elif a.kind == "tiktok_post":
            fields = {"account": a.tiktok_account, "title": a.title, "body": body, "media": a.media,
                      "ai_label": a.ai_label, "privacy": a.privacy, "schedule": a.schedule, "notes": a.notes}
            res = add_kind(a.kind, a.entity, a.why, a.created_by, fields)
        elif a.kind == "youtube_upload":
            fields = {"channel": a.yt_channel or a.entity, "title": a.title, "body": body, "tags": a.tags,
                      "privacy": a.privacy, "publish_at": a.publish_at, "category_id": a.category,
                      "made_for_kids": a.made_for_kids, "ai_altered": a.ai_altered, "media": a.media,
                      "notes": a.notes}
            res = add_kind(a.kind, a.entity, a.why, a.created_by, fields)
        else:
            fields = {"channel": a.channel, "title": a.title, "link": a.link, "body": body,
                      "to": a.to, "media": [m for m in a.media.split(",") if m.strip()]}
            res = add_kind(a.kind, a.entity, a.why, a.created_by, fields)
    except (Invalid, OSError) as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 2
    except Exception as e:      # stripe_agent: Usage, NotAllowed, StripeError
        if type(e).__name__ not in ("Usage", "NotAllowed", "StripeError"):
            raise
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        return 2
    print(json.dumps(res, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
