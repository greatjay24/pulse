"""YouTube uploads for the Outbox, stdlib only. One door:

  approved_upload(item, approval_text)
      Uploads one queued `youtube_upload` item, after the owner's click in Roo. Only
      outbox_send.py calls it (in its background upload step). It re-checks the signed
      approval (sendguard.check with after_burn=True: signature, content hash, and that
      outbox_send.py already spent this exact approval), then does a resumable
      videos.insert with the item's title, description, tags, privacy and schedule.

Credentials: the macOS Keychain (service "project-tracker-imap", account
"youtube:<channel>") through keyring_store.py, a JSON object
{client_id, client_secret, refresh_token, channel_id, channel_title}. Written once by
~/portfolio/bin/connect_youtube.py, where the owner does the Google consent themselves.
Never printed, never logged, never in argv.

Things YouTube decides, not us:
  - A Google Cloud project that hasn't passed the YouTube API audit can only upload
    private videos: YouTube locks them private whatever privacy says. Uploads still work.
  - videos.insert costs 1,600 of the project's 10,000 daily quota units: about 6 a day.
  - Scheduling: privacy "private" plus status.publishAt; YouTube makes it public then.
"""
import datetime, http.client, json, mimetypes, os, pathlib, sys, urllib.error, urllib.parse, urllib.request

TOKEN_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"
CHUNK = 16 * 1024 * 1024        # a multiple of 256 KiB, as resumable uploads require
RETRIES = 4


class YouTubeError(Exception):
    pass


class NotAllowed(Exception):
    pass


def key_name(channel):
    return f"youtube:{channel}"


def creds(channel):
    """The stored connection for a channel, or raise NotAllowed with the fix."""
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import keyring_store
    raw = keyring_store.fetch(key_name(channel))
    fix = f"run: python3 ~/portfolio/bin/connect_youtube.py {channel}"
    if not raw:
        raise NotAllowed(f"YouTube channel '{channel}' isn't connected; {fix}")
    try:
        c = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        raise NotAllowed(f"the Keychain item {key_name(channel)} is malformed; {fix}")
    if not all(c.get(k) for k in ("client_id", "client_secret", "refresh_token")):
        raise NotAllowed(f"the Keychain item {key_name(channel)} is incomplete; {fix}")
    return c


def connected(channel):
    """(True, channel title) or (False, reason). Never raises, never returns secrets."""
    try:
        c = creds(channel)
    except Exception as e:
        return False, str(e)
    return True, c.get("channel_title") or c.get("channel_id") or channel


def _gist(raw, status):
    try:
        err = json.loads(raw)
    except Exception:
        return f"HTTP {status}"
    e = err.get("error")
    if isinstance(e, dict):
        reasons = ",".join(x.get("reason", "") for x in e.get("errors") or [] if isinstance(x, dict))
        return f"HTTP {status}: {(e.get('message') or '')[:200]}" + (f" ({reasons})" if reasons else "")
    return f"HTTP {status}: {e or ''} {(err.get('error_description') or '')[:200]}".strip()


def access_token(c):
    data = urllib.parse.urlencode({"client_id": c["client_id"], "client_secret": c["client_secret"],
                                   "refresh_token": c["refresh_token"], "grant_type": "refresh_token"}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=data), timeout=30) as r:
            tok = json.loads(r.read())
    except urllib.error.HTTPError as e:
        msg = _gist(e.read(), e.code)
        if "invalid_grant" in msg:
            msg += " - the connection expired or was revoked; run connect_youtube.py again"
        raise YouTubeError(msg)
    if not tok.get("access_token"):
        raise YouTubeError("Google returned no access token")
    return tok["access_token"]


def publish_at_rfc3339(local):
    """'2026-11-10T09:00' in this Mac's time zone -> RFC 3339 with its offset."""
    return datetime.datetime.strptime(local, "%Y-%m-%dT%H:%M").astimezone().isoformat()


def metadata(item):
    """The videos.insert body for an item."""
    status = {"privacyStatus": item.get("privacy") or "private",
              "selfDeclaredMadeForKids": item.get("made_for_kids") == "yes",
              "containsSyntheticMedia": item.get("ai_altered") == "yes"}
    if item.get("publish_at"):
        status["privacyStatus"] = "private"
        status["publishAt"] = publish_at_rfc3339(item["publish_at"])
    snippet = {"title": item["title"], "description": item.get("body") or "",
               "categoryId": item.get("category_id") or "22"}
    if item.get("tags"):
        snippet["tags"] = item["tags"]
    return {"snippet": snippet, "status": status}


def video_path(item):
    p = pathlib.Path((item.get("media") or [""])[0])
    if not p.is_absolute() or not p.is_file():
        raise NotAllowed(f"the video file isn't there: {p}")
    return p


def preflight(item, now=None):
    """What would stop an upload, checked before the click spends its approval.
    Returns the channel's title. Raises NotAllowed with the fix."""
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import outbox
    if item.get("kind") != "youtube_upload":
        raise NotAllowed(f"{item.get('kind')} isn't a YouTube upload")
    left = outbox.placeholders(item)
    if left:
        raise NotAllowed("fill in " + ", ".join(left) + " first (Edit)")
    video_path(item)
    if item.get("publish_at"):
        when = datetime.datetime.strptime(item["publish_at"], "%Y-%m-%dT%H:%M").astimezone()
        if when <= (now or datetime.datetime.now().astimezone()) + datetime.timedelta(minutes=15):
            raise NotAllowed("publish_at has passed (or is under 15 minutes away): Edit isn't enough; ask the lead to re-queue it")
    ok, what = connected(item.get("channel") or "")
    if not ok:
        raise NotAllowed(what)
    return what


# ---- the network: three small functions tests replace ----

def _init(token, meta, size, ctype):
    """Start a resumable session. Returns the session URL."""
    body = json.dumps(meta).encode()
    req = urllib.request.Request(UPLOAD_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": str(size), "X-Upload-Content-Type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            loc = r.headers.get("Location")
    except urllib.error.HTTPError as e:
        raise YouTubeError(_gist(e.read(), e.code))
    if not loc or not loc.startswith("https://www.googleapis.com/"):
        raise YouTubeError("YouTube didn't return an upload session")
    return loc


def _put(session, token, data, start, total):
    """Send bytes [start, start+len(data)). Returns ("done", video json) or ("more", next offset)."""
    u = urllib.parse.urlsplit(session)
    conn = http.client.HTTPSConnection(u.netloc, timeout=300)
    try:
        headers = {"Authorization": f"Bearer {token}", "Content-Length": str(len(data))}
        headers["Content-Range"] = f"bytes {start}-{start + len(data) - 1}/{total}" if data else f"bytes */{total}"
        conn.request("PUT", u.path + ("?" + u.query if u.query else ""), body=data, headers=headers)
        r = conn.getresponse()
        raw = r.read()
        if r.status in (200, 201):
            return "done", json.loads(raw or b"{}")
        if r.status == 308:
            rng = r.getheader("Range")       # "bytes=0-1234"
            return "more", int(rng.rsplit("-", 1)[1]) + 1 if rng else 0
        raise YouTubeError(_gist(raw, r.status))
    finally:
        conn.close()


def upload(token, path, meta, init=None, put=None):
    init, put = init or _init, put or _put
    size = path.stat().st_size
    ctype = mimetypes.guess_type(path.name)[0] or "video/mp4"
    session = init(token, meta, size, ctype)
    offset, fails = 0, 0
    with open(path, "rb") as f:
        while True:
            f.seek(offset)
            data = f.read(CHUNK)
            try:
                state, res = put(session, token, data, offset, size)
            except (OSError, http.client.HTTPException) as e:
                fails += 1
                if fails > RETRIES:
                    raise YouTubeError(f"upload kept failing: {type(e).__name__}")
                try:
                    state, res = put(session, token, b"", offset, size)   # ask where it got to
                except (OSError, http.client.HTTPException):
                    continue
            if state == "done":
                return res
            if res <= offset and data:
                fails += 1
                if fails > RETRIES:
                    raise YouTubeError("upload stopped making progress")
            offset = res


def approved_upload(item, approval_text, token_fn=None, init=None, put=None):
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import sendguard
    sendguard.check(approval_text, item, after_burn=True)
    if item.get("kind") != "youtube_upload":
        raise NotAllowed(f"{item.get('kind')} doesn't go to YouTube")
    path = video_path(item)
    c = creds(item.get("channel") or "")
    token = (token_fn or access_token)(c)
    res = upload(token, path, metadata(item), init=init, put=put)
    vid = res.get("id")
    if not vid:
        raise YouTubeError("YouTube finished the upload but returned no video id")
    st = res.get("status") or {}
    return {"video_id": vid, "link": f"https://youtu.be/{vid}",
            "studio": f"https://studio.youtube.com/video/{vid}/edit",
            "privacy": st.get("privacyStatus") or item.get("privacy"),
            "publish_at": st.get("publishAt"), "channel": c.get("channel_title")}
