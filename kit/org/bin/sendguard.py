"""The send guard: proof that the owner clicked Send in Roo. Stdlib only.

Why this exists: agents may draft (outbox_add.py) but must never send. outbox_send.py
sends only with a one-time *approval* that Roo signs at the moment of the click.

  key      Roo creates an Ed25519 key pair the first time it needs one. The private
           seed lives in the macOS login Keychain (service "pulse-outbox-send"), created
           by the Roo process itself, so the item's access list trusts only Roo.
           Any other program that asks for it (python, `security`, an agent's shell)
           makes macOS show the owner a password prompt. The public key is written to
           <portfolio>/.cache/outbox/send_key.pub (hex).
  approval Per click, Roo signs one JSON payload:
             {"v":1,"purpose":"outbox-send","id":<item id>,"content":<sha256 of what
              the owner saw>,"nonce":<128-bit random hex>,"exp":<unix seconds>}
           and hands {"payload": <that string>, "sig": <hex>} to outbox_send.py on
           stdin (never argv, so it never shows in `ps`).
  checks   outbox_send.py refuses unless: the signature verifies against send_key.pub;
           purpose and id match; the item's current content hashes to `content` (an
           edit after the click voids it); exp is in the future and at most
           MAX_TTL away; and the nonce was never used (it is burned before sending).

What it does not do: stop a process that is deliberately hostile and already has the
owner's full shell (it could rewrite this file). The hard boundary for agents is their
tool deny list; this guard makes "the owner clicked" a fact the sender can check,
so no agent can reach a send by calling outbox_send.py, by mistake or by instruction.
"""
import hashlib, json, os, pathlib, time

ORG = pathlib.Path(os.environ.get("PORTFOLIO_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
CACHE = ORG / ".cache" / "outbox"
PUBKEY = CACHE / "send_key.pub"
USED = CACHE / "used_nonces.jsonl"
MAX_TTL = 300          # seconds; Roo uses 120
PURPOSE = "outbox-send"


class Refused(Exception):
    pass


# --------------------------------------------------------------------------
# What the owner approves: the exact message, hashed the same way Roo does
# --------------------------------------------------------------------------

# What the owner approves for each non-email kind, in this order. Roo (ops.rs
# HASH_FIELDS) mirrors this table exactly.
HASH_FIELDS = {
    "post": ["channel", "title", "body", "link", "media"],
    "text": ["to", "body"],
    "dm": ["channel", "to", "body", "link"],
    "slack": ["channel", "body", "link"],
    "stripe_send_invoice": ["stripe_id", "customer_id", "amount", "currency", "due_date", "subject", "body"],
    "stripe_send_quote": ["stripe_id", "customer_id", "amount", "currency", "subject", "body"],
    "stripe_refund": ["stripe_id", "amount", "currency", "reason", "subject", "body"],
    "stripe_subscription": ["action", "stripe_id", "customer_id", "items", "amount", "currency",
                            "interval", "days_until_due", "subject", "body"],
    "stripe_charge": ["customer_id", "customer", "payment_method", "card", "amount", "currency",
                      "description", "statement_descriptor_suffix", "subject", "body"],
    "resend_email": ["from", "from_name", "reply_to", "to", "cc", "subject", "body",
                     "in_reply_to", "references"],
    "tiktok_post": ["account", "title", "body", "media", "ai_label", "privacy", "schedule", "notes"],
    "youtube_upload": ["channel", "title", "body", "tags", "privacy", "publish_at", "category_id",
                       "made_for_kids", "ai_altered", "media", "notes"],
}


def _part(v):
    """One field as text: strings as is, integers in decimal, lists joined with U+001F,
    missing as empty. Floats and other types never reach here (outbox.py refuses them)."""
    if v is None:
        return ""
    if isinstance(v, bool):
        raise ValueError("booleans are not hashed")
    if isinstance(v, int):
        return str(v)
    if isinstance(v, list):
        return "\x1f".join(_part(x) for x in v)
    if isinstance(v, str):
        return v
    raise ValueError(f"can't hash a {type(v).__name__}")


def content_hash(item):
    """sha256 hex over the fields that make up the message. Roo (ops.rs) mirrors this.
    Email (no kind, or "email"): the fields below in order, lists joined with ',', separated by
    U+001E (unchanged since the first Outbox). Other kinds: "kind:<kind>", the entity, then
    HASH_FIELDS[kind] in order (see _part), separated by U+001E."""
    kind = item.get("kind") or "email"
    if kind != "email":
        if kind not in HASH_FIELDS:
            raise ValueError(f"unknown kind: {kind}")
        parts = [f"kind:{kind}", item.get("entity") or ""] + [_part(item.get(f)) for f in HASH_FIELDS[kind]]
        return hashlib.sha256("\x1e".join(parts).encode("utf-8")).hexdigest()
    parts = [
        item.get("account") or "",
        ",".join(item.get("to") or []),
        ",".join(item.get("cc") or []),
        item.get("subject") or "",
        item.get("body") or "",
        item.get("in_reply_to") or "",
        " ".join(item.get("references") or []),
    ]
    return hashlib.sha256("\x1e".join(parts).encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# Ed25519 (RFC 8032, section 6 reference code). verify() is what the guard uses;
# sign() exists for tests only.
# --------------------------------------------------------------------------

_p = 2 ** 255 - 19
_q = 2 ** 252 + 27742317777372353535851937790883648493


def _inv(x):
    return pow(x, _p - 2, _p)


_d = -121665 * _inv(121666) % _p
_sqrt_m1 = pow(2, (_p - 1) // 4, _p)


def _sha512(b):
    return hashlib.sha512(b).digest()


def _add(P, Q):
    A, B = (P[1] - P[0]) * (Q[1] - Q[0]) % _p, (P[1] + P[0]) * (Q[1] + Q[0]) % _p
    C, D = 2 * P[3] * Q[3] * _d % _p, 2 * P[2] * Q[2] % _p
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F, G * H, F * G, E * H)


def _mul(s, P):
    Q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            Q = _add(Q, P)
        P = _add(P, P)
        s >>= 1
    return Q


def _equal(P, Q):
    return (P[0] * Q[2] - Q[0] * P[2]) % _p == 0 and (P[1] * Q[2] - Q[1] * P[2]) % _p == 0


def _recover_x(y, sign):
    if y >= _p:
        return None
    x2 = (y * y - 1) * _inv(_d * y * y + 1)
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_p + 3) // 8, _p)
    if (x * x - x2) % _p != 0:
        x = x * _sqrt_m1 % _p
    if (x * x - x2) % _p != 0:
        return None
    if (x & 1) != sign:
        x = _p - x
    return x


_gy = 4 * _inv(5) % _p
_gx = _recover_x(_gy, 0)
_G = (_gx, _gy, 1, _gx * _gy % _p)


def _compress(P):
    zi = _inv(P[2])
    x, y = P[0] * zi % _p, P[1] * zi % _p
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _decompress(s):
    if len(s) != 32:
        return None
    y = int.from_bytes(s, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    return None if x is None else (x, y, 1, x * y % _p)


def _expand(seed):
    h = _sha512(seed)
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return a, h[32:]


def _modq(b):
    return int.from_bytes(_sha512(b), "little") % _q


def public_key(seed):
    return _compress(_mul(_expand(seed)[0], _G))


def sign(seed, msg):
    """Tests only. Roo signs in Rust (ed25519-dalek)."""
    a, prefix = _expand(seed)
    A = _compress(_mul(a, _G))
    r = _modq(prefix + msg)
    Rs = _compress(_mul(r, _G))
    s = (r + _modq(Rs + A + msg) * a) % _q
    return Rs + int.to_bytes(s, 32, "little")


def verify(public, msg, sig):
    if len(public) != 32 or len(sig) != 64:
        return False
    A, R = _decompress(public), _decompress(sig[:32])
    if not A or not R:
        return False
    s = int.from_bytes(sig[32:], "little")
    if s >= _q:
        return False
    h = _modq(sig[:32] + public + msg)
    return _equal(_mul(s, _G), _add(R, _mul(h, A)))


# --------------------------------------------------------------------------
# The check outbox_send.py runs before it opens a connection
# --------------------------------------------------------------------------

def fingerprint(pub):
    return hashlib.sha256(pub).hexdigest()[:16]


def load_pubkey():
    try:
        pub = bytes.fromhex(PUBKEY.read_text().strip())
    except (OSError, ValueError):
        raise Refused("no send key yet: Roo creates it the first time the owner clicks Send")
    if len(pub) != 32:
        raise Refused("send key file is malformed")
    return pub


def _used(nonce, item_id=None):
    """Was this nonce burned (for this item, when item_id is given)?"""
    if not USED.exists():
        return False
    for line in USED.read_text().splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("nonce") == nonce and (item_id is None or row.get("id") == item_id):
            return True
    return False


def check(approval_text, item, now=None, after_burn=False):
    """Validate a Roo approval for this item. Returns the parsed payload, or raises
    Refused. Does not burn the nonce; call burn() right before sending.
    after_burn=True is the second check stripe_api.approved_call makes mid-dispatch: the same
    rules, except the nonce must already be burned for this item (so only an approval that
    outbox_send.py just spent can reach a money call)."""
    now = time.time() if now is None else now
    try:
        approval = json.loads(approval_text or "")
        payload_text, sig_hex = approval["payload"], approval["sig"]
        sig = bytes.fromhex(sig_hex)
        payload = json.loads(payload_text)
    except (ValueError, KeyError, TypeError):
        raise Refused("no valid approval: only Roo's Send button can send")
    pub = load_pubkey()
    if not verify(pub, payload_text.encode("utf-8"), sig):
        raise Refused("approval signature does not verify")
    if not isinstance(payload, dict) or payload.get("v") != 1 or payload.get("purpose") != PURPOSE:
        raise Refused("approval is not an outbox send")
    if payload.get("id") != item.get("id"):
        raise Refused("approval is for a different message")
    try:
        current = content_hash(item)
    except ValueError as e:
        raise Refused(f"can't approve this item: {e}")
    if payload.get("content") != current:
        raise Refused("the message changed after you clicked Send; review it and click again")
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)) or exp < now or exp > now + MAX_TTL:
        raise Refused("approval expired; click Send again")
    nonce = payload.get("nonce")
    if not isinstance(nonce, str) or len(nonce) < 32:
        raise Refused("approval has no nonce")
    if after_burn:
        if not _used(nonce, item.get("id")):
            raise Refused("approval was not spent by the sender")
    elif _used(nonce):
        raise Refused("approval was already used")
    payload["key"] = fingerprint(pub)
    return payload


def burn(payload):
    """Record the nonce as used. Call before the network send so a crash can't replay it."""
    CACHE.mkdir(parents=True, exist_ok=True)
    with USED.open("a") as f:
        f.write(json.dumps({"nonce": payload["nonce"], "id": payload["id"],
                            "at": int(time.time())}) + "\n")
