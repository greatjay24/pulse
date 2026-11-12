#!/usr/bin/env python3
"""Stripe for agents, with an entity's scoped agent key (Keychain "stripe:<entity>").

Reads
    stripe_agent.py <entity> balance
    stripe_agent.py <entity> invoices [--status draft|open|paid|void|uncollectible] [--limit 10]
    stripe_agent.py <entity> charges|payouts|quotes|subscriptions|products [--limit 10]
    stripe_agent.py <entity> prices [--product prod_...]
    stripe_agent.py <entity> customer find (--email a@b.com | --name "Northwind")
Records and drafts (nothing reaches a client; nothing moves money)
    stripe_agent.py <entity> customer create --name "Northwind Co" --email ap@northwind.example [--description ...]
    stripe_agent.py <entity> product create --name "Website care" [--description ...]
    stripe_agent.py <entity> price create --product prod_... --amount 250.00 [--currency usd] [--interval month]
    stripe_agent.py <entity> invoice draft --customer cus_... --line "Website build:1200.00[:qty]" \
        [--price price_...:qty] (--due YYYY-MM-DD | --days-until-due 30) [--memo "..."] [--why "..."]
    stripe_agent.py <entity> quote draft --customer cus_... --price price_...:qty [...] \
        [--expires-days 30] [--memo "..."] [--why "..."]
    stripe_agent.py <entity> payment-link create --price price_...:qty [...]
Queued for the owner's one click in Roo (the Outbox), never done here
    stripe_agent.py <entity> invoice send in_... --why "..."            finalize + email the invoice
    stripe_agent.py <entity> quote send qt_... --why "..."              finalize the quote
    stripe_agent.py <entity> refund request --charge ch_|pi_ --amount 20.00 \
        [--reason requested_by_customer|duplicate|fraudulent] --why "..."
    stripe_agent.py <entity> subscription request --customer cus_... --price price_...:qty [...] \
        [--subscription sub_... to change one] [--days-until-due 30] --why "..."
    stripe_agent.py <entity> charge request --customer cus_... --amount 250.00 --description "..." \
        [--currency usd] [--payment-method pm_...] [--statement-descriptor-suffix "..."] --why "..."
                                                                        charge their saved card
`invoice draft` and `quote draft` with --why also queue the send in the same step.
Add --created-by <agent name> to anything that queues.

It never finalizes, sends, voids or pays an invoice, finalizes or accepts a quote, refunds,
starts, changes or cancels a subscription, charges a card, transfers or pays out. Those calls are refused in
stripe_api.py before any connection opens; the queued item runs them only after the owner's
click (outbox_send.py). Stripe-side approval rules may still hold a send after that.

Amounts on the command line are in major units (12.50); Stripe and the Outbox use minor units.
Prints one JSON line. Never prints the key.
"""
import argparse, decimal, json, pathlib, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import stripe_api  # noqa: E402
from stripe_api import NotAllowed, StripeError  # noqa: E402

ZERO_DECIMAL = {"bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg",
                "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"}
FORBIDDEN = {
    ("invoice", "finalize"), ("invoice", "pay"), ("invoice", "void"), ("invoice", "mark-uncollectible"),
    ("quote", "finalize"), ("quote", "accept"), ("quote", "cancel"),
    ("refund", "create"), ("subscription", "create"), ("subscription", "update"), ("subscription", "cancel"),
    ("charge", "create"),
    ("transfer", "create"), ("payout", "create"),
}


class Usage(ValueError):
    pass


def minor(amount, currency):
    try:
        d = decimal.Decimal(str(amount))
    except decimal.InvalidOperation:
        raise Usage(f"not an amount: {amount}")
    if d <= 0:
        raise Usage("amounts must be positive")
    n = d if currency.lower() in ZERO_DECIMAL else d * 100
    if n != n.to_integral_value():
        raise Usage(f"too many decimals: {amount}")
    return int(n)


def money(n, currency):
    cur = (currency or "usd").lower()
    v = n if cur in ZERO_DECIMAL else n / 100
    return f"{v:,.0f} {cur.upper()}" if cur in ZERO_DECIMAL else (f"${v:,.2f}" if cur == "usd" else f"{v:,.2f} {cur.upper()}")


def price_qty(s):
    p, _, q = s.partition(":")
    if not p.startswith("price_"):
        raise Usage(f"--price is price_...:quantity, got {s}")
    try:
        q = int(q or 1)
    except ValueError:
        raise Usage(f"bad quantity in {s}")
    if not 1 <= q <= 100000:
        raise Usage(f"bad quantity in {s}")
    return p, q


class Agent:
    def __init__(self, entity, call=None):
        self.entity = entity
        self.call = call or (lambda m, p, params=None, idem=None: stripe_api.agent_call(entity, m, p, params, idem))

    # ---------- reads ----------
    def lst(self, path, params, fields):
        page = self.call("GET", path, params)
        return {"ok": True, "has_more": page.get("has_more", False),
                "data": [{k: o.get(k) for k in fields} for o in page.get("data", [])]}

    def balance(self):
        b = self.call("GET", "/balance")
        pick = lambda rows: [{"amount": r.get("amount"), "currency": r.get("currency"),
                              "display": money(r.get("amount") or 0, r.get("currency"))} for r in rows or []]
        return {"ok": True, "livemode": b.get("livemode"), "available": pick(b.get("available")),
                "pending": pick(b.get("pending"))}

    def customer_label(self, cid):
        c = self.call("GET", f"/customers/{cid}")
        return " ".join(x for x in (c.get("name"), f"<{c['email']}>" if c.get("email") else None) if x) or cid

    # ---------- drafts ----------
    def invoice_draft(self, customer, lines, prices, due, days, memo, currency="usd"):
        if not lines and not prices:
            raise Usage("an invoice needs at least one --line or --price")
        if bool(due) == bool(days):
            raise Usage("give exactly one of --due or --days-until-due")
        params = {"customer": customer, "collection_method": "send_invoice", "auto_advance": False,
                  "currency": currency, "description": memo or None}
        if due:
            import datetime
            try:
                params["due_date"] = int(datetime.datetime.strptime(due, "%Y-%m-%d").replace(hour=23, minute=59).timestamp())
            except ValueError:
                raise Usage("--due is YYYY-MM-DD")
        else:
            params["days_until_due"] = days
        inv = self.call("POST", "/invoices", params)
        for line in lines:
            parts = line.rsplit(":", 2)
            if len(parts) == 3 and parts[2].isdigit():
                desc, amt, qty = parts[0], parts[1], int(parts[2])
            else:
                desc, _, amt = line.rpartition(":")
                qty = 1
            if not desc.strip():
                raise Usage(f'--line is "description:amount[:qty]", got {line}')
            unit = minor(amt, currency)
            self.call("POST", "/invoiceitems", {"customer": customer, "invoice": inv["id"], "currency": currency,
                                                "description": desc.strip()[:500],
                                                **({"amount": unit} if qty == 1 else {"unit_amount": unit, "quantity": qty})})
        for p, q in map(price_qty, prices):
            self.call("POST", "/invoiceitems", {"customer": customer, "invoice": inv["id"], "price": p, "quantity": q})
        inv = self.call("GET", f"/invoices/{inv['id']}")
        return {"ok": True, "invoice": inv["id"], "status": inv.get("status"), "amount_due": inv.get("amount_due"),
                "display": money(inv.get("amount_due") or 0, inv.get("currency")), "customer": inv.get("customer")}

    def quote_draft(self, customer, prices, expires_days, memo):
        if not prices:
            raise Usage("a quote needs at least one --price")
        import time
        params = {"customer": customer, "description": memo or None,
                  "line_items": [{"price": p, "quantity": q} for p, q in map(price_qty, prices)],
                  "collection_method": "send_invoice", "invoice_settings": {"days_until_due": 30},
                  "expires_at": int(time.time()) + 86400 * expires_days if expires_days else None}
        q = self.call("POST", "/quotes", params)
        return {"ok": True, "quote": q["id"], "status": q.get("status"), "amount_total": q.get("amount_total"),
                "display": money(q.get("amount_total") or 0, q.get("currency")), "customer": q.get("customer")}

    def payment_link(self, prices):
        if not prices:
            raise Usage("a payment link needs at least one --price")
        pl = self.call("POST", "/payment_links", {"line_items": [{"price": p, "quantity": q} for p, q in map(price_qty, prices)]})
        return {"ok": True, "payment_link": pl["id"], "url": pl.get("url"), "active": pl.get("active")}

    # ---------- queued for the owner ----------
    def _queue(self, kind, fields, why, created_by):
        import outbox_add
        return outbox_add.add_kind(kind, self.entity, why, created_by, fields)

    def queue_invoice(self, iid, why, created_by):
        inv = self.call("GET", f"/invoices/{iid}")
        if inv.get("status") != "draft":
            raise Usage(f"{iid} is {inv.get('status')}, not a draft")
        if inv.get("collection_method") != "send_invoice":
            raise Usage(f"{iid} charges automatically; only send_invoice drafts can be queued")
        if not inv.get("amount_due"):
            raise Usage(f"{iid} has nothing due")
        lines = self.call("GET", f"/invoices/{iid}/lines", {"limit": 50}).get("data", [])
        cur = inv.get("currency")
        import datetime
        due = datetime.date.fromtimestamp(inv["due_date"]).isoformat() if inv.get("due_date") else None
        who = self.customer_label(inv["customer"])
        body = "\n".join([f"{l.get('description') or 'Line'}  {money(l.get('amount') or 0, cur)}" for l in lines]
                         + ([f"Due {due}"] if due else []) + ([f"Memo: {inv['description']}"] if inv.get("description") else []))
        res = self._queue("stripe_send_invoice", {
            "stripe_id": iid, "customer_id": inv["customer"], "customer": who, "amount": inv["amount_due"],
            "currency": cur, "due_date": due, "subject": f"Invoice {money(inv['amount_due'], cur)} to {who}",
            "body": body}, why, created_by)
        return {**res, "queued": "stripe_send_invoice"}

    def queue_quote(self, qid, why, created_by):
        q = self.call("GET", f"/quotes/{qid}")
        if q.get("status") != "draft":
            raise Usage(f"{qid} is {q.get('status')}, not a draft")
        lines = self.call("GET", f"/quotes/{qid}/line_items", {"limit": 50}).get("data", [])
        cur = q.get("currency")
        who = self.customer_label(q["customer"])
        body = "\n".join([f"{l.get('description') or 'Line'} x{l.get('quantity') or 1}  {money(l.get('amount_total') or 0, cur)}" for l in lines]
                         + ([f"Memo: {q['description']}"] if q.get("description") else []))
        res = self._queue("stripe_send_quote", {
            "stripe_id": qid, "customer_id": q["customer"], "customer": who, "amount": q.get("amount_total"),
            "currency": cur, "subject": f"Quote {money(q.get('amount_total') or 0, cur)} to {who}", "body": body},
            why, created_by)
        return {**res, "queued": "stripe_send_quote"}

    def queue_refund(self, target, amount, reason, why, created_by):
        if target.startswith("ch_"):
            ch = self.call("GET", f"/charges/{target}")
            cur, left, cus = ch.get("currency"), (ch.get("amount") or 0) - (ch.get("amount_refunded") or 0), ch.get("customer")
            payer = (ch.get("billing_details") or {}).get("name") or ch.get("receipt_email") or ""
        elif target.startswith("pi_"):
            pi = self.call("GET", f"/payment_intents/{target}")
            cur, left, cus, payer = pi.get("currency"), pi.get("amount_received") or 0, pi.get("customer"), ""
        else:
            raise Usage("--charge is a ch_ or pi_ id")
        n = minor(amount, cur)
        if n > left:
            raise Usage(f"only {money(left, cur)} is left to refund on {target}")
        who = self.customer_label(cus) if cus else (payer or target)
        res = self._queue("stripe_refund", {
            "stripe_id": target, "customer_id": cus, "customer": who, "amount": n, "currency": cur,
            "reason": reason, "subject": f"Refund {money(n, cur)} to {who}",
            "body": f"Refund {money(n, cur)} of {target}" + (f" ({reason.replace('_', ' ')})" if reason else "")},
            why, created_by)
        return {**res, "queued": "stripe_refund"}

    def queue_subscription(self, customer, prices, sub, days, why, created_by):
        wanted = list(map(price_qty, prices))
        if not wanted:
            raise Usage("a subscription needs at least one --price")
        total, cur, intervals, lines = 0, None, set(), []
        for p, q in wanted:
            pr = self.call("GET", f"/prices/{p}")
            if not pr.get("recurring") or pr.get("unit_amount") is None:
                raise Usage(f"{p} is not a fixed recurring price")
            if cur and pr["currency"] != cur:
                raise Usage("all prices must share one currency")
            cur = pr["currency"]
            total += pr["unit_amount"] * q
            intervals.add(pr["recurring"]["interval"])
            lines.append(f"{pr.get('nickname') or p} x{q}  {money(pr['unit_amount'] * q, cur)}/{pr['recurring']['interval']}")
        if len(intervals) != 1:
            raise Usage("all prices must bill on the same interval")
        interval = intervals.pop()
        if sub:
            s = self.call("GET", f"/subscriptions/{sub}")
            if s.get("customer") != customer:
                raise Usage(f"{sub} belongs to another customer")
            before = [f"{si['price'].get('nickname') or si['price']['id']} x{si.get('quantity', 1)}"
                      for si in (s.get("items") or {}).get("data", [])]
            lines = ["Now: " + (", ".join(before) or "nothing"), "After:"] + lines
        who = self.customer_label(customer)
        verb = "Change subscription" if sub else "Start subscription"
        res = self._queue("stripe_subscription", {
            "action": "update" if sub else "create", "stripe_id": sub, "customer_id": customer, "customer": who,
            "items": [f"{p}:{q}" for p, q in wanted], "amount": total, "currency": cur, "interval": interval,
            "days_until_due": days, "subject": f"{verb}: {money(total, cur)}/{interval} for {who}",
            "body": "\n".join(lines + ([] if sub else [f"Invoices emailed, due in {days or 30} days"]))},
            why, created_by)
        return {**res, "queued": "stripe_subscription"}

    def queue_charge(self, customer, amount, currency, description, pm, suffix, why, created_by):
        """Queue a charge of `amount` (minor units) on the customer's saved card. Reads the
        customer and their cards so the owner sees exactly which card; the click re-checks both."""
        cur = (currency or "usd").lower()
        if isinstance(amount, bool) or not isinstance(amount, int) or amount < 50:
            raise Usage("amount is in minor units, at least 50")
        c = self.call("GET", f"/customers/{customer}")
        cards = self.call("GET", f"/customers/{customer}/payment_methods", {"type": "card", "limit": 100}).get("data", [])
        card = stripe_api.pick_card(c, cards, pm)
        who = " ".join(x for x in (c.get("name"), f"<{c['email']}>" if c.get("email") else None) if x) or customer
        label = stripe_api.card_label(card)
        res = self._queue("stripe_charge", {
            "customer_id": customer, "customer": who, "payment_method": card["id"], "card": label,
            "amount": amount, "currency": cur, "description": description, "statement_descriptor_suffix": suffix,
            "subject": f"Charge {money(amount, cur)} to {who}",
            "body": f"{description}\nCard: {label}" + (f"\nStatement: ...{suffix}" if suffix else "")},
            why, created_by)
        return {**res, "queued": "stripe_charge", "card": label}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entity")
    ap.add_argument("noun")
    ap.add_argument("verb", nargs="?")
    ap.add_argument("target", nargs="?")
    for flag in ("--email", "--name", "--description", "--product", "--currency", "--interval", "--customer",
                 "--due", "--memo", "--why", "--charge", "--reason", "--subscription", "--status", "--amount",
                 "--payment-method", "--statement-descriptor-suffix"):
        ap.add_argument(flag)
    ap.add_argument("--line", action="append", default=[])
    ap.add_argument("--price", action="append", default=[])
    ap.add_argument("--days-until-due", type=int)
    ap.add_argument("--expires-days", type=int)
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--created-by", default="agent")
    a = ap.parse_args(argv)
    try:
        res = run(Agent(a.entity), a)
    except (Usage, NotAllowed) as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 2
    except StripeError as e:
        print(json.dumps({"ok": False, "error": f"Stripe {e.status}: {e}"}))
        return 1
    except ValueError as e:      # outbox.Invalid
        print(json.dumps({"ok": False, "error": str(e)}))
        return 2
    print(json.dumps(res, ensure_ascii=False))
    return 0


def run(ag, a):
    n, v = a.noun, a.verb
    lim = {"limit": max(1, min(a.limit, 100))}
    if (n, v) in FORBIDDEN:
        raise NotAllowed(f"agents don't {n} {v}. Queue it for the owner instead: see `stripe_agent.py --help` "
                         "(invoice send / quote send / refund request / subscription request, with --why).")
    if n == "balance":
        return ag.balance()
    if n == "invoices":
        return ag.lst("/invoices", {**lim, "status": a.status}, ["id", "status", "customer", "amount_due", "amount_paid",
                                                                 "currency", "due_date", "number", "hosted_invoice_url"])
    if n == "charges":
        return ag.lst("/charges", lim, ["id", "amount", "amount_refunded", "currency", "status", "created", "customer", "description"])
    if n == "payouts":
        return ag.lst("/payouts", lim, ["id", "amount", "currency", "status", "arrival_date", "created"])
    if n == "quotes":
        return ag.lst("/quotes", lim, ["id", "status", "customer", "amount_total", "currency", "number", "expires_at"])
    if n == "subscriptions":
        return ag.lst("/subscriptions", lim, ["id", "status", "customer", "current_period_end", "cancel_at_period_end"])
    if n == "products":
        return ag.lst("/products", lim, ["id", "name", "active", "description"])
    if n == "prices":
        return ag.lst("/prices", {**lim, "product": a.product}, ["id", "product", "unit_amount", "currency", "recurring", "nickname", "active"])
    if n == "customer" and v == "find":
        if a.email:
            return ag.lst("/customers", {**lim, "email": a.email.lower()}, ["id", "name", "email"])
        if a.name:
            q = a.name.replace("'", "")
            return ag.lst("/customers/search", {**lim, "query": f"name~'{q}'"}, ["id", "name", "email"])
        raise Usage("customer find needs --email or --name")
    if n == "customer" and v == "create":
        if not a.name and not a.email:
            raise Usage("customer create needs --name and/or --email")
        if a.email:
            seen = ag.call("GET", "/customers", {"email": a.email.lower(), "limit": 1}).get("data", [])
            if seen:
                return {"ok": True, "customer": seen[0]["id"], "created": False, "reason": "a customer with that email exists"}
        c = ag.call("POST", "/customers", {"name": a.name, "email": a.email and a.email.lower(), "description": a.description})
        return {"ok": True, "customer": c["id"], "created": True}
    if n == "product" and v == "create":
        if not a.name:
            raise Usage("product create needs --name")
        p = ag.call("POST", "/products", {"name": a.name, "description": a.description})
        return {"ok": True, "product": p["id"]}
    if n == "price" and v == "create":
        if not (a.product and a.amount):
            raise Usage("price create needs --product and --amount")
        cur = (a.currency or "usd").lower()
        p = ag.call("POST", "/prices", {"product": a.product, "currency": cur, "unit_amount": minor(a.amount, cur),
                                        "recurring": {"interval": a.interval} if a.interval else None})
        return {"ok": True, "price": p["id"], "display": money(p.get("unit_amount") or 0, cur)}
    if n == "invoice" and v == "draft":
        if not a.customer:
            raise Usage("invoice draft needs --customer cus_...")
        res = ag.invoice_draft(a.customer, a.line, a.price, a.due, a.days_until_due, a.memo, (a.currency or "usd").lower())
        if a.why:
            res["outbox"] = ag.queue_invoice(res["invoice"], a.why, a.created_by)
        return res
    if n == "invoice" and v == "send":
        if not (a.target and a.why):
            raise Usage("invoice send in_... --why '...'")
        return ag.queue_invoice(a.target, a.why, a.created_by)
    if n == "quote" and v == "draft":
        if not a.customer:
            raise Usage("quote draft needs --customer cus_...")
        res = ag.quote_draft(a.customer, a.price, a.expires_days, a.memo)
        if a.why:
            res["outbox"] = ag.queue_quote(res["quote"], a.why, a.created_by)
        return res
    if n == "quote" and v == "send":
        if not (a.target and a.why):
            raise Usage("quote send qt_... --why '...'")
        return ag.queue_quote(a.target, a.why, a.created_by)
    if n == "payment-link" and v == "create":
        return ag.payment_link(a.price)
    if n == "refund" and v == "request":
        if not (a.charge and a.amount and a.why):
            raise Usage("refund request --charge ch_|pi_ --amount 20.00 --why '...'")
        return ag.queue_refund(a.charge, a.amount, a.reason, a.why, a.created_by)
    if n == "subscription" and v == "request":
        if not (a.customer and a.price and a.why):
            raise Usage("subscription request --customer cus_ --price price_:qty --why '...'")
        return ag.queue_subscription(a.customer, a.price, a.subscription, a.days_until_due, a.why, a.created_by)
    if n == "charge" and v == "request":
        if not (a.customer and a.amount and a.description and a.why):
            raise Usage("charge request --customer cus_ --amount 250.00 --description '...' --why '...'")
        cur = (a.currency or "usd").lower()
        return ag.queue_charge(a.customer, minor(a.amount, cur), cur, a.description, a.payment_method,
                               a.statement_descriptor_suffix, a.why, a.created_by)
    raise Usage(f"unknown action: {n} {v or ''}".strip() + " (see --help)")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
