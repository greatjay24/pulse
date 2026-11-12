#!/usr/bin/env python3
"""Carry out one Outbox item. Roo runs this after the owner clicks Send / Publish /
Approve. Agents never do (their deny list blocks it, and it refuses without the click).

    outbox_send.py <id> --dry-run          say what the click would do; do nothing
    outbox_send.py <id>  < approval.json   Roo only: do it, with the signed approval on stdin

By kind, after the approval checks below:
  email                SMTP send, as described next.
  resend_email         sent through the Resend API from the item's verified sender, with the
                       Keychain key resend:send (resend_api.approved_send re-checks the approval).
                       -> "sent" with resend_id, or "failed".
  youtube_upload       checks what would stop it (video file, YouTube connection, unfilled
                       "[...]" placeholders, a schedule in the past) before spending the
                       approval; then -> "sending" and a background step (this script with
                       --upload, the approval on its stdin) uploads through the YouTube Data API
                       (youtube_api.approved_upload re-checks the approval). -> "published"
                       with the video link, or "failed". Activity gets the result.
  tiktok_post          like a post: "approved" with TikTok Studio's upload page; finished by hand.
  post|text|dm|slack   Marked "approved" with the place to post; the owner pastes it there (Roo
                       copies it) and marks it published. A post whose channel has a working hook
                       in publish_hooks.py (YouTube, Instagram: stubs today) is published through
                       the API instead -> "published" with the link, or "failed".
  stripe_send_invoice  re-reads the draft invoice; refuses if its customer, total, currency or
                       collection method changed since it was queued; finalizes it and has
                       Stripe email it. -> "sent", with the hosted invoice link.
  stripe_send_quote    same checks; finalizes the quote. Stripe's API has no "email the quote",
                       so it lands "approved" with the Dashboard link to send it from.
  stripe_refund        checks the charge can still refund that much; creates the refund.
  stripe_subscription  checks the prices still add up to the approved amount; creates the
                       subscription (invoices are emailed, days_until_due) or updates its items.
  stripe_charge        re-reads the customer and their cards; refuses unless the approved card is
                       still saved on them; creates a PaymentIntent with confirm + off_session.
                       A decline or a bank asking for authentication fails the item with the
                       reason (no retry; nothing was charged).
  Stripe calls use the entity's action key (Keychain stripe-action:<entity>) through
  stripe_api.approved_call, which checks the signed approval again, and an Idempotency-Key
  per step, so nothing can run twice.
Every executed click (done or failed) adds a row to logs/outbox-actions.jsonl for Roo Activity.

Email:
Without --dry-run it refuses unless stdin carries an approval Roo signed for this click
and this exact content (sendguard.py explains the mechanism). Then:
  1. burns the approval's nonce and marks the item "sending" (so a crash can't resend),
  2. sends over SMTP from the item's account (email_accounts.py: the app password in the
     Keychain, or an optional tracker's XOAUTH2 token; never printed),
  3. marks it "sent" with sent_at and the Message-ID, or "failed" with the reason.
Replies carry In-Reply-To and References so they thread. Gmail files the sent copy.
The Gmail draft outbox_add.py made is left alone (never deleted).
Prints one JSON line. PORTFOLIO_ROOT overrides the org folder (tests only).
"""
import argparse, json, pathlib, smtplib, socket, subprocess, sys
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import email_accounts, outbox, publish_hooks, sendguard  # noqa: E402
from outbox import Invalid  # noqa: E402
from sendguard import Refused  # noqa: E402

SMTP_FOR = email_accounts.SMTP_FOR


def account(aid):
    """The mailbox (portfolio.json "email_accounts", see email_accounts.py)."""
    try:
        return email_accounts.account(aid)
    except email_accounts.Unknown as e:
        raise Invalid(str(e))


def build(item, acct):
    return email_accounts.message(item, acct)


def smtp_send(acct, msg, rcpts):
    host = acct.get("smtp_host") and (acct["smtp_host"], int(acct.get("smtp_port") or 465)) \
        or SMTP_FOR.get(acct.get("imap_host") or acct.get("host"))
    if not host:
        raise Invalid(f"{acct['id']}: no SMTP host known for {acct.get('host')}")
    with smtplib.SMTP_SSL(host[0], host[1], timeout=45) as s:
        if acct.get("auth") == "oauth":
            oauth_google = email_accounts._tracker_module("oauth_google")    # optional tracker only
            tok, err = oauth_google.access_token_for(acct["id"], acct.get("oauth_client", "default"))
            if err:
                raise Invalid(f"{acct['id']}: {err}")
            # auth() doesn't say hello first (login() does) and returns a refusal instead of
            # raising, so without these Gmail drops the sign-in and the send fails with 530.
            s.ehlo()
            code, resp = s.auth("XOAUTH2", lambda challenge=None: oauth_google.xoauth2_string(acct["address"], tok),
                                initial_response_ok=True)
            if code != 235:
                raise smtplib.SMTPAuthenticationError(code, resp)
        else:
            try:
                pw = email_accounts.password(acct)
            except email_accounts.Unknown as e:
                raise Invalid(str(e))
            s.login(acct["address"], pw)
        refused = s.send_message(msg, from_addr=acct["address"], to_addrs=rcpts)
    return refused


def headers(msg):
    return {k: str(v) for k, v in msg.items()}


def stripe_dash(obj, kind):
    test = "" if obj.get("livemode", True) else "test/"
    return f"https://dashboard.stripe.com/{test}{kind}/{obj['id']}"


class Changed(Invalid):
    """Stripe no longer matches what the owner approved. Nothing was done."""


def _expect(what, got, want):
    if got != want:
        raise Changed(f"{what} is {got!r} in Stripe now, not {want!r} as approved; nothing was done")


def stripe_invoice(item, appr, call):
    iid = item["stripe_id"]
    inv = call("GET", f"/invoices/{iid}")
    _expect("the invoice status", inv.get("status"), "draft")
    _expect("the customer", inv.get("customer"), item["customer_id"])
    _expect("the amount due", inv.get("amount_due"), item["amount"])
    _expect("the currency", inv.get("currency"), item["currency"])
    _expect("collection", inv.get("collection_method"), "send_invoice")
    call("POST", f"/invoices/{iid}/finalize", {"auto_advance": False}, idem=f"{item['id']}-finalize")
    sent = call("POST", f"/invoices/{iid}/send", None, idem=f"{item['id']}-send")
    return "sent", {"status": sent.get("status"), "number": sent.get("number"),
                    "hosted_invoice_url": sent.get("hosted_invoice_url")}, \
        sent.get("hosted_invoice_url") or stripe_dash(sent, "invoices"), None


def stripe_quote(item, appr, call):
    qid = item["stripe_id"]
    q = call("GET", f"/quotes/{qid}")
    _expect("the quote status", q.get("status"), "draft")
    _expect("the customer", q.get("customer"), item["customer_id"])
    _expect("the total", q.get("amount_total"), item["amount"])
    _expect("the currency", q.get("currency"), item["currency"])
    fin = call("POST", f"/quotes/{qid}/finalize", None, idem=f"{item['id']}-finalize")
    return "approved", {"status": fin.get("status"), "number": fin.get("number")}, stripe_dash(fin, "quotes"), \
        "Finalized. Stripe can't email a quote through its API: open it in Stripe and click Send quote, or share its PDF."


def stripe_refund(item, appr, call):
    sid = item["stripe_id"]
    if sid.startswith("ch_"):
        ch = call("GET", f"/charges/{sid}")
        refundable = (ch.get("amount") or 0) - (ch.get("amount_refunded") or 0)
        cur, target = ch.get("currency"), {"charge": sid}
    else:
        pi = call("GET", f"/payment_intents/{sid}")
        refundable = pi.get("amount_received") or 0
        cur, target = pi.get("currency"), {"payment_intent": sid}
    _expect("the currency", cur, item["currency"])
    if refundable < item["amount"]:
        raise Changed(f"only {refundable} is left to refund on {sid}; nothing was done")
    r = call("POST", "/refunds", {**target, "amount": item["amount"], "reason": item.get("reason"),
                                  "metadata": {"outbox_id": item["id"]}}, idem=f"{item['id']}-refund")
    return "sent", {"refund": r.get("id"), "status": r.get("status")}, stripe_dash({"id": sid, "livemode": r.get("livemode", True)}, "payments"), None


def _sub_items(item):
    return [(i.split(":")[0], int(i.split(":")[1])) for i in item["items"]]


def stripe_subscription(item, appr, call):
    wanted = _sub_items(item)
    total, intervals = 0, set()
    for price, qty in wanted:
        pr = call("GET", f"/prices/{price}")
        _expect(f"{price} currency", pr.get("currency"), item["currency"])
        if not pr.get("recurring") or pr.get("unit_amount") is None:
            raise Changed(f"{price} is not a fixed recurring price; nothing was done")
        total += pr["unit_amount"] * qty
        intervals.add(pr["recurring"].get("interval"))
    _expect("the total per interval", total, item["amount"])
    if len(intervals) != 1 or (item.get("interval") and intervals != {item["interval"]}):
        raise Changed("the prices' billing intervals don't match what was approved; nothing was done")
    meta = {"outbox_id": item["id"]}
    if item["action"] == "create":
        sub = call("POST", "/subscriptions", {
            "customer": item["customer_id"],
            "items": [{"price": p, "quantity": q} for p, q in wanted],
            "collection_method": "send_invoice", "days_until_due": item.get("days_until_due") or 30,
            "metadata": meta}, idem=f"{item['id']}-create")
    else:
        cur = call("GET", f"/subscriptions/{item['stripe_id']}")
        _expect("the customer", cur.get("customer"), item["customer_id"])
        have = {si["price"]["id"]: si["id"] for si in (cur.get("items") or {}).get("data", [])}
        lines = [{"id": have[p], "quantity": q} if p in have else {"price": p, "quantity": q} for p, q in wanted]
        lines += [{"id": si, "deleted": True} for p, si in have.items() if p not in dict(wanted)]
        sub = call("POST", f"/subscriptions/{item['stripe_id']}", {"items": lines, "metadata": meta},
                   idem=f"{item['id']}-update")
    return "sent", {"subscription": sub.get("id"), "status": sub.get("status")}, stripe_dash(sub, "subscriptions"), None


class Declined(Invalid):
    """Stripe declined the charge or wants the customer present. Nothing was charged."""


def _declined(e, pi=None):
    code = (pi or {}).get("status") if pi else (e.decline_code or e.code)
    if code in ("authentication_required", "requires_action"):
        return Declined("the bank wants the customer to authenticate (3D Secure), which can't happen off-session. "
                        "Nothing was charged: send an invoice or a payment link instead.")
    why = f" ({str(code).replace('_', ' ')})" if code else ""
    return Declined(f"the card was declined{why}. Nothing was charged: ask the customer to update their card, "
                    "or send an invoice instead.")


def stripe_charge(item, appr, call):
    import stripe_api
    cid = item["customer_id"]
    cus = call("GET", f"/customers/{cid}")
    cards = call("GET", f"/customers/{cid}/payment_methods", {"type": "card", "limit": 100}).get("data", [])
    try:
        card = stripe_api.pick_card(cus, cards, item["payment_method"])
    except stripe_api.NotAllowed as e:
        raise Changed(f"{e}; nothing was done")
    params = {"amount": item["amount"], "currency": item["currency"], "customer": cid,
              "payment_method": card["id"], "confirm": True, "off_session": True,
              "description": item["description"], "statement_descriptor_suffix": item.get("statement_descriptor_suffix"),
              "metadata": {"outbox_id": item["id"]}}
    try:
        pi = call("POST", "/payment_intents", params, idem=f"{item['id']}-charge")
    except stripe_api.StripeError as e:
        if e.status == 402 or e.code in ("card_declined", "authentication_required", "expired_card",
                                         "incorrect_cvc", "processing_error", "insufficient_funds"):
            raise _declined(e)
        raise
    if pi.get("status") not in ("succeeded", "processing"):
        raise _declined(None, pi)
    result = {"payment_intent": pi.get("id"), "status": pi.get("status"), "charge": pi.get("latest_charge"),
              "card": stripe_api.card_label(card)}
    step = "Stripe is still processing it; it lands in Payments when it clears." if pi["status"] == "processing" else None
    return "sent", result, stripe_dash(pi, "payments"), step


STRIPE_RUN = {"stripe_send_invoice": stripe_invoice, "stripe_send_quote": stripe_quote,
              "stripe_refund": stripe_refund, "stripe_subscription": stripe_subscription,
              "stripe_charge": stripe_charge}


def _redact(reason):
    try:
        from live import redact
        return redact(reason)
    except Exception:
        return reason


def act(item_id, approval_text, dry_run=False):
    """Every non-email kind."""
    item = outbox.load(item_id)
    kind = outbox.kind_of(item)
    if kind not in outbox.KINDS:
        raise Invalid(f"unknown kind: {kind}")
    if dry_run:
        does = (f"publish it through the {item.get('channel')} API" if publish_hooks.hook_for(item)
                else "mark it approved; you publish it by hand" if kind in outbox.PUBLISH_KINDS
                else f"run {kind} in Stripe with the {item.get('entity')} action key")
        return {"ok": True, "dry_run": True, "id": item_id, "kind": kind, "status": item.get("status"),
                "would": does, "content": sendguard.content_hash(item)}

    with outbox.locked(item_id):
        item = outbox.load(item_id)
        if item.get("status") != "pending":
            raise Invalid(f"not doing it: it is {item.get('status')}")
        payload = sendguard.check(approval_text, item)
        sendguard.burn(payload)
        hook = publish_hooks.hook_for(item) if kind in outbox.PUBLISH_KINDS else None
        if kind in outbox.PUBLISH_KINDS and hook is None:
            item.update(status="approved", approved_at=outbox.now_iso(), link=outbox.target_link(item) or item.get("link"),
                        next_step=_by_hand_step(item), error=None)
            outbox.note(item, f"approved in Roo (key {payload['key']}); publish manually")
            outbox.save(item)
            outbox.log_action(item, True, f"{_label(item)}: approved; publish by hand")
            return {"ok": True, "id": item_id, "kind": kind, "status": "approved", "link": item["link"]}
        item.update(status="sending", error=None)
        outbox.note(item, f"Approve clicked in Roo (key {payload['key']})")
        outbox.save(item)

    if hook is not None:
        return publish(item_id, hook)

    import stripe_api
    approved = {k: v for k, v in item.items() if k not in ("status", "history", "error")}

    def call(method, path, params=None, idem=None):
        return stripe_api.approved_call(approved, approval_text, method, path, params, idem)

    try:
        status, result, link, next_step = STRIPE_RUN[kind](item, approval_text, call)
    except (stripe_api.StripeError, stripe_api.NotAllowed, Refused, Invalid, OSError) as e:
        reason = _redact(f"{type(e).__name__}: {str(e)[:240]}")
        with outbox.locked(item_id):
            cur = outbox.load(item_id)
            cur.update(status="failed", error=reason)
            outbox.note(cur, f"failed: {reason}")
            outbox.save(cur)
        outbox.log_action(cur, False, f"{_label(cur)} failed: {reason}")
        return {"ok": False, "id": item_id, "error": f"not done: {reason}"}

    with outbox.locked(item_id):
        cur = outbox.load(item_id)
        cur.update(status=status, result=result, link=link, next_step=next_step, error=None,
                   **({"sent_at": outbox.now_iso()} if status == "sent" else {"approved_at": outbox.now_iso()}))
        outbox.note(cur, f"{kind}: {status}" + (f" ({next_step})" if next_step else ""))
        outbox.save(cur)
    outbox.log_action(cur, True, f"{_label(cur)}: {status} in Stripe", link)
    return {"ok": True, "id": item_id, "kind": kind, "status": status, "result": result, "link": link,
            "next_step": next_step}


def publish(item_id, hook):
    """A post whose channel has a publishing hook (publish_hooks.py): publish it through the API."""
    item = outbox.load(item_id)
    try:
        res = hook(item) or {}
        status, link, err = "published", res.get("link") or item.get("link"), None
    except Exception as e:
        status, link, err = "failed", item.get("link"), _redact(f"{type(e).__name__}: {str(e)[:240]}")
    with outbox.locked(item_id):
        cur = outbox.load(item_id)
        cur.update(status=status, link=link, error=err,
                   **({"published_at": outbox.now_iso()} if status == "published" else {}))
        outbox.note(cur, f"published through the {cur.get('channel')} API" if status == "published" else f"publish failed: {err}")
        outbox.save(cur)
    outbox.log_action(cur, status == "published", f"{_label(cur)}: " + ("published" if status == "published" else f"publish failed: {err}"), link)
    return {"ok": status == "published", "id": item_id, "kind": "post", "status": status, "link": link,
            **({"error": err} if err else {})}


def _by_hand_step(item):
    if outbox.kind_of(item) != "tiktok_post":
        return "Approved. Paste it where it goes, then mark it published."
    steps = [f"Approved. In TikTok Studio as {item.get('account')}: upload the video, paste the caption"]
    if item.get("ai_label") == "yes":
        steps.append("turn on \"AI-generated content\"")
    if item.get("privacy") and item["privacy"] != "public":
        steps.append(f"set who can watch to {item['privacy']}")
    if item.get("schedule"):
        steps.append(f"schedule it for {item['schedule'].replace('T', ' ')}")
    return ", ".join(steps) + ". Then mark it published."


# ---- YouTube: checked and spent on the click, uploaded in the background ----

def _upload_log(item_id):
    return outbox.ORG / "logs" / f"youtube-upload-{item_id}.log"


def send_youtube(item_id, approval_text, dry_run=False):
    import youtube_api
    item = outbox.load(item_id)
    if dry_run:
        try:
            ready, problem = youtube_api.preflight(item), None
        except youtube_api.NotAllowed as e:
            ready, problem = None, str(e)
        return {"ok": True, "dry_run": True, "id": item_id, "kind": "youtube_upload", "status": item.get("status"),
                "would": f"upload {(item.get('media') or ['?'])[0]} to YouTube ({item.get('channel')})",
                "connected_as": ready, "blocked": problem, "request": youtube_api.metadata(item),
                "content": sendguard.content_hash(item)}

    with outbox.locked(item_id):
        item = outbox.load(item_id)
        if item.get("status") != "pending":
            raise Invalid(f"not uploading: it is {item.get('status')}")
        payload = sendguard.check(approval_text, item)
        try:
            channel_title = youtube_api.preflight(item)
        except youtube_api.NotAllowed as e:
            raise Invalid(f"not uploaded: {e}")    # the approval stays unspent; fix it and click again
        sendguard.burn(payload)
        item.update(status="sending", error=None,
                    next_step=f"Uploading to YouTube ({channel_title}) in the background.")
        outbox.note(item, f"Upload clicked in Roo (key {payload['key']}); uploading to {channel_title}")
        outbox.save(item)

    try:
        log = _upload_log(item_id)
        log.parent.mkdir(parents=True, exist_ok=True)
        with open(log, "a") as out:
            p = subprocess.Popen([sys.executable, str(pathlib.Path(__file__).resolve()), item_id, "--upload"],
                                 stdin=subprocess.PIPE, stdout=out, stderr=subprocess.STDOUT,
                                 start_new_session=True, close_fds=True)
        p.stdin.write(approval_text.encode())
        p.stdin.close()
    except OSError as e:
        reason = f"could not start the upload: {type(e).__name__}"
        _youtube_failed(item_id, reason)
        return {"ok": False, "id": item_id, "error": f"not uploaded: {reason}"}
    return {"ok": True, "id": item_id, "kind": "youtube_upload", "status": "sending",
            "next_step": f"Uploading to YouTube ({channel_title}) in the background. Activity shows the link when it's done."}


def _youtube_failed(item_id, reason):
    with outbox.locked(item_id):
        cur = outbox.load(item_id)
        cur.update(status="failed", error=reason, next_step=None)
        outbox.note(cur, f"upload failed: {reason}")
        outbox.save(cur)
    outbox.log_action(cur, False, f"{_label(cur)} failed: {reason}")


def upload_youtube(item_id, approval_text, **net):
    """The background step. Runs only on an item the click just moved to "sending"."""
    import youtube_api
    item = outbox.load(item_id)
    if outbox.kind_of(item) != "youtube_upload" or item.get("status") != "sending":
        raise Invalid(f"not uploading: it is {item.get('status')}")
    approved = {k: v for k, v in item.items() if k not in ("status", "history", "error")}
    try:
        res = youtube_api.approved_upload(approved, approval_text, **net)
    except (youtube_api.YouTubeError, youtube_api.NotAllowed, Refused, Invalid, OSError, ValueError) as e:
        reason = _redact(f"{type(e).__name__}: {str(e)[:240]}")
        _youtube_failed(item_id, reason)
        return {"ok": False, "id": item_id, "error": f"not uploaded: {reason}"}
    if res.get("publish_at"):
        step = f"Uploaded. Private until {res['publish_at']}, then YouTube makes it public."
    elif res.get("privacy") != item.get("privacy"):
        step = f"Uploaded, but YouTube set it {res.get('privacy')} (an unaudited API project can only upload private). Change it in YouTube Studio."
    else:
        step = f"Uploaded as {res.get('privacy')}. Finish the details (thumbnail, end screen, pinned comment) in YouTube Studio."
    with outbox.locked(item_id):
        cur = outbox.load(item_id)
        cur.update(status="published", published_at=outbox.now_iso(), result=res, link=res["link"],
                   next_step=step, error=None)
        outbox.note(cur, f"uploaded to YouTube: {res['link']} ({res.get('privacy')})")
        outbox.save(cur)
    outbox.log_action(cur, True, f"{_label(cur)}: uploaded ({res.get('privacy')})", res["link"])
    return {"ok": True, "id": item_id, "kind": "youtube_upload", "status": "published", "link": res["link"],
            "privacy": res.get("privacy")}


_KIND_WORD = {"email": "Email", "resend_email": "Email via Resend", "post": "Post", "text": "Text", "dm": "DM",
              "slack": "Slack message", "tiktok_post": "TikTok",
              "youtube_upload": "YouTube upload", "stripe_send_invoice": "Invoice", "stripe_send_quote": "Quote",
              "stripe_refund": "Refund", "stripe_subscription": "Subscription", "stripe_charge": "Card charge"}


def _label(item):
    """How an action reads in Roo Activity: kind, sender and subject; no recipients."""
    kind = outbox.kind_of(item)
    word = _KIND_WORD.get(kind, kind)
    if kind == "email":
        word += f" from the {item.get('account')} mailbox"
    elif kind == "resend_email":
        word = f"Email via Resend from {item.get('from')}"
    return f"{word}: {item.get('subject') or ''}".strip().rstrip(":")


def send_resend(item_id, approval_text, dry_run=False):
    """A resend_email item: the Resend API, from its verified sender."""
    import resend_api
    item = outbox.load(item_id)
    if dry_run:
        return {"ok": True, "dry_run": True, "id": item_id, "kind": "resend_email", "status": item.get("status"),
                "from": item.get("from"), "sender_verified": resend_api.sender_ok(item.get("from")),
                "recipients": item["to"] + item.get("cc", []), "request": {k: v for k, v in resend_api.payload(item).items() if k != "text"},
                "body_preview": item["body"][:400], "content": sendguard.content_hash(item)}

    with outbox.locked(item_id):
        item = outbox.load(item_id)
        if item.get("status") != "pending":
            raise Invalid(f"not sending: it is {item.get('status')}")
        payload = sendguard.check(approval_text, item)
        sendguard.burn(payload)
        item.update(status="sending", error=None)
        outbox.note(item, f"Send clicked in Roo (key {payload['key']}); sending through Resend")
        outbox.save(item)

    approved = {k: v for k, v in item.items() if k not in ("status", "history", "error")}
    try:
        res = resend_api.approved_send(approved, approval_text)
    except (resend_api.ResendError, resend_api.NotAllowed, Refused, Invalid, OSError) as e:
        reason = _redact(f"{type(e).__name__}: {str(e)[:240]}")
        with outbox.locked(item_id):
            cur = outbox.load(item_id)
            cur.update(status="failed", error=reason)
            outbox.note(cur, f"send failed: {reason}")
            outbox.save(cur)
        outbox.log_action(cur, False, f"{_label(cur)} failed: {reason}")
        return {"ok": False, "id": item_id, "error": f"not sent: {reason}"}

    with outbox.locked(item_id):
        cur = outbox.load(item_id)
        cur.update(status="sent", sent_at=outbox.now_iso(), resend_id=res.get("resend_id"), error=None)
        outbox.note(cur, f"sent through Resend ({res.get('resend_id')})")
        outbox.save(cur)
    outbox.log_action(cur, True, f"{_label(cur)}: sent")
    return {"ok": True, "id": item_id, "kind": "resend_email", "status": "sent", "sent_at": cur["sent_at"],
            "resend_id": cur["resend_id"]}


def send(item_id, approval_text, dry_run=False):
    item = outbox.load(item_id)
    if outbox.kind_of(item) == "resend_email":
        return send_resend(item_id, approval_text, dry_run)
    if outbox.kind_of(item) == "youtube_upload":
        return send_youtube(item_id, approval_text, dry_run)
    if outbox.kind_of(item) != "email":
        return act(item_id, approval_text, dry_run)
    acct = account(item.get("account"))
    if dry_run:
        msg = build(item, acct)
        return {"ok": True, "dry_run": True, "id": item_id, "status": item.get("status"),
                "headers": headers(msg), "recipients": item["to"] + item.get("cc", []),
                "body_preview": item["body"][:400], "bytes": len(msg.as_bytes()),
                "content": sendguard.content_hash(item)}

    with outbox.locked(item_id):
        item = outbox.load(item_id)
        if item.get("status") != "pending":
            raise Invalid(f"not sending: it is {item.get('status')}")
        payload = sendguard.check(approval_text, item)
        msg = build(item, acct)
        sendguard.burn(payload)
        item.update(status="sending", sent_message_id=msg["Message-ID"].strip("<>"), error=None)
        outbox.note(item, f"Send clicked in Roo (key {payload['key']})")
        outbox.save(item)

    rcpts = item["to"] + item.get("cc", [])
    try:
        refused = smtp_send(acct, msg, rcpts)
    except (smtplib.SMTPException, socket.error, OSError, Invalid) as e:
        reason = _redact(f"{type(e).__name__}: {str(e)[:200]}")
        with outbox.locked(item_id):
            cur = outbox.load(item_id)
            cur.update(status="failed", error=reason)
            outbox.note(cur, f"send failed: {reason}")
            outbox.save(cur)
        outbox.log_action(cur, False, f"{_label(cur)} failed: {reason}")
        return {"ok": False, "id": item_id, "error": f"not sent: {reason}"}

    with outbox.locked(item_id):
        cur = outbox.load(item_id)
        cur.update(status="sent", sent_at=outbox.now_iso(), error=None,
                   refused=sorted(refused) if refused else [])
        outbox.note(cur, "sent" + (f" (refused: {', '.join(sorted(refused))})" if refused else ""))
        outbox.save(cur)
    outbox.log_action(cur, True, f"{_label(cur)}: sent")
    return {"ok": True, "id": item_id, "status": "sent", "sent_at": cur["sent_at"],
            "message_id": cur["sent_message_id"], "refused": cur["refused"]}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("id")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--upload", action="store_true", help=argparse.SUPPRESS)   # the background YouTube step
    a = ap.parse_args(argv)
    try:
        approval = "" if a.dry_run or sys.stdin.isatty() else sys.stdin.read(8192)
        res = upload_youtube(a.id, approval) if a.upload else send(a.id, approval, dry_run=a.dry_run)
    except (Invalid, Refused) as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 2
    print(json.dumps(res, ensure_ascii=False))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
