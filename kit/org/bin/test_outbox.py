#!/usr/bin/env python3
"""Outbox + send guard, against a throwaway portfolio. Nothing is ever sent:
smtplib is replaced with a stub that fails the test if anything opens a connection.
Run: python3 bin/test_outbox.py (no Keychain, network or SMTP is touched)"""
import contextlib, io, json, os, pathlib, sys, tempfile, time, unittest

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="outbox-test-"))
os.environ["PORTFOLIO_ROOT"] = str(ROOT)
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import outbox, outbox_add, outbox_send, sendguard  # noqa: E402

SEED = bytes(range(1, 33))
ACCT = {"id": "studio", "address": "owner@example.com", "host": "imap.gmail.com", "auth": "oauth"}
SENT = []


class NoNetwork:
    def __init__(self, *a, **k):
        raise AssertionError("a test tried to open an SMTP connection")


REAL_SMTP_SEND = outbox_send.smtp_send
outbox_send.smtplib.SMTP_SSL = NoNetwork
outbox_send.smtplib.SMTP = NoNetwork
outbox_send.account = lambda aid: {**ACCT, "id": aid}


def fake_smtp(acct, msg, rcpts):
    SENT.append((acct["id"], msg, rcpts))
    return {}


def reset():
    for d in ("outbox", ".cache"):
        p = ROOT / d
        if p.exists():
            for f in sorted(p.rglob("*"), reverse=True):
                f.unlink() if f.is_file() else f.rmdir()
    (ROOT / "portfolio.json").write_text(json.dumps({
        "entities": [{"id": "acme", "path": "companies/acme"}],
        "email_accounts": {"studio": {"address": "owner@example.com", "entity": "acme"}}}))
    sendguard.CACHE.mkdir(parents=True, exist_ok=True)
    sendguard.PUBKEY.write_text(sendguard.public_key(SEED).hex())
    SENT.clear()
    outbox_send.smtp_send = fake_smtp


def add(**kw):
    args = dict(entity="acme", account="studio", to="Pat@Example.com", cc="", subject="Logo files",
                body="Hi Pat,\nHere they are.\n", why="Pat asked on Tuesday", created_by="acme-lead", draft=False)
    args.update(kw)
    return outbox_add.add(**args)


def approval(item, seed=SEED, ttl=120, nonce=None, **over):
    payload = {"v": 1, "purpose": "outbox-send", "id": item["id"], "content": sendguard.content_hash(item),
               "nonce": nonce or os.urandom(16).hex(), "exp": int(time.time()) + ttl}
    payload.update(over)
    text = json.dumps(payload, separators=(",", ":"))
    return json.dumps({"payload": text, "sig": sendguard.sign(seed, text.encode()).hex()})


class Ed25519(unittest.TestCase):
    def test_rfc8032_vector_1(self):
        seed = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
        pub = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        sig = bytes.fromhex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
        self.assertEqual(sendguard.public_key(seed), pub)
        self.assertEqual(sendguard.sign(seed, b""), sig)
        self.assertTrue(sendguard.verify(pub, b"", sig))
        self.assertFalse(sendguard.verify(pub, b"x", sig))
        self.assertFalse(sendguard.verify(pub, b"", sig[:-1] + bytes([sig[-1] ^ 1])))

    def test_matches_pulse(self):
        # Same constants as ops.rs `signature_matches_python`: Roo signs, Python verifies.
        msg = b'{"v":1,"purpose":"outbox-send","id":"x","content":"c","nonce":"n","exp":1}'
        sig = sendguard.sign(SEED, msg)
        self.assertEqual(sendguard.public_key(SEED).hex(),
                         "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664")
        self.assertEqual(sig.hex(), PULSE_SIG)

    def test_content_hash_matches_pulse(self):
        item = {"account": "studio", "to": ["a@x.com", "b@y.com"], "cc": [], "subject": "Hi – there",
                "body": "Line 1\nLine 2\n", "in_reply_to": "m1@x", "references": ["m0@x", "m1@x"]}
        self.assertEqual(sendguard.content_hash(item), PULSE_HASH)


PULSE_SIG = "1bd81ad2d9c09a4be45b085b9afe9f4bd4631660a894a0d283f3d36061f83d9b91e3ea32f0b5fe2af79540453263bd851d012f2b4824245dca81497e1b35a50d"
PULSE_HASH = "56815c408ccd028772d47aa56846591b90c3b4c5994b34aeaa736d4f08d37a9d"


class Outbox(unittest.TestCase):
    def setUp(self):
        reset()

    def test_add_validates(self):
        for bad in (dict(to="not-an-email"), dict(subject=" "), dict(body=""), dict(why=""),
                    dict(entity="nope"), dict(account="gmail")):
            with self.assertRaises(outbox.Invalid, msg=str(bad)):
                add(**bad)
        res = add()
        item = outbox.load(res["id"])
        self.assertEqual(item["to"], ["pat@example.com"])
        self.assertEqual(item["status"], "pending")
        self.assertEqual(item["created_by"], "acme-lead")
        self.assertEqual(oct(os.stat(outbox.path_for(item["id"])).st_mode & 0o777), "0o600")

    def test_add_dedupes_pending(self):
        a, b = add(), add(body="different words")
        self.assertEqual(a["id"], b["id"])
        self.assertFalse(b["changed"])
        self.assertEqual(len(outbox.all_items("pending")), 1)

    def test_reply_keeps_references(self):
        item = outbox.load(add(in_reply_to="<orig@mail.example>")["id"])
        self.assertEqual(item["in_reply_to"], "orig@mail.example")
        self.assertEqual(item["references"], ["orig@mail.example"])

    def test_edit_and_skip(self):
        iid = add()["id"]
        res = outbox.edit(iid, {"body": "New body", "cc": "boss@example.com"})
        self.assertTrue(res["changed"])
        self.assertEqual(res["item"]["cc"], ["boss@example.com"])
        before = res["item"]["original"]["body"]
        self.assertNotEqual(before, "New body")
        outbox.edit(iid, {"body": "Newer body"})                  # the agent's text stays the original
        self.assertEqual(outbox.load(iid)["original"], {"body": before, "cc": []})
        with self.assertRaises(outbox.Invalid):
            outbox.edit(iid, {"status": "sent"})
        with self.assertRaises(outbox.Invalid):
            outbox.edit(iid, {"to": ""})
        outbox.skip(iid, "not now")
        self.assertEqual(outbox.load(iid)["status"], "skipped")
        with self.assertRaises(outbox.Invalid):
            outbox.edit(iid, {"body": "x"})

    def test_ids_cannot_escape(self):
        for bad in ("../x", "A", "-x", "a/b", ""):
            with self.assertRaises(outbox.Invalid):
                outbox.path_for(bad)


class Send(unittest.TestCase):
    def setUp(self):
        reset()
        self.item = outbox.load(add(in_reply_to="orig@mail.example")["id"])

    def refused(self, appr, why):
        with self.assertRaises(sendguard.Refused) as cm:
            outbox_send.send(self.item["id"], appr)
        self.assertIn(why, str(cm.exception))
        self.assertEqual(SENT, [])
        self.assertEqual(outbox.load(self.item["id"])["status"], "pending")

    def test_dry_run_builds_threaded_mime_and_sends_nothing(self):
        res = outbox_send.send(self.item["id"], "", dry_run=True)
        h = res["headers"]
        self.assertEqual(h["From"], "owner@example.com")
        self.assertEqual(h["To"], "pat@example.com")
        self.assertEqual(h["In-Reply-To"], "<orig@mail.example>")
        self.assertEqual(h["References"], "<orig@mail.example>")
        self.assertTrue(h["Message-ID"].endswith("@example.com>"))
        self.assertEqual(SENT, [])
        self.assertEqual(outbox.load(self.item["id"])["status"], "pending")

    def test_agent_without_approval_is_refused(self):
        self.refused("", "only Roo's Send button")
        self.refused("{}", "only Roo's Send button")

    def test_wrong_key_is_refused(self):
        self.refused(approval(self.item, seed=bytes(32)), "signature")

    def test_tampered_payload_is_refused(self):
        a = json.loads(approval(self.item))
        a["payload"] = a["payload"].replace('"v":1', '"v":1 ')
        self.refused(json.dumps(a), "signature")

    def test_other_item_is_refused(self):
        self.refused(approval(self.item, id="someone-else"), "different message")

    def test_edit_after_click_is_refused(self):
        appr = approval(self.item)
        outbox.edit(self.item["id"], {"body": "Changed after the click"})
        self.refused(appr, "changed after you clicked")

    def test_expired_and_far_future_are_refused(self):
        self.refused(approval(self.item, ttl=-1), "expired")
        self.refused(approval(self.item, ttl=sendguard.MAX_TTL + 60), "expired")

    def test_valid_click_sends_once(self):
        appr = approval(self.item)
        res = outbox_send.send(self.item["id"], appr)
        self.assertTrue(res["ok"], res)
        self.assertEqual(len(SENT), 1)
        acct, msg, rcpts = SENT[0]
        self.assertEqual(rcpts, ["pat@example.com"])
        self.assertEqual(msg["In-Reply-To"], "<orig@mail.example>")
        done = outbox.load(self.item["id"])
        self.assertEqual(done["status"], "sent")
        self.assertTrue(done["sent_at"])
        self.assertEqual(done["sent_message_id"], msg["Message-ID"].strip("<>"))
        # Replay of the same approval: refused (not pending, and the nonce is burned).
        with self.assertRaises(outbox.Invalid):
            outbox_send.send(self.item["id"], appr)
        self.assertEqual(len(SENT), 1)

    def test_burned_nonce_is_refused(self):
        sendguard.burn({"nonce": "ab" * 16, "id": "old"})
        self.refused(approval(self.item, nonce="ab" * 16), "already used")

    def test_failure_is_recorded_not_retried(self):
        def boom(*a):
            raise OSError("connection reset")
        outbox_send.smtp_send = boom
        res = outbox_send.send(self.item["id"], approval(self.item))
        self.assertFalse(res["ok"])
        self.assertEqual(outbox.load(self.item["id"])["status"], "failed")

    def test_no_key_file(self):
        sendguard.PUBKEY.unlink()
        self.refused(approval(self.item), "no send key")

    def test_sender_never_touches_drafts(self):
        src = (pathlib.Path(__file__).parent / "outbox_send.py").read_text()
        for word in ("delete_draft", "EXPUNGE", "\\\\Deleted", "draft_email.main", "uid(\"STORE"):
            self.assertNotIn(word, src)


# ---------------------------------------------------------------------------
# Kinds: posts, texts, DMs, Slack (approve -> publish by hand) and Stripe money items
# ---------------------------------------------------------------------------

import stripe_api  # noqa: E402

STRIPE_CALLS = []
STRIPE_STATE = {}


def fake_http(key, method, path, params=None, idem=None):
    STRIPE_CALLS.append((method, path, params, idem))
    if key != "rk_test_agent":
        raise AssertionError("wrong key")
    obj = STRIPE_STATE.get((method, path))
    if obj is None:
        raise stripe_api.StripeError(404, f"no fixture for {method} {path}")
    return obj(params) if callable(obj) else obj


stripe_api._http = fake_http
stripe_api.key_for = lambda entity: "rk_test_agent" if entity == "acme" else (_ for _ in ()).throw(stripe_api.NotAllowed("no key"))
stripe_api.action_key_for = stripe_api.key_for     # the click runs with stripe-action:<entity>


def add_kind(kind, **fields):
    return outbox_add.add_kind(kind, "acme", fields.pop("why", "Because it helps"), "acme-lead", fields)


INVOICE = dict(stripe_id="in_TEST123456", customer_id="cus_TEST123456", customer="Northwind Co <ap@northwind.example>",
               amount=125000, currency="usd", due_date="2026-11-30", subject="Invoice $1,250.00 to Northwind Co",
               body="Website build  $1,250.00\nDue 2026-11-30")


class Kinds(unittest.TestCase):
    def setUp(self):
        reset()
        STRIPE_CALLS.clear()
        STRIPE_STATE.clear()

    def do(self, iid, appr=None):
        item = outbox.load(iid)
        return outbox_send.send(iid, appr if appr is not None else approval(item))

    def refused(self, iid, appr, why):
        with self.assertRaises(sendguard.Refused) as cm:
            outbox_send.send(iid, appr)
        self.assertIn(why, str(cm.exception))
        self.assertEqual(outbox.load(iid)["status"], "pending")
        self.assertEqual([c for c in STRIPE_CALLS if c[0] == "POST"], [])

    # ----- validation -----
    def test_kind_validation(self):
        bad = [("post", dict(channel="myspace", body="hi")), ("post", dict(channel="x", body=" ")),
               ("post", dict(channel="x", body="hi", link="http://insecure.example")),
               ("text", dict(to="call me", body="hi")), ("text", dict(to="", body="hi")),
               ("dm", dict(channel="x", to="not a handle!", body="hi")),
               ("slack", dict(channel="general", body="hi")),
               ("stripe_send_invoice", dict(INVOICE, stripe_id="ch_TEST123456")),
               ("stripe_send_invoice", dict(INVOICE, amount=12.5)),
               ("stripe_send_invoice", dict(INVOICE, amount=0)),
               ("stripe_refund", dict(stripe_id="ch_TEST123456", amount=500, currency="usd", reason="angry", subject="Refund")),
               ("stripe_subscription", dict(action="update", customer_id="cus_TEST123456", items=["price_TEST123456:1"],
                                            amount=100, currency="usd", subject="s")),
               ("stripe_subscription", dict(action="create", customer_id="cus_TEST123456", items=["oops"],
                                            amount=100, currency="usd", subject="s")),
               ("email", dict(body="x")), ("fax", dict(body="x"))]
        for kind, f in bad:
            with self.assertRaises(outbox.Invalid, msg=f"{kind} {f}"):
                add_kind(kind, **f)
        with self.assertRaises(outbox.Invalid):
            add_kind("post", channel="x", body="hi", why=" ")

    def test_cli_refuses_stripe_kinds(self):
        with self.assertRaises(SystemExit):
            outbox_add.main(["--kind", "stripe_refund", "--entity", "acme", "--body", "x", "--why", "y"])

    def test_cli_queues_a_post(self):
        with contextlib.redirect_stdout(io.StringIO()):
            rc = outbox_add.main(["--kind", "post", "--entity", "acme", "--channel", "linkedin", "--body", "We shipped.",
                              "--why", "Launch week", "--media", "a.png, b.png"])
        self.assertEqual(rc, 0)
        item = outbox.all_items("pending")[0]
        self.assertEqual((item["kind"], item["channel"], item["media"], item["to"]), ("post", "linkedin", ["a.png", "b.png"], []))

    def test_hashes_differ_by_kind_and_content(self):
        a = outbox.load(add_kind("post", channel="x", body="hello")["id"])
        b = outbox.load(add_kind("post", channel="linkedin", body="hello")["id"])
        self.assertNotEqual(sendguard.content_hash(a), sendguard.content_hash(b))
        # email hash is unchanged by the kind field
        e = outbox.load(add()["id"])
        self.assertEqual(sendguard.content_hash(e), sendguard.content_hash({k: v for k, v in e.items() if k != "kind"}))

    def test_kind_hash_matches_pulse(self):
        # Same item and constant as ops.rs `kind_hash_matches_python`.
        item = {"kind": "stripe_subscription", "entity": "acme", "action": "create", "stripe_id": None,
                "customer_id": "cus_A1", "items": ["price_A:2", "price_B:1"], "amount": 4500, "currency": "usd",
                "interval": "month", "days_until_due": 30, "subject": "Start – sub", "body": "Line 1\nLine 2"}
        self.assertEqual(sendguard.content_hash(item), PULSE_KIND_HASH)

    def test_dedupe_and_edit_rules(self):
        a = add_kind("text", to="+1 555 010 2030", body="Running 5 late")
        self.assertFalse(add_kind("text", to="+15550102030", body="Running 5 late")["changed"])
        res = outbox.edit(a["id"], {"body": "Running 10 late"})
        self.assertTrue(res["changed"])
        with self.assertRaises(outbox.Invalid):
            outbox.edit(a["id"], {"subject": "nope"})
        inv = add_kind("stripe_send_invoice", **INVOICE)["id"]
        with self.assertRaises(outbox.Invalid):
            outbox.edit(inv, {"body": "pay me more"})
        self.assertFalse(add_kind("stripe_send_invoice", **INVOICE)["changed"])

    # ----- publish-by-hand kinds -----
    def test_every_publish_kind_needs_the_click_then_is_approved_not_published(self):
        ids = [add_kind("post", channel="instagram", body="New work", media=["hero.jpg"])["id"],
               add_kind("text", to="+15550102030", body="See you at 3")["id"],
               add_kind("dm", channel="linkedin", to="pat-q", body="Thanks for the intro")["id"],
               add_kind("slack", channel="studio/#general", body="Deploy is out")["id"]]
        for iid in ids:
            self.refused(iid, "", "only Roo's Send button")
            self.refused(iid, approval(outbox.load(iid), seed=bytes(32)), "signature")
            res = self.do(iid)
            self.assertEqual(res["status"], "approved", res)
            item = outbox.load(iid)
            self.assertEqual(item["status"], "approved")
            self.assertTrue(item["link"])
            self.assertIsNone(item.get("sent_at"))
            with self.assertRaises(outbox.Invalid):
                self.do(iid)
        self.assertEqual(outbox.load(ids[0])["link"], "https://www.instagram.com/")
        self.assertEqual(outbox.load(ids[1])["link"], "sms:+15550102030")
        self.assertEqual(SENT, [])
        self.assertEqual(STRIPE_CALLS, [])
        outbox.published(ids[0])
        self.assertEqual(outbox.load(ids[0])["status"], "published")
        with self.assertRaises(outbox.Invalid):
            outbox.published(add_kind("post", channel="x", body="not approved yet")["id"])

    def test_edit_after_click_voids_a_post_approval(self):
        iid = add_kind("post", channel="x", body="v1")["id"]
        appr = approval(outbox.load(iid))
        outbox.edit(iid, {"body": "v2"})
        self.refused(iid, appr, "changed after you clicked")

    # ----- Stripe kinds -----
    def invoice_fixtures(self, **over):
        inv = {"id": "in_TEST123456", "status": "draft", "customer": "cus_TEST123456", "amount_due": 125000,
               "currency": "usd", "collection_method": "send_invoice", "livemode": False}
        inv.update(over)
        STRIPE_STATE[("GET", "/invoices/in_TEST123456")] = inv
        STRIPE_STATE[("POST", "/invoices/in_TEST123456/finalize")] = {**inv, "status": "open"}
        STRIPE_STATE[("POST", "/invoices/in_TEST123456/send")] = {**inv, "status": "open", "number": "ACME-0001",
                                                                   "hosted_invoice_url": "https://invoice.stripe.com/i/test"}

    def test_invoice_refused_without_valid_approval(self):
        self.invoice_fixtures()
        iid = add_kind("stripe_send_invoice", **INVOICE)["id"]
        item = outbox.load(iid)
        self.refused(iid, "", "only Roo's Send button")
        self.refused(iid, approval(item, seed=bytes(32)), "signature")
        self.refused(iid, approval(item, ttl=-5), "expired")
        self.refused(iid, approval(item, id="someone-else"), "different message")
        self.refused(iid, approval(item, content="0" * 64), "changed after you clicked")
        self.assertEqual(STRIPE_CALLS, [])

    def test_invoice_finalized_and_sent_once(self):
        self.invoice_fixtures()
        iid = add_kind("stripe_send_invoice", **INVOICE)["id"]
        appr = approval(outbox.load(iid))
        res = outbox_send.send(iid, appr)
        self.assertTrue(res["ok"], res)
        posts = [(c[1], c[3]) for c in STRIPE_CALLS if c[0] == "POST"]
        self.assertEqual(posts, [("/invoices/in_TEST123456/finalize", f"{iid}-finalize"),
                                 ("/invoices/in_TEST123456/send", f"{iid}-send")])
        item = outbox.load(iid)
        self.assertEqual((item["status"], item["link"]), ("sent", "https://invoice.stripe.com/i/test"))
        with self.assertRaises(outbox.Invalid):
            outbox_send.send(iid, appr)
        self.assertEqual(len([c for c in STRIPE_CALLS if c[0] == "POST"]), 2)

    def test_invoice_changed_in_stripe_is_not_sent(self):
        self.invoice_fixtures(amount_due=999999)
        iid = add_kind("stripe_send_invoice", **INVOICE)["id"]
        res = self.do(iid)
        self.assertFalse(res["ok"])
        self.assertIn("amount due", res["error"])
        self.assertEqual(outbox.load(iid)["status"], "failed")
        self.assertEqual([c for c in STRIPE_CALLS if c[0] == "POST"], [])

    def test_quote_is_finalized_and_left_for_the_owner_to_send(self):
        q = {"id": "qt_TEST123456", "status": "draft", "customer": "cus_TEST123456", "amount_total": 50000,
             "currency": "usd", "livemode": False}
        STRIPE_STATE[("GET", "/quotes/qt_TEST123456")] = q
        STRIPE_STATE[("POST", "/quotes/qt_TEST123456/finalize")] = {**q, "status": "open", "number": "QT-1"}
        iid = add_kind("stripe_send_quote", stripe_id="qt_TEST123456", customer_id="cus_TEST123456",
                       amount=50000, currency="usd", subject="Quote $500.00")["id"]
        self.refused(iid, "", "only Roo's Send button")
        res = self.do(iid)
        self.assertEqual(res["status"], "approved", res)
        self.assertIn("Send quote", res["next_step"])
        self.assertEqual(res["link"], "https://dashboard.stripe.com/test/quotes/qt_TEST123456")

    def test_refund_checks_what_is_left(self):
        STRIPE_STATE[("GET", "/charges/ch_TEST123456")] = {"id": "ch_TEST123456", "amount": 10000,
                                                           "amount_refunded": 0, "currency": "usd"}
        STRIPE_STATE[("POST", "/refunds")] = lambda p: {"id": "re_1", "status": "succeeded", "livemode": False, **p}
        iid = add_kind("stripe_refund", stripe_id="ch_TEST123456", amount=2500, currency="usd",
                       reason="requested_by_customer", subject="Refund $25.00")["id"]
        self.refused(iid, "", "only Roo's Send button")
        self.refused(iid, approval(outbox.load(iid), seed=bytes(32)), "signature")
        res = self.do(iid)
        self.assertTrue(res["ok"], res)
        _, path, params, idem = [c for c in STRIPE_CALLS if c[0] == "POST"][0]
        self.assertEqual((path, params["charge"], params["amount"], idem), ("/refunds", "ch_TEST123456", 2500, f"{iid}-refund"))
        # More than is left: refused before the POST.
        STRIPE_CALLS.clear()
        STRIPE_STATE[("GET", "/charges/ch_TEST123456")] = {"id": "ch_TEST123456", "amount": 10000,
                                                           "amount_refunded": 9000, "currency": "usd"}
        iid2 = add_kind("stripe_refund", stripe_id="ch_TEST123456", amount=2000, currency="usd", subject="Refund $20.00")["id"]
        res = self.do(iid2)
        self.assertFalse(res["ok"])
        self.assertEqual([c for c in STRIPE_CALLS if c[0] == "POST"], [])

    def test_subscription_create_and_update(self):
        STRIPE_STATE[("GET", "/prices/price_TESTAAAAAA")] = {"id": "price_TESTAAAAAA", "currency": "usd", "unit_amount": 2000,
                                                             "recurring": {"interval": "month"}}
        STRIPE_STATE[("GET", "/prices/price_TESTBBBBBB")] = {"id": "price_TESTBBBBBB", "currency": "usd", "unit_amount": 500,
                                                             "recurring": {"interval": "month"}}
        STRIPE_STATE[("POST", "/subscriptions")] = lambda p: {"id": "sub_NEW1234567", "status": "active", "livemode": False}
        base = dict(customer_id="cus_TEST123456", currency="usd", interval="month", subject="Sub")
        iid = add_kind("stripe_subscription", action="create", items=["price_TESTAAAAAA:2", "price_TESTBBBBBB:1"],
                       amount=4500, days_until_due=14, **base)["id"]
        self.refused(iid, "", "only Roo's Send button")
        res = self.do(iid)
        self.assertTrue(res["ok"], res)
        params = [c for c in STRIPE_CALLS if c[0] == "POST"][0][2]
        self.assertEqual(params["items"], [{"price": "price_TESTAAAAAA", "quantity": 2}, {"price": "price_TESTBBBBBB", "quantity": 1}])
        self.assertEqual((params["collection_method"], params["days_until_due"]), ("send_invoice", 14))

        STRIPE_CALLS.clear()
        STRIPE_STATE[("GET", "/subscriptions/sub_OLD1234567")] = {"id": "sub_OLD1234567", "customer": "cus_TEST123456",
            "items": {"data": [{"id": "si_A", "price": {"id": "price_TESTAAAAAA"}, "quantity": 1},
                               {"id": "si_X", "price": {"id": "price_TESTXXXXXX"}, "quantity": 1}]}}
        STRIPE_STATE[("POST", "/subscriptions/sub_OLD1234567")] = lambda p: {"id": "sub_OLD1234567", "status": "active", "livemode": False}
        iid = add_kind("stripe_subscription", action="update", stripe_id="sub_OLD1234567",
                       items=["price_TESTAAAAAA:3", "price_TESTBBBBBB:1"], amount=6500, **base)["id"]
        self.assertTrue(self.do(iid)["ok"])
        params = [c for c in STRIPE_CALLS if c[0] == "POST"][0][2]
        self.assertEqual(params["items"], [{"id": "si_A", "quantity": 3}, {"price": "price_TESTBBBBBB", "quantity": 1},
                                           {"id": "si_X", "deleted": True}])

        # Price total no longer matches the approval: nothing is created.
        STRIPE_CALLS.clear()
        iid = add_kind("stripe_subscription", action="create", items=["price_TESTAAAAAA:1"], amount=1999, **base)["id"]
        self.assertFalse(self.do(iid)["ok"])
        self.assertEqual([c for c in STRIPE_CALLS if c[0] == "POST"], [])

    # ----- stripe_charge -----
    def charge_fixtures(self, pm="pm_TESTVISA4242", pi=None):
        STRIPE_STATE[("GET", "/customers/cus_TEST123456")] = {"id": "cus_TEST123456", "name": "Northwind Co",
                                                              "invoice_settings": {"default_payment_method": None}}
        STRIPE_STATE[("GET", "/customers/cus_TEST123456/payment_methods")] = {"data": [] if pm is None else [
            {"id": pm, "type": "card", "customer": "cus_TEST123456", "card": {"brand": "visa", "last4": "4242"}}]}
        STRIPE_STATE[("POST", "/payment_intents")] = pi or (lambda p: {"id": "pi_NEW1234567", "status": "succeeded",
                                                                     "latest_charge": "ch_NEW1234567", "livemode": False})

    def test_charge_validation(self):
        for over in (dict(payment_method="card_123456789"), dict(amount=10), dict(amount=12.5), dict(card=""),
                     dict(description=" "), dict(customer_id="acct_1234567"), dict(statement_descriptor_suffix="<script>"),
                     dict(statement_descriptor_suffix="1234"), dict(statement_descriptor_suffix="X" * 23)):
            with self.assertRaises(outbox.Invalid, msg=over):
                add_kind("stripe_charge", **dict(CHARGE, **over))
        a = add_kind("stripe_charge", **CHARGE)
        self.assertFalse(add_kind("stripe_charge", **CHARGE)["changed"])      # no duplicate charge queued
        with self.assertRaises(outbox.Invalid):
            outbox.edit(a["id"], {"body": "more"})

    def test_charge_runs_once_off_session_after_the_click(self):
        self.charge_fixtures()
        iid = add_kind("stripe_charge", **CHARGE)["id"]
        item = outbox.load(iid)
        self.refused(iid, "", "only Roo's Send button")
        self.refused(iid, approval(item, seed=bytes(32)), "signature")
        self.refused(iid, approval(item, content="0" * 64), "changed after you clicked")
        self.assertEqual(STRIPE_CALLS, [])
        appr = approval(item)
        res = outbox_send.send(iid, appr)
        self.assertTrue(res["ok"], res)
        posts = [c for c in STRIPE_CALLS if c[0] == "POST"]
        self.assertEqual(len(posts), 1)
        _, path, params, idem = posts[0]
        self.assertEqual((path, idem), ("/payment_intents", f"{iid}-charge"))
        self.assertEqual({k: params[k] for k in ("amount", "currency", "customer", "payment_method", "confirm", "off_session",
                                                  "description", "statement_descriptor_suffix")},
                         {"amount": 25000, "currency": "usd", "customer": "cus_TEST123456", "payment_method": "pm_TESTVISA4242",
                          "confirm": True, "off_session": True, "description": "November retainer",
                          "statement_descriptor_suffix": "RETAINER"})
        self.assertEqual(params["metadata"], {"outbox_id": iid})
        item = outbox.load(iid)
        self.assertEqual((item["status"], item["result"]["payment_intent"], item["link"]),
                         ("sent", "pi_NEW1234567", "https://dashboard.stripe.com/test/payments/pi_NEW1234567"))
        with self.assertRaises(outbox.Invalid):
            outbox_send.send(iid, appr)
        self.assertEqual(len([c for c in STRIPE_CALLS if c[0] == "POST"]), 1)
        log = [json.loads(l) for l in (ROOT / "logs" / "outbox-actions.jsonl").read_text().splitlines()]
        self.assertTrue(log[-1]["ok"])

    def test_charge_refused_if_the_card_is_gone(self):
        self.charge_fixtures(pm="pm_TESTOTHER999")
        iid = add_kind("stripe_charge", **CHARGE)["id"]
        res = self.do(iid)
        self.assertFalse(res["ok"])
        self.assertIn("pm_TESTVISA4242 is not a card saved", res["error"])
        self.assertEqual(outbox.load(iid)["status"], "failed")
        self.assertEqual([c for c in STRIPE_CALLS if c[0] == "POST"], [])

    def test_charge_declined_or_needs_authentication_fails_cleanly(self):
        cases = [(stripe_api.StripeError(402, "Your card was declined.", "card_declined", "insufficient_funds"), "insufficient funds"),
                 (stripe_api.StripeError(402, "Authentication required.", "authentication_required", "authentication_required"),
                  "authenticate"),
                 ({"id": "pi_X1234567", "status": "requires_action", "livemode": False}, "authenticate")]
        for i, (outcome, words) in enumerate(cases):
            STRIPE_CALLS.clear()

            def pi(p, outcome=outcome):
                if isinstance(outcome, Exception):
                    raise outcome
                return outcome
            self.charge_fixtures(pi=pi)
            iid = add_kind("stripe_charge", **dict(CHARGE, amount=25000 + i))["id"]
            res = self.do(iid)
            self.assertFalse(res["ok"], res)
            self.assertIn(words, res["error"])
            self.assertIn("Nothing was charged", res["error"])
            item = outbox.load(iid)
            self.assertEqual(item["status"], "failed")
            # One attempt, no retry.
            self.assertEqual(len([c for c in STRIPE_CALLS if c[0] == "POST"]), 1)
            log = [json.loads(l) for l in (ROOT / "logs" / "outbox-actions.jsonl").read_text().splitlines()]
            self.assertFalse(log[-1]["ok"])
            self.assertIn("Card charge", log[-1]["what"])

    def test_charge_hash_matches_pulse(self):
        # Same item and constant as ops.rs `charge_hash_matches_python`.
        self.assertEqual(sendguard.content_hash(PULSE_CHARGE_ITEM), PULSE_CHARGE_HASH)

    def test_charge_never_auto_approved(self):
        learn = pathlib.Path(__file__).parent / "outbox_learn.py"
        if learn.exists():
            import outbox_learn
            self.assertTrue(outbox_learn.NEVER_AUTO.search("stripe_charge"))

    def test_money_calls_need_a_spent_approval(self):
        # stripe_api.approved_call is the only door to money calls; an approval that
        # outbox_send.py hasn't spent (burned) for this item doesn't open it.
        iid = add_kind("stripe_refund", stripe_id="ch_TEST123456", amount=100, currency="usd", subject="Refund")["id"]
        item = outbox.load(iid)
        with self.assertRaises(sendguard.Refused):
            stripe_api.approved_call(item, approval(item), "POST", "/refunds", {"charge": "ch_TEST123456"})
        with self.assertRaises(sendguard.Refused):
            stripe_api.approved_call(item, "", "POST", "/refunds", {})
        # Even a spent approval can't reach a path outside its kind.
        appr = approval(item)
        sendguard.burn(json.loads(json.loads(appr)["payload"]))
        with self.assertRaises(stripe_api.NotAllowed):
            stripe_api.approved_call(item, appr, "POST", "/transfers", {})
        self.assertEqual(STRIPE_CALLS, [])

    def test_dry_run_does_nothing(self):
        iid = add_kind("stripe_send_invoice", **INVOICE)["id"]
        res = outbox_send.send(iid, "", dry_run=True)
        self.assertIn("Stripe", res["would"])
        self.assertEqual(STRIPE_CALLS, [])
        self.assertEqual(outbox.load(iid)["status"], "pending")


PULSE_KIND_HASH = "ff42dcc39b97ad759cd18bb70e8f393fd8b715a0e4c977c2ae1f06cbce12d7e3"
CHARGE = dict(customer_id="cus_TEST123456", customer="Northwind Co <ap@northwind.example>", payment_method="pm_TESTVISA4242",
              card="Visa •••• 4242, exp 04/28", amount=25000, currency="usd", description="November retainer",
              statement_descriptor_suffix="RETAINER", subject="Charge $250.00 to Northwind Co",
              body="November retainer\nCard: Visa •••• 4242, exp 04/28")
PULSE_CHARGE_ITEM = {"kind": "stripe_charge", "entity": "acme", **CHARGE}
PULSE_CHARGE_HASH = "eac0e278694226f0e47806ac76ba9883f69394973455dbb758d021196b085ab9"


# ---------------------------------------------------------------------------
# Email through Resend (resend_email), the action keys, and the Activity log
# ---------------------------------------------------------------------------

import resend_api  # noqa: E402

RESEND_CALLS = []
RESEND_REPLY = {"id": "re-msg-0001"}


def fake_resend(key, method, path, body=None, idem=None):
    RESEND_CALLS.append((key, method, path, body, idem))
    if isinstance(RESEND_REPLY, Exception):
        raise RESEND_REPLY
    return RESEND_REPLY


resend_api._http = fake_resend
resend_api.key = lambda: "re_test_sending"


def add_resend(**kw):
    args = dict(entity="acme", sender="Notify@Notify.Example.com", to="pat@example.com", cc="", subject="Your site is live",
                body="Hi Pat,\nIt is live.\n", why="Launch day", created_by="acme-lead", from_name="Acme",
                reply_to="owner@example.com")
    args.update(kw)
    return outbox_add.add_resend(**args)


def actions_log():
    try:
        return [json.loads(l) for l in outbox.ACTIONS_LOG.read_text().splitlines() if l.strip()]
    except FileNotFoundError:
        return []


class Resend(unittest.TestCase):
    def setUp(self):
        reset()
        global RESEND_REPLY
        RESEND_REPLY = {"id": "re-msg-0001"}
        RESEND_CALLS.clear()
        resend_api.DOMAINS.write_text(json.dumps({"domains": ["notify.example.com", "example.org"]}))
        if outbox.ACTIONS_LOG.exists():
            outbox.ACTIONS_LOG.unlink()
        self.item = outbox.load(add_resend()["id"])

    def test_queues_with_a_verified_sender_only(self):
        self.assertEqual((self.item["kind"], self.item["from"], self.item["account"]), ("resend_email", "notify@notify.example.com", "resend"))
        self.assertEqual(self.item["reply_to"], "owner@example.com")
        # The parent domain isn't verified just because a subdomain is.
        for bad in ("notify@example.com", "x@evil.example", "two@example.org, three@example.org", "not an address"):
            with self.assertRaises(outbox.Invalid, msg=bad):
                add_resend(sender=bad, subject="Other " + bad)
        resend_api.DOMAINS.unlink()
        with self.assertRaises(outbox.Invalid) as cm:
            add_resend(subject="No domains")
        self.assertIn("resend_domains.json", str(cm.exception))

    def test_dedupes_and_edits_like_email(self):
        self.assertFalse(add_resend()["changed"])
        res = outbox.edit(self.item["id"], {"subject": "Live now"})
        self.assertTrue(res["changed"])
        with self.assertRaises(outbox.Invalid):
            outbox.edit(self.item["id"], {"from": "x@example.org"})

    def test_cli(self):
        resend_api.DOMAINS.write_text(json.dumps({"domains": ["example.org"]}))
        with contextlib.redirect_stdout(io.StringIO()) as out:
            rc = outbox_add.main(["--entity", "acme", "--via", "resend", "--from", "hello@example.org", "--to", "a@example.com",
                                  "--subject", "Hi", "--body", "Body", "--why", "Because"])
        self.assertEqual(rc, 0, out.getvalue())
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(outbox_add.main(["--entity", "acme", "--via", "resend", "--to", "a@example.com",
                                              "--subject", "Hi", "--body", "Body", "--why", "Because"]), 2)

    def test_dry_run_sends_nothing(self):
        res = outbox_send.send(self.item["id"], "", dry_run=True)
        self.assertTrue(res["sender_verified"])
        self.assertEqual(res["request"]["from"], '"Acme" <notify@notify.example.com>')
        self.assertEqual(RESEND_CALLS, [])

    def test_needs_the_click(self):
        for appr in ("", "{}", approval(self.item, seed=bytes(32))):
            with self.assertRaises(sendguard.Refused):
                outbox_send.send(self.item["id"], appr)
        appr = approval(self.item)
        outbox.edit(self.item["id"], {"body": "Changed after the click"})
        with self.assertRaises(sendguard.Refused):
            outbox_send.send(self.item["id"], appr)
        # resend_api's own door wants an approval outbox_send.py already spent.
        item = outbox.load(self.item["id"])
        with self.assertRaises(sendguard.Refused):
            resend_api.approved_send(item, approval(item))
        self.assertEqual(RESEND_CALLS, [])
        self.assertEqual(outbox.load(self.item["id"])["status"], "pending")

    def test_click_sends_once_and_logs_activity(self):
        appr = approval(self.item)
        res = outbox_send.send(self.item["id"], appr)
        self.assertTrue(res["ok"], res)
        self.assertEqual(len(RESEND_CALLS), 1)
        key, method, path, body, idem = RESEND_CALLS[0]
        self.assertEqual((key, method, path, idem), ("re_test_sending", "POST", "/emails", f"outbox-{self.item['id']}"))
        self.assertEqual((body["to"], body["reply_to"], body["text"]), (["pat@example.com"], ["owner@example.com"], "Hi Pat,\nIt is live.\n"))
        done = outbox.load(self.item["id"])
        self.assertEqual((done["status"], done["resend_id"]), ("sent", "re-msg-0001"))
        with self.assertRaises(outbox.Invalid):
            outbox_send.send(self.item["id"], appr)
        self.assertEqual(len(RESEND_CALLS), 1)
        rows = actions_log()
        self.assertEqual([(r["kind"], r["ok"], r["status"]) for r in rows], [("resend_email", True, "sent")])
        self.assertIn("notify@notify.example.com", rows[0]["what"])
        self.assertNotIn("pat@example.com", json.dumps(rows))

    def test_reply_threads(self):
        item = outbox.load(add_resend(subject="Re: hello", in_reply_to="<orig@mail.example>")["id"])
        self.assertEqual(resend_api.payload(item)["headers"], {"In-Reply-To": "<orig@mail.example>", "References": "<orig@mail.example>"})

    def test_failure_is_recorded_and_logged(self):
        global RESEND_REPLY
        RESEND_REPLY = resend_api.ResendError(403, "The notify.example.com domain is not verified", "validation_error")
        res = outbox_send.send(self.item["id"], approval(self.item))
        self.assertFalse(res["ok"])
        self.assertEqual(outbox.load(self.item["id"])["status"], "failed")
        self.assertEqual([(r["ok"], r["status"]) for r in actions_log()], [(False, "failed")])

    def test_unverified_sender_is_refused_at_send_time(self):
        resend_api.DOMAINS.write_text(json.dumps({"domains": ["example.org"]}))
        res = outbox_send.send(self.item["id"], approval(self.item))
        self.assertFalse(res["ok"])
        self.assertIn("verified", res["error"])
        self.assertEqual(RESEND_CALLS, [])

    def test_hash_matches_pulse(self):
        # Same item and constant as ops.rs `resend_hash_matches_python`.
        item = {"kind": "resend_email", "entity": "acme", "from": "notify@notify.example.com", "from_name": "Acme – Notify",
                "reply_to": None, "to": ["pat@example.com", "sam@example.com"], "cc": [], "subject": "Your site is live",
                "body": "Hi Pat,\nIt is live.\n", "in_reply_to": "orig@mail.example",
                "references": ["a@x.example", "orig@mail.example"]}
        self.assertEqual(sendguard.content_hash(item), PULSE_RESEND_HASH)


class ActionKeys(unittest.TestCase):
    def fake_keyring(self, store):
        import types
        fake = types.ModuleType("keyring_store")
        fake.fetch = store.get
        saved = sys.modules.get("keyring_store")
        sys.modules["keyring_store"] = fake
        self.addCleanup(lambda: sys.modules.__setitem__("keyring_store", saved) if saved else sys.modules.pop("keyring_store", None))

    def load_real(self, name):
        import importlib.util
        spec = importlib.util.spec_from_file_location(name + "_real", pathlib.Path(__file__).resolve().parent / f"{name}.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_stripe_action_key_is_separate_from_the_agent_key(self):
        real = self.load_real("stripe_api")
        self.fake_keyring({"stripe:acme": "rk_test_agent", "stripe-action:acme": "rk_test_action", "stripe-action:odd": "pk_test_x"})
        self.assertEqual(real.action_key_for("acme"), "rk_test_action")
        self.assertEqual(real.key_for("acme"), "rk_test_agent")
        for bad in ("Acme", "../x", "odd", "none-stored"):
            with self.assertRaises(real.NotAllowed, msg=bad):
                real.action_key_for(bad)
        with self.assertRaises(real.NotAllowed) as cm:
            real.action_key_for("none-stored")
        self.assertIn("keyring_store.py set stripe-action:none-stored", str(cm.exception))

    def test_resend_key_rules(self):
        real = self.load_real("resend_api")
        self.fake_keyring({"resend:send": "re_test_sending"})
        self.assertEqual(real.key(), "re_test_sending")
        self.fake_keyring({"resend:send": "sk_live_wrong"})
        with self.assertRaises(real.NotAllowed):
            real.key()
        self.fake_keyring({})
        with self.assertRaises(real.NotAllowed):
            real.key()


VIDEO = ROOT / "media" / "clip.mp4"


def add_social(kind, **kw):
    VIDEO.parent.mkdir(parents=True, exist_ok=True)
    VIDEO.write_bytes(b"\0" * 1000)
    if kind == "tiktok_post":
        f = {"account": "acme.studio", "title": "TikTok 1/3: title drop", "body": "Caption here", "media": [str(VIDEO)],
             "ai_label": "yes", "privacy": "public", "schedule": "2026-11-10", "notes": "Cover at 0:04"}
    else:
        f = {"channel": "acme", "title": "The Game Cut", "body": "Description", "tags": "pixel art, 16-bit",
             "privacy": None, "media": [str(VIDEO)], "category_id": "10"}
    f.update(kw)
    return outbox_add.add_kind(kind, "acme", "Post day 1", "acme-lead", f)


class TikTok(unittest.TestCase):
    def setUp(self):
        reset()
        if outbox.ACTIONS_LOG.exists():
            outbox.ACTIONS_LOG.unlink()
        self.item = outbox.load(add_social("tiktok_post")["id"])

    def test_queues_with_its_fields(self):
        i = self.item
        self.assertEqual((i["kind"], i["account"], i["ai_label"], i["privacy"], i["schedule"]),
                         ("tiktok_post", "@acme.studio", "yes", "public", "2026-11-10"))
        self.assertEqual(i["subject"], "TikTok 1/3: title drop")
        self.assertFalse(add_social("tiktok_post")["changed"])
        for bad in ({"privacy": "everyone"}, {"media": ["a.mp4", "b.mp4"]}, {"media": ["relative.mp4"]},
                    {"media": [str(ROOT / "missing.mp4")]}, {"ai_label": "maybe"}, {"schedule": "next tuesday"},
                    {"account": "not a handle!"}, {"body": ""}):
            with self.assertRaises(outbox.Invalid, msg=bad):
                add_social("tiktok_post", title=f"other {bad}", **bad)
        self.assertTrue(add_social("tiktok_post", title="by url", media=["https://cdn.example.com/v.mp4"])["changed"])

    def test_click_approves_for_tiktok_studio_and_marks_published(self):
        res = outbox_send.send(self.item["id"], approval(self.item))
        self.assertEqual(res["status"], "approved")
        done = outbox.load(self.item["id"])
        self.assertEqual(done["link"], "https://www.tiktok.com/tiktokstudio/upload")
        self.assertIn("AI-generated", done["next_step"])
        self.assertIn("2026-11-10", done["next_step"])
        self.assertEqual(outbox.published(self.item["id"])["item"]["status"], "published")
        self.assertEqual([(r["kind"], r["ok"]) for r in actions_log()], [("tiktok_post", True)])

    def test_edit_caption_only(self):
        outbox.edit(self.item["id"], {"body": "New caption", "title": "New title"})
        cur = outbox.load(self.item["id"])
        self.assertEqual((cur["body"], cur["subject"]), ("New caption", "New title"))
        with self.assertRaises(outbox.Invalid):
            outbox.edit(self.item["id"], {"link": "https://x.example"})

    def test_hash_matches_pulse(self):
        # Same item and constant as ops.rs `social_hashes_match_python`.
        self.assertEqual(sendguard.content_hash(PULSE_TIKTOK_ITEM), PULSE_TIKTOK_HASH)


class YouTube(unittest.TestCase):
    def setUp(self):
        reset()
        if outbox.ACTIONS_LOG.exists():
            outbox.ACTIONS_LOG.unlink()
        self.item = outbox.load(add_social("youtube_upload")["id"])
        self.spawned = []
        self.connected = (True, "Acme Studio")
        import youtube_api
        self.yt = youtube_api
        saved = (youtube_api.connected, youtube_api.creds, outbox_send.subprocess.Popen)
        youtube_api.connected = lambda ch: self.connected
        youtube_api.creds = lambda ch: {"client_id": "c", "client_secret": "s", "refresh_token": "r", "channel_title": "Acme Studio"}
        test = self

        class FakePopen:
            def __init__(self, args, **kw):
                test.spawned.append(args)
                self.stdin = io.BytesIO()
                self.stdin.close = lambda: test.spawned.append(self.stdin.getvalue().decode())
        outbox_send.subprocess.Popen = FakePopen

        def restore():
            youtube_api.connected, youtube_api.creds, outbox_send.subprocess.Popen = saved
        self.addCleanup(restore)

    def fake_net(self, video_id="vid123", privacy="private"):
        calls = []

        def init(token, meta, size, ctype):
            calls.append(("init", token, meta, size, ctype))
            return "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=x"

        def put(session, token, data, start, total):
            calls.append(("put", start, len(data), total))
            return "done", {"id": video_id, "status": {"privacyStatus": privacy}}
        return calls, {"token_fn": lambda c: "ya29.test", "init": init, "put": put}

    def test_defaults_and_validation(self):
        i = self.item
        self.assertEqual((i["privacy"], i["tags"], i["category_id"], i["made_for_kids"], i["ai_altered"], i["channel"]),
                         ("private", ["pixel art", "16-bit"], "10", "no", "no", "acme"))
        for bad in ({"title": "x" * 101}, {"title": "a <b>"}, {"privacy": "friends"}, {"publish_at": "2026-11-10"},
                    {"publish_at": "2026-11-10T09:00", "privacy": "public"}, {"media": ["https://cdn.example.com/v.mp4"]},
                    {"tags": ["x" * 501]}, {"channel": "Bad Name"}):
            with self.assertRaises(outbox.Invalid, msg=bad):
                add_social("youtube_upload", **{"title": "T2", **bad})

    def test_metadata(self):
        meta = self.yt.metadata(self.item)
        self.assertEqual(meta["status"], {"privacyStatus": "private", "selfDeclaredMadeForKids": False, "containsSyntheticMedia": False})
        self.assertEqual(meta["snippet"]["categoryId"], "10")
        sched = dict(self.item, publish_at="2030-01-02T09:30", privacy="private")
        self.assertTrue(self.yt.metadata(sched)["status"]["publishAt"].startswith("2030-01-02T09:30:00"))

    def test_not_connected_refuses_without_spending_the_click(self):
        self.connected = (False, "YouTube channel 'acme' isn't connected; run: python3 ~/portfolio/bin/connect_youtube.py acme")
        appr = approval(self.item)
        with self.assertRaises(outbox.Invalid) as cm:
            outbox_send.send(self.item["id"], appr)
        self.assertIn("connect_youtube.py acme", str(cm.exception))
        self.assertEqual(outbox.load(self.item["id"])["status"], "pending")
        self.assertFalse(sendguard._used(json.loads(json.loads(appr)["payload"])["nonce"]))
        self.assertEqual(self.spawned, [])

    def test_placeholders_block_the_upload(self):
        outbox.edit(self.item["id"], {"body": "Watch the full video: [link to the full video]"})
        item = outbox.load(self.item["id"])
        with self.assertRaises(outbox.Invalid) as cm:
            outbox_send.send(item["id"], approval(item))
        self.assertIn("[link to the full video]", str(cm.exception))

    def test_click_spends_once_and_uploads_in_the_background(self):
        appr = approval(self.item)
        res = outbox_send.send(self.item["id"], appr)
        self.assertEqual((res["ok"], res["status"]), (True, "sending"))
        self.assertEqual(self.spawned[0][-2:], [self.item["id"], "--upload"])
        self.assertEqual(self.spawned[1], appr)          # the approval goes on stdin, never argv
        with self.assertRaises(outbox.Invalid):
            outbox_send.send(self.item["id"], appr)
        calls, net = self.fake_net()
        res = outbox_send.upload_youtube(self.item["id"], appr, **net)
        self.assertTrue(res["ok"], res)
        done = outbox.load(self.item["id"])
        self.assertEqual((done["status"], done["link"], done["result"]["video_id"]), ("published", "https://youtu.be/vid123", "vid123"))
        self.assertEqual(calls[0][1:2] + calls[0][3:], ("ya29.test", 1000, "video/mp4"))
        rows = actions_log()
        self.assertEqual([(r["kind"], r["ok"], r["link"]) for r in rows], [("youtube_upload", True, "https://youtu.be/vid123")])
        self.assertNotIn("ya29", json.dumps(rows) + json.dumps(done))
        # The background step runs once: the item isn't "sending" any more.
        with self.assertRaises(outbox.Invalid):
            outbox_send.upload_youtube(self.item["id"], appr, **net)

    def test_background_step_needs_the_spent_approval(self):
        # An item someone set to "sending" by hand, with a fresh (unspent) approval: refused, nothing uploaded.
        with outbox.locked(self.item["id"]):
            cur = outbox.load(self.item["id"])
            cur["status"] = "sending"
            outbox.save(cur)
        calls, net = self.fake_net()
        res = outbox_send.upload_youtube(self.item["id"], approval(self.item), **net)
        self.assertFalse(res["ok"])
        self.assertEqual(calls, [])
        self.assertEqual(outbox.load(self.item["id"])["status"], "failed")
        with self.assertRaises(outbox.Invalid):
            outbox_send.upload_youtube(add_social("youtube_upload", title="Pending one")["id"], "", **net)

    def test_youtube_locking_it_private_is_explained(self):
        item = outbox.load(add_social("youtube_upload", title="Public one", privacy="public")["id"])
        appr = approval(item)
        outbox_send.send(item["id"], appr)
        calls, net = self.fake_net(privacy="private")
        outbox_send.upload_youtube(item["id"], appr, **net)
        self.assertIn("unaudited", outbox.load(item["id"])["next_step"])

    def test_resumable_upload_follows_the_offset(self):
        VIDEO.write_bytes(b"x" * 100)
        self.yt.CHUNK, saved = 40, self.yt.CHUNK
        self.addCleanup(lambda: setattr(self.yt, "CHUNK", saved))
        seen = []

        def put(session, token, data, start, total):
            seen.append((start, len(data)))
            if len(seen) == 2:
                raise OSError("connection reset")
            if not data:
                return "more", 40
            end = start + len(data)
            return ("done", {"id": "v"}) if end >= total else ("more", end)
        res = self.yt.upload("t", VIDEO, {}, init=lambda *a: "https://www.googleapis.com/s", put=put)
        self.assertEqual(res, {"id": "v"})
        self.assertEqual(seen, [(0, 40), (40, 40), (40, 0), (40, 40), (80, 20)])

    def test_hash_matches_pulse(self):
        # Same item and constant as ops.rs `social_hashes_match_python`.
        self.assertEqual(sendguard.content_hash(PULSE_YOUTUBE_ITEM), PULSE_YOUTUBE_HASH)


# The social items use generic names; ops.rs `social_hashes_match_python` must carry the same
# items and constants (update both together).
PULSE_TIKTOK_ITEM = {"kind": "tiktok_post", "entity": "acme", "account": "@acme.studio", "title": "TikTok 1/3",
                     "body": "Caption – here", "media": ["/v/clip.mp4"], "ai_label": "yes", "privacy": "public",
                     "schedule": None, "notes": "Cover at 0:04"}
PULSE_YOUTUBE_ITEM = {"kind": "youtube_upload", "entity": "acme", "channel": "acme", "title": "The Game Cut",
                      "body": "Description", "tags": ["pixel art", "16-bit"], "privacy": "private",
                      "publish_at": "2026-11-10T09:00", "category_id": "10", "made_for_kids": "no",
                      "ai_altered": "no", "media": ["/v/cut.mp4"], "notes": None}


PULSE_TIKTOK_HASH = "6213203037b5d84071d261c04c1cd46584d498a54fe990df2d41c815d1f68754"
PULSE_YOUTUBE_HASH = "60a7c330306fe8a5553f840bfc724454c96bd8d5510af99a2cdb21eea8313095"
PULSE_RESEND_HASH = "bcd033d861be93f7e61a9d4f24d6696758142c75a56bb5b04dc36850bddd1f5a"


class OauthSmtpTest(unittest.TestCase):
    """Gmail drops an XOAUTH2 sign-in sent before EHLO; a refused sign-in must stop the send."""

    def run_send(self, says_hello):
        import types
        calls = []

        class FakeSMTP:
            def __init__(self, *a, **k): pass
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def ehlo(self):
                if says_hello:
                    calls.append("ehlo")
            def auth(self, mech, obj, initial_response_ok=False):
                calls.append("auth")
                return (235, b"ok") if "ehlo" in calls else (503, b"EHLO first")
            def send_message(self, *a, **k):
                calls.append("send")
                return {}

        fake = types.SimpleNamespace(access_token_for=lambda *a: ("tok", None), xoauth2_string=lambda a, t: "x")
        real_ssl, real_mod = outbox_send.smtplib.SMTP_SSL, sys.modules.get("oauth_google")
        outbox_send.smtplib.SMTP_SSL, sys.modules["oauth_google"] = FakeSMTP, fake
        try:
            REAL_SMTP_SEND({"id": "studio", "address": "a@b.c", "host": "imap.gmail.com", "auth": "oauth"}, None, ["x@y.z"])
        finally:
            outbox_send.smtplib.SMTP_SSL = real_ssl
            if real_mod is not None:
                sys.modules["oauth_google"] = real_mod
            else:
                sys.modules.pop("oauth_google", None)
        return calls

    def test_says_hello_before_signing_in(self):
        self.assertEqual(self.run_send(True), ["ehlo", "auth", "send"])

    def test_refused_sign_in_stops_the_send(self):
        with self.assertRaises(outbox_send.smtplib.SMTPAuthenticationError):
            self.run_send(False)


class EmailAccounts(unittest.TestCase):
    """Mailboxes come from portfolio.json; the optional tracker is absent-safe; no network."""

    def setUp(self):
        reset()
        import email_accounts
        self.ea = email_accounts
        self.tracker = pathlib.Path(tempfile.mkdtemp(prefix="no-tracker-"))
        self.old_tracker = email_accounts.TRACKER
        email_accounts.TRACKER = self.tracker
        self.addCleanup(lambda: setattr(email_accounts, "TRACKER", self.old_tracker))

    def test_accounts_from_the_registry(self):
        acct = self.ea.account("studio")
        self.assertEqual((acct["address"], acct["imap_host"], acct["source"]), ("owner@example.com", "imap.gmail.com", "portfolio"))
        self.assertEqual(self.ea.ids(), ["studio"])
        with self.assertRaises(self.ea.Unknown):
            self.ea.account("nobody")

    def test_unknown_account_is_refused_when_queuing(self):
        with self.assertRaises(outbox.Invalid) as cm:
            add(account="nobody")
        self.assertIn("studio", str(cm.exception))

    def test_tracker_accounts_fill_in(self):
        (self.tracker / "accounts.json").write_text(json.dumps({"accounts": [
            {"id": "side", "address": "side@example.org", "host": "imap.example.org"},
            {"id": "studio", "address": "other@example.org"}]}))
        self.assertEqual(self.ea.ids(), ["side", "studio"])
        self.assertEqual(self.ea.account("studio")["address"], "owner@example.com")    # the registry wins
        self.assertEqual(self.ea.account("side")["imap_host"], "imap.example.org")

    def test_draft_without_a_password_is_skipped_not_raised(self):
        import types
        fake = types.ModuleType("keyring_store")
        fake.fetch = lambda name: None
        saved = sys.modules.get("keyring_store")
        sys.modules["keyring_store"] = fake
        self.addCleanup(lambda: sys.modules.__setitem__("keyring_store", saved) if saved else sys.modules.pop("keyring_store", None))
        opened = []

        class FakeIMAP:
            def __init__(self, *a, **k):
                opened.append(a)

            def login(self, *a):
                raise AssertionError("no password, so no login")

        real = self.ea.imaplib.IMAP4_SSL
        self.ea.imaplib.IMAP4_SSL = FakeIMAP
        self.addCleanup(lambda: setattr(self.ea.imaplib, "IMAP4_SSL", real))
        res = add(draft=True)
        item = outbox.load(res["id"])
        self.assertFalse(item["draft"]["saved"])
        self.assertIn("keyring_store.py set studio", item["draft"]["error"])
        self.assertEqual(item["status"], "pending")
        self.assertEqual(opened, [])        # never even connected


if __name__ == "__main__":
    unittest.main(verbosity=1)

