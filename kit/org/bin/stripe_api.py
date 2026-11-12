"""Stripe over HTTPS for the org, stdlib only. Two doors, and only two:

  agent_call(entity, method, path, params)
      What agents may do with an entity's scoped agent key (stripe_agent.py): GET reads,
      and POSTs that create or update drafts and records: customers, products, prices,
      draft invoices and their lines, draft quotes, payment links. Nothing else passes.
      Finalizing or sending an invoice or quote, refunds, subscriptions, transfers,
      payouts and every DELETE are refused here, before any connection opens.

  approved_call(item, approval_text, method, path, params)
      The money and client-facing calls (finalize/send an invoice, finalize a quote,
      refund, create/update a subscription, charge a customer's saved card). Only outbox_send.py uses it, after the
      owner's click in Roo. It re-checks the signed approval (sendguard.check with
      after_burn=True: the signature, the content hash and that this exact approval was
      already spent by outbox_send.py), and that the path is one this item's kind may call.

Keys: the macOS Keychain (service "project-tracker-imap"), through keyring_store.py.
Never printed, never logged, never in argv. Store each once with
`python3 ~/portfolio/bin/keyring_store.py set <name>`:
  stripe:<entity>         the restricted agent key (reads, drafts); agent_call. A full
                          sk_live_ key is refused here.
  stripe-action:<entity>  the action key the owner's click runs with; approved_call only.
Stripe error text can echo part of a key, so errors keep only the gist.
"""
import json, pathlib, re, sys, urllib.error, urllib.parse, urllib.request

API = "https://api.stripe.com/v1"
VERSION = "2024-06-20"

_ID = r"[A-Za-z0-9_]{3,80}"

# POSTs an agent may make. Anchored; ids are Stripe-shaped.
AGENT_POST = [
    r"/customers", rf"/customers/cus_{_ID}",
    r"/products", rf"/products/prod_{_ID}",
    r"/prices", rf"/prices/price_{_ID}",
    r"/invoices", rf"/invoices/in_{_ID}",          # create a draft / update a draft
    r"/invoiceitems", rf"/invoiceitems/ii_{_ID}",
    r"/quotes", rf"/quotes/qt_{_ID}",              # create a draft / update a draft
    r"/payment_links", rf"/payment_links/plink_{_ID}",
]
# GETs an agent may make.
AGENT_GET = [
    r"/balance", r"/balance_transactions",
    r"/customers", rf"/customers/cus_{_ID}", r"/customers/search", rf"/customers/cus_{_ID}/payment_methods",
    rf"/payment_methods/pm_{_ID}",
    r"/products", rf"/products/prod_{_ID}",
    r"/prices", rf"/prices/price_{_ID}",
    r"/invoices", rf"/invoices/in_{_ID}", rf"/invoices/in_{_ID}/lines",
    r"/invoiceitems",
    r"/quotes", rf"/quotes/qt_{_ID}", rf"/quotes/qt_{_ID}/line_items",
    r"/payment_links", rf"/payment_links/plink_{_ID}",
    r"/charges", rf"/charges/ch_{_ID}",
    r"/payment_intents", rf"/payment_intents/pi_{_ID}",
    r"/payouts", rf"/payouts/po_{_ID}",
    r"/refunds", r"/disputes",
    r"/subscriptions", rf"/subscriptions/sub_{_ID}",
]
# What an approved item may call, by kind.
APPROVED = {
    "stripe_send_invoice": [("GET", rf"/invoices/in_{_ID}"), ("POST", rf"/invoices/in_{_ID}/finalize"),
                            ("POST", rf"/invoices/in_{_ID}/send")],
    "stripe_send_quote": [("GET", rf"/quotes/qt_{_ID}"), ("POST", rf"/quotes/qt_{_ID}/finalize")],
    "stripe_refund": [("GET", rf"/charges/ch_{_ID}"), ("GET", rf"/payment_intents/pi_{_ID}"), ("POST", r"/refunds")],
    "stripe_subscription": [("GET", rf"/subscriptions/sub_{_ID}"), ("GET", rf"/prices/price_{_ID}"),
                            ("POST", r"/subscriptions"), ("POST", rf"/subscriptions/sub_{_ID}")],
    "stripe_charge": [("GET", rf"/customers/cus_{_ID}"), ("GET", rf"/customers/cus_{_ID}/payment_methods"),
                      ("POST", r"/payment_intents")],
}


class StripeError(Exception):
    def __init__(self, status, msg, code=None, decline_code=None):
        super().__init__(msg)
        self.status, self.code, self.decline_code = status, code, decline_code


class NotAllowed(Exception):
    pass


def _match(path, patterns):
    return any(re.fullmatch(p, path) for p in patterns)


def key_for(entity):
    """The entity's agent key from the Keychain. Raises if there is none."""
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,39}", entity or ""):
        raise NotAllowed("bad entity id")
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import keyring_store
    key = keyring_store.fetch(f"stripe:{entity}")
    if not key:
        raise NotAllowed(f"no Stripe key for {entity} (Keychain stripe:{entity}): run: python3 ~/portfolio/bin/keyring_store.py set stripe:{entity}")
    if key.startswith("sk_live_"):
        raise NotAllowed(f"stripe:{entity} is a full secret key; agents use the restricted agent key")
    return key


ACTION_KEY = "stripe-action:{}"


def action_key_for(entity):
    """The entity's action key (stripe-action:<entity>): only approved_call uses it."""
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,39}", entity or ""):
        raise NotAllowed("bad entity id")
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import keyring_store
    name = ACTION_KEY.format(entity)
    key = keyring_store.fetch(name)
    if not key:
        raise NotAllowed(f"no Stripe action key for {entity} (Keychain {name}): "
                         f"run: python3 ~/portfolio/bin/keyring_store.py set {name}")
    if not key.startswith(("rk_", "sk_")):
        raise NotAllowed(f"{name} is not a Stripe secret or restricted key")
    return key


def form(params, prefix=""):
    """Stripe's form encoding: nested dicts and lists become a[b][0][c]=v."""
    out = []
    items = params.items() if isinstance(params, dict) else enumerate(params)
    for k, v in items:
        name = f"{prefix}[{k}]" if prefix else str(k)
        if v is None:
            continue
        if isinstance(v, (dict, list)):
            out += form(v, name)
        elif isinstance(v, bool):
            out.append((name, "true" if v else "false"))
        else:
            out.append((name, str(v)))
    return out


def _http(key, method, path, params=None, idem=None):
    """The one network function. Tests replace it."""
    data = None
    url = f"{API}{path}"
    pairs = form(params or {})
    if method == "GET":
        if pairs:
            url += "?" + urllib.parse.urlencode(pairs)
    else:
        data = urllib.parse.urlencode(pairs).encode()
    headers = {"Authorization": f"Bearer {key}", "Stripe-Version": VERSION,
               "User-Agent": "portfolio-agent/1.0"}
    if idem:
        headers["Idempotency-Key"] = idem
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read()).get("error", {})
        except Exception:
            err = {}
        msg = (err.get("message") or "").split(" rk_")[0].split(" sk_")[0][:160]
        raise StripeError(e.code, msg or f"HTTP {e.code}", err.get("code"), err.get("decline_code"))


def card_label(pm):
    """"Visa •••• 4242, exp 04/28" for a card PaymentMethod."""
    card = pm.get("card") or {}
    exp = f", exp {card['exp_month']:02d}/{card['exp_year'] % 100:02d}" if card.get("exp_month") and card.get("exp_year") else ""
    return f"{(card.get('brand') or 'card').replace('_', ' ').title()} •••• {card.get('last4') or '????'}{exp}"


def pick_card(customer, cards, wanted=None):
    """The card a charge uses: `wanted` (pm_...) if it is one of the customer's cards, else the
    customer's default card, else their only card. Raises NotAllowed with the reason otherwise.
    `cards` is the data of GET /customers/<id>/payment_methods?type=card."""
    if customer.get("deleted"):
        raise NotAllowed(f"{customer.get('id')} was deleted in Stripe")
    cards = [c for c in cards if c.get("type") == "card" and c.get("customer") in (None, customer.get("id"))]
    by_id = {c["id"]: c for c in cards}
    if wanted:
        if wanted not in by_id:
            raise NotAllowed(f"{wanted} is not a card saved on {customer.get('id')}")
        return by_id[wanted]
    default = (customer.get("invoice_settings") or {}).get("default_payment_method")
    default = default.get("id") if isinstance(default, dict) else default
    if default in by_id:
        return by_id[default]
    if len(cards) == 1:
        return cards[0]
    if not cards:
        raise NotAllowed(f"{customer.get('id')} has no card saved")
    raise NotAllowed(f"{customer.get('id')} has {len(cards)} cards and no default: name one with --payment-method pm_...")


def agent_call(entity, method, path, params=None, idem=None):
    if method == "GET":
        if not _match(path, AGENT_GET):
            raise NotAllowed(f"agents can't read {path}")
    elif method == "POST":
        if not _match(path, AGENT_POST):
            raise NotAllowed(f"agents can't call POST {path}: it moves money or reaches a client; "
                             "queue it for the owner (stripe_agent.py ... --why)")
    else:
        raise NotAllowed(f"agents never {method}")
    return _http(key_for(entity), method, path, params, idem)


def approved_call(item, approval_text, method, path, params=None, idem=None):
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import sendguard
    sendguard.check(approval_text, item, after_burn=True)
    allowed = APPROVED.get(item.get("kind"), [])
    if not any(m == method and re.fullmatch(p, path) for m, p in allowed):
        raise NotAllowed(f"{item.get('kind')} can't call {method} {path}")
    return _http(action_key_for(item["entity"]), method, path, params, idem)
