#!/usr/bin/env python3
"""stripe_agent.py + stripe_api.py against a fake Stripe. Nothing reaches the network:
stripe_api._http is replaced, and urllib is booby-trapped in case anything slips past.
Run: python3 bin/test_stripe_agent.py"""
import io, json, os, pathlib, sys, tempfile, unittest
from contextlib import redirect_stdout

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="stripe-agent-test-"))
os.environ["PORTFOLIO_ROOT"] = str(ROOT)
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import outbox, stripe_agent, stripe_api  # noqa: E402

CALLS = []
STATE = {}


def no_network(*a, **k):
    raise AssertionError("a test tried to open a connection")


stripe_api.urllib.request.urlopen = no_network


def fake_http(key, method, path, params=None, idem=None):
    CALLS.append((method, path, params))
    assert key == "rk_test_agent"
    obj = STATE.get((method, path))
    if obj is None:
        raise stripe_api.StripeError(404, f"no fixture for {method} {path}")
    return obj(params) if callable(obj) else obj


REAL_KEY_FOR = stripe_api.key_for
stripe_api._http = fake_http
stripe_api.key_for = lambda entity: "rk_test_agent"


def cli(*argv):
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = stripe_agent.main(list(argv))
    return rc, json.loads(buf.getvalue().strip().splitlines()[-1])


def reset():
    CALLS.clear()
    STATE.clear()
    for p in sorted((ROOT / "outbox").rglob("*"), reverse=True) if (ROOT / "outbox").exists() else []:
        p.unlink()
    (ROOT / "portfolio.json").write_text(json.dumps({"entities": [{"id": "acme", "path": "companies/acme"}]}))
    STATE[("GET", "/customers/cus_TEST123456")] = {"id": "cus_TEST123456", "name": "Northwind Co", "email": "ap@northwind.example"}


class Gate(unittest.TestCase):
    """The allowlist in stripe_api.agent_call: checked before any key is fetched."""

    def setUp(self):
        reset()

    def test_money_and_client_calls_refused(self):
        for method, path in [("POST", "/invoices/in_TEST123456/finalize"), ("POST", "/invoices/in_TEST123456/send"),
                             ("POST", "/invoices/in_TEST123456/pay"), ("POST", "/invoices/in_TEST123456/void"),
                             ("POST", "/quotes/qt_TEST123456/finalize"), ("POST", "/quotes/qt_TEST123456/accept"),
                             ("POST", "/refunds"), ("POST", "/subscriptions"), ("POST", "/subscriptions/sub_TEST123456"),
                             ("POST", "/transfers"), ("POST", "/payouts"), ("DELETE", "/customers/cus_TEST123456"),
                             ("DELETE", "/subscriptions/sub_TEST123456"), ("POST", "/customers/../refunds"),
                             ("GET", "/accounts"), ("POST", "/treasury/outbound_transfers"),
                             ("POST", "/payment_intents"), ("POST", "/payment_intents/pi_TEST123456/confirm"),
                             ("POST", "/charges"), ("POST", "/payment_methods/pm_TEST123456/attach")]:
            with self.assertRaises(stripe_api.NotAllowed, msg=f"{method} {path}"):
                stripe_api.agent_call("acme", method, path, {})
        self.assertEqual(CALLS, [])

    def test_drafts_and_reads_allowed(self):
        STATE[("POST", "/customers")] = {"id": "cus_NEW1234567"}
        STATE[("GET", "/balance")] = {"available": [{"amount": 1234, "currency": "usd"}], "pending": [], "livemode": False}
        stripe_api.agent_call("acme", "POST", "/customers", {"name": "x"})
        stripe_api.agent_call("acme", "GET", "/balance")
        self.assertEqual(len(CALLS), 2)

    def test_cli_refuses_forbidden_verbs(self):
        for argv in (["invoice", "finalize", "in_TEST123456"], ["refund", "create"], ["subscription", "create"],
                     ["subscription", "cancel"], ["transfer", "create"], ["payout", "create"], ["quote", "accept"],
                     ["charge", "create"]):
            rc, out = cli("acme", *argv)
            self.assertEqual(rc, 2, argv)
            self.assertIn("Queue it for the owner", out["error"])
        self.assertEqual(CALLS, [])

    def test_form_encoding(self):
        self.assertEqual(stripe_api.form({"items": [{"price": "p", "quantity": 2}], "auto_advance": False, "x": None,
                                          "metadata": {"a": "b"}}),
                         [("items[0][price]", "p"), ("items[0][quantity]", "2"), ("auto_advance", "false"),
                          ("metadata[a]", "b")])

    def test_key_rules(self):
        import types
        fake = types.ModuleType("keyring_store")
        store = {"stripe:acme": "rk_test_agent", "stripe:full": "sk_live_" + "x" * 20}
        fake.fetch = store.get
        saved = sys.modules.get("keyring_store")
        sys.modules["keyring_store"] = fake
        try:
            self.assertEqual(REAL_KEY_FOR("acme"), "rk_test_agent")
            for bad in ("../etc", "Acme", "", "none-stored", "full"):
                with self.assertRaises(stripe_api.NotAllowed, msg=bad):
                    REAL_KEY_FOR(bad)
        finally:
            if saved is not None:
                sys.modules["keyring_store"] = saved
            else:
                del sys.modules["keyring_store"]


class Actions(unittest.TestCase):
    def setUp(self):
        reset()

    def test_balance_prints_only_amounts(self):
        STATE[("GET", "/balance")] = {"available": [{"amount": 1234, "currency": "usd"}], "pending": [], "livemode": False}
        rc, out = cli("acme", "balance")
        self.assertEqual(rc, 0)
        self.assertEqual(out["available"][0]["display"], "$12.34")
        self.assertNotIn("rk_", json.dumps(out))

    def test_customer_create_reuses_existing(self):
        STATE[("GET", "/customers")] = {"data": [{"id": "cus_TEST123456"}]}
        rc, out = cli("acme", "customer", "create", "--name", "Northwind Co", "--email", "AP@northwind.example")
        self.assertEqual((rc, out["customer"], out["created"]), (0, "cus_TEST123456", False))
        self.assertFalse(any(c[0] == "POST" for c in CALLS))

    def test_price_amount_in_minor_units(self):
        STATE[("POST", "/prices")] = lambda p: {"id": "price_NEW1234567", **p}
        rc, out = cli("acme", "price", "create", "--product", "prod_TEST123456", "--amount", "250.00", "--interval", "month")
        self.assertEqual(rc, 0)
        params = CALLS[-1][2]
        self.assertEqual((params["unit_amount"], params["recurring"]), (25000, {"interval": "month"}))
        rc, out = cli("acme", "price", "create", "--product", "prod_TEST123456", "--amount", "2.505")
        self.assertEqual(rc, 2)

    def draft_fixtures(self):
        inv = {"id": "in_TEST123456", "status": "draft", "customer": "cus_TEST123456", "amount_due": 135000,
               "currency": "usd", "collection_method": "send_invoice", "due_date": 1795000000, "description": "Phase 1"}
        STATE[("POST", "/invoices")] = lambda p: {**inv, "amount_due": 0}
        STATE[("POST", "/invoiceitems")] = lambda p: {"id": "ii_1", **p}
        STATE[("GET", "/invoices/in_TEST123456")] = inv
        STATE[("GET", "/invoices/in_TEST123456/lines")] = {"data": [
            {"description": "Website build", "amount": 120000}, {"description": "Hosting", "amount": 15000}]}

    def test_invoice_draft_never_finalizes_and_can_queue(self):
        self.draft_fixtures()
        rc, out = cli("acme", "invoice", "draft", "--customer", "cus_TEST123456", "--line", "Website build:1200.00",
                      "--line", "Hosting:50:3", "--days-until-due", "30", "--memo", "Phase 1",
                      "--why", "Phase 1 shipped on Monday", "--created-by", "acme-lead")
        self.assertEqual(rc, 0, out)
        create = CALLS[0][2]
        self.assertEqual((create["collection_method"], create["auto_advance"], create["days_until_due"]),
                         ("send_invoice", False, 30))
        items = [c[2] for c in CALLS if c[1] == "/invoiceitems"]
        self.assertEqual(items[0]["amount"], 120000)
        self.assertEqual((items[1]["unit_amount"], items[1]["quantity"]), (5000, 3))
        self.assertFalse(any("finalize" in c[1] or c[1].endswith("/send") for c in CALLS))
        q = outbox.load(out["outbox"]["id"])
        self.assertEqual((q["kind"], q["amount"], q["status"], q["customer_id"]),
                         ("stripe_send_invoice", 135000, "pending", "cus_TEST123456"))
        self.assertIn("$1,350.00", q["subject"])
        self.assertIn("Northwind Co", q["subject"])
        self.assertIn("Website build  $1,200.00", q["body"])

    def test_invoice_draft_needs_one_due_rule(self):
        self.draft_fixtures()
        rc, out = cli("acme", "invoice", "draft", "--customer", "cus_TEST123456", "--line", "x:1")
        self.assertEqual(rc, 2)
        self.assertEqual(CALLS, [])

    def test_queue_refuses_non_drafts(self):
        STATE[("GET", "/invoices/in_TEST123456")] = {"id": "in_TEST123456", "status": "open"}
        rc, out = cli("acme", "invoice", "send", "in_TEST123456", "--why", "x")
        self.assertEqual(rc, 2)
        self.assertEqual(outbox.all_items(), [])

    def test_quote_draft_and_send(self):
        q = {"id": "qt_TEST123456", "status": "draft", "customer": "cus_TEST123456", "amount_total": 60000, "currency": "usd"}
        STATE[("POST", "/quotes")] = lambda p: q
        STATE[("GET", "/quotes/qt_TEST123456")] = q
        STATE[("GET", "/quotes/qt_TEST123456/line_items")] = {"data": [{"description": "Care plan", "quantity": 12, "amount_total": 60000}]}
        rc, out = cli("acme", "quote", "draft", "--customer", "cus_TEST123456", "--price", "price_TEST123456:12",
                      "--expires-days", "14", "--why", "They asked for a yearly quote")
        self.assertEqual(rc, 0, out)
        self.assertEqual(CALLS[0][2]["line_items"], [{"price": "price_TEST123456", "quantity": 12}])
        self.assertEqual(outbox.load(out["outbox"]["id"])["kind"], "stripe_send_quote")

    def test_payment_link(self):
        STATE[("POST", "/payment_links")] = lambda p: {"id": "plink_TEST123456", "url": "https://buy.stripe.com/test", "active": True}
        rc, out = cli("acme", "payment-link", "create", "--price", "price_TEST123456:1")
        self.assertEqual((rc, out["url"]), (0, "https://buy.stripe.com/test"))

    def test_refund_request_queues_and_checks_left(self):
        STATE[("GET", "/charges/ch_TEST123456")] = {"id": "ch_TEST123456", "amount": 10000, "amount_refunded": 2000,
                                                    "currency": "usd", "customer": "cus_TEST123456"}
        rc, out = cli("acme", "refund", "request", "--charge", "ch_TEST123456", "--amount", "90", "--why", "x")
        self.assertEqual(rc, 2)
        self.assertIn("$80.00", out["error"])
        rc, out = cli("acme", "refund", "request", "--charge", "ch_TEST123456", "--amount", "25",
                      "--reason", "requested_by_customer", "--why", "Client cancelled one session")
        self.assertEqual(rc, 0, out)
        item = outbox.load(out["id"])
        self.assertEqual((item["kind"], item["amount"], item["reason"]), ("stripe_refund", 2500, "requested_by_customer"))
        self.assertFalse(any(c[0] == "POST" for c in CALLS))

    def test_subscription_request(self):
        STATE[("GET", "/prices/price_TESTAAAAAA")] = {"id": "price_TESTAAAAAA", "currency": "usd", "unit_amount": 2000,
                                                      "nickname": "Seat", "recurring": {"interval": "month"}}
        STATE[("GET", "/prices/price_TESTYEARLY")] = {"id": "price_TESTYEARLY", "currency": "usd", "unit_amount": 9000,
                                                      "recurring": {"interval": "year"}}
        rc, out = cli("acme", "subscription", "request", "--customer", "cus_TEST123456", "--price", "price_TESTAAAAAA:3",
                      "--why", "Signed the care plan")
        self.assertEqual(rc, 0, out)
        item = outbox.load(out["id"])
        self.assertEqual((item["action"], item["amount"], item["interval"], item["items"]),
                         ("create", 6000, "month", ["price_TESTAAAAAA:3"]))
        rc, out = cli("acme", "subscription", "request", "--customer", "cus_TEST123456", "--price", "price_TESTAAAAAA:1",
                      "--price", "price_TESTYEARLY:1", "--why", "x")
        self.assertEqual(rc, 2)
        self.assertFalse(any(c[0] == "POST" for c in CALLS))

    def card_fixtures(self, default="pm_TESTVISA4242", cards=("pm_TESTVISA4242", "pm_TESTAMEX0005")):
        CARDS = {"pm_TESTVISA4242": {"brand": "visa", "last4": "4242", "exp_month": 4, "exp_year": 2028},
                 "pm_TESTAMEX0005": {"brand": "amex", "last4": "0005", "exp_month": 12, "exp_year": 2030}}
        STATE[("GET", "/customers/cus_TEST123456")] = {"id": "cus_TEST123456", "name": "Northwind Co", "email": "ap@northwind.example",
                                                       "invoice_settings": {"default_payment_method": default}}
        STATE[("GET", "/customers/cus_TEST123456/payment_methods")] = {"data": [
            {"id": pm, "type": "card", "customer": "cus_TEST123456", "card": CARDS[pm]} for pm in cards]}

    def test_charge_request_queues_with_the_default_card(self):
        self.card_fixtures()
        rc, out = cli("acme", "charge", "request", "--customer", "cus_TEST123456", "--amount", "250.00",
                      "--description", "November retainer", "--why", "Retainer due on the 5th")
        self.assertEqual(rc, 0, out)
        item = outbox.load(out["id"])
        self.assertEqual((item["kind"], item["amount"], item["currency"], item["payment_method"], item["card"]),
                         ("stripe_charge", 25000, "usd", "pm_TESTVISA4242", "Visa •••• 4242, exp 04/28"))
        self.assertEqual(item["subject"], "Charge $250.00 to Northwind Co <ap@northwind.example>")
        self.assertFalse(any(c[0] == "POST" for c in CALLS))

    def test_charge_request_picks_or_refuses_a_card(self):
        self.card_fixtures(default=None)
        rc, out = cli("acme", "charge", "request", "--customer", "cus_TEST123456", "--amount", "10",
                      "--description", "x", "--why", "y")
        self.assertEqual(rc, 2)
        self.assertIn("2 cards and no default", out["error"])
        rc, out = cli("acme", "charge", "request", "--customer", "cus_TEST123456", "--amount", "10",
                      "--description", "x", "--payment-method", "pm_TESTAMEX0005", "--why", "y")
        self.assertEqual(rc, 0, out)
        self.assertEqual(outbox.load(out["id"])["card"], "Amex •••• 0005, exp 12/30")
        rc, out = cli("acme", "charge", "request", "--customer", "cus_TEST123456", "--amount", "10",
                      "--description", "x", "--payment-method", "pm_SOMEONEELSE", "--why", "y")
        self.assertEqual(rc, 2)
        self.card_fixtures(default=None, cards=())
        rc, out = cli("acme", "charge", "request", "--customer", "cus_TEST123456", "--amount", "10",
                      "--description", "x", "--why", "y")
        self.assertEqual(rc, 2)
        self.assertIn("no card saved", out["error"])
        # A single card is used even without a default.
        self.card_fixtures(default=None, cards=("pm_TESTAMEX0005",))
        rc, out = cli("acme", "charge", "request", "--customer", "cus_TEST123456", "--amount", "12",
                      "--description", "Single", "--why", "y")
        self.assertEqual((rc, outbox.load(out["id"])["payment_method"]), (0, "pm_TESTAMEX0005"))
        self.assertFalse(any(c[0] == "POST" for c in CALLS))

    def test_source_has_no_money_verbs(self):
        src = (pathlib.Path(__file__).parent / "stripe_agent.py").read_text()
        for word in ('"/refunds"', "/finalize", '"/subscriptions"', "/transfers", '/send"', "DELETE", '"/payment_intents"', "/confirm"):
            self.assertNotIn(word, src.split("def main")[0].split("class Agent")[1], word)


if __name__ == "__main__":
    unittest.main(verbosity=1)
