#!/usr/bin/env python3
"""Connect a YouTube channel to the Outbox, once. The owner runs this themselves; it opens
Google's consent page in the browser and keeps the result in the macOS Keychain.

    python3 ~/portfolio/bin/connect_youtube.py acme --client-file ~/Downloads/client_secret_XXXX.json
    python3 ~/portfolio/bin/connect_youtube.py acme             # again later: reuses the stored client
    python3 ~/portfolio/bin/connect_youtube.py acme --check     # is it connected? (no secrets shown)

Before the first run (5 minutes, in console.cloud.google.com, signed in as the channel owner):
  1. Pick or create a project. APIs & Services > Library: enable "YouTube Data API v3".
  2. OAuth consent screen: External; add yourself as a test user. Then "Publish app"
     (In production) so the connection doesn't expire after 7 days; Google shows an
     "unverified app" warning on the consent page, which is expected for your own app.
  3. Credentials > Create credentials > OAuth client ID > Desktop app. Download the JSON.
  4. Run this with --client-file pointing at that JSON. Pick the Google account that owns
     the channel (for a Brand Account channel, pick the channel when Google asks).

Scopes: youtube.upload (upload videos) and youtube.readonly (read the channel's name, to
show which channel got connected). Nothing here can delete or edit existing videos.

Stores Keychain "youtube:<channel>" (service project-tracker-imap) =
{client_id, client_secret, refresh_token, channel_id, channel_title}. Prints only the
channel's name and id. Until the project passes Google's API audit, YouTube keeps every
API upload private; the owner flips it public in YouTube Studio.
"""
import argparse, base64, hashlib, http.server, json, pathlib, re, secrets, sys, threading, time
import urllib.error, urllib.parse, urllib.request, webbrowser

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import keyring_store  # noqa: E402
import youtube_api  # noqa: E402

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly"
PORT = 8766
REDIRECT = f"http://127.0.0.1:{PORT}/callback"


class _Catch(http.server.BaseHTTPRequestHandler):
    code = state = error = None

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return
        q = urllib.parse.parse_qs(u.query)
        _Catch.code = (q.get("code") or [None])[0]
        _Catch.state = (q.get("state") or [None])[0]
        _Catch.error = (q.get("error") or [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        ok = _Catch.code and not _Catch.error
        self.wfile.write(("<!doctype html><meta charset=utf-8><body style='font-family:system-ui;padding:40px'>"
                          + ("<h2>YouTube connected.</h2><p>Close this tab and go back to the terminal.</p>" if ok
                             else "<h2>Not connected.</h2><p>Go back to the terminal.</p>") + "</body>").encode())

    def log_message(self, *a):
        pass


def load_client(path):
    d = json.loads(pathlib.Path(path).expanduser().read_text())
    c = d.get("installed") or d.get("web") or d
    if not c.get("client_id") or not c.get("client_secret"):
        raise SystemExit("That file has no client_id/client_secret. Download the OAuth client JSON (Desktop app).")
    return {"client_id": c["client_id"], "client_secret": c["client_secret"]}


def stored(channel):
    raw = keyring_store.fetch(youtube_api.key_name(channel))
    try:
        return json.loads(raw) if raw else None
    except json.JSONDecodeError:
        return None


def consent(client):
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": client["client_id"], "redirect_uri": REDIRECT, "response_type": "code", "scope": SCOPES,
        "access_type": "offline", "prompt": "consent select_account", "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256"})
    try:
        srv = http.server.HTTPServer(("127.0.0.1", PORT), _Catch)
    except OSError:
        raise SystemExit(f"Port {PORT} is busy; close whatever holds it and run this again.")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print("Opening Google in your browser. Pick the account that owns the channel and click Allow.")
    print("If nothing opens, paste this link into the browser:\n" + url + "\n")
    webbrowser.open(url)
    deadline = time.time() + 900
    while _Catch.code is None and _Catch.error is None and time.time() < deadline:
        time.sleep(0.3)
    srv.shutdown()
    srv.server_close()
    if _Catch.error:
        raise SystemExit(f"Google said: {_Catch.error}")
    if not _Catch.code:
        raise SystemExit("Timed out waiting for the browser (15 minutes). Run it again.")
    if _Catch.state != state:
        raise SystemExit("The callback didn't come from this run. Run it again.")
    data = urllib.parse.urlencode({"client_id": client["client_id"], "client_secret": client["client_secret"],
                                   "code": _Catch.code, "code_verifier": verifier,
                                   "grant_type": "authorization_code", "redirect_uri": REDIRECT}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(youtube_api.TOKEN_URL, data=data), timeout=30) as r:
            tok = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit("Token exchange failed: " + youtube_api._gist(e.read(), e.code))
    if not tok.get("refresh_token"):
        raise SystemExit("Google returned no refresh token. Remove the app at myaccount.google.com/permissions and run this again.")
    return tok


def my_channel(access_token):
    req = urllib.request.Request("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
                                 headers={"Authorization": f"Bearer {access_token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            items = json.loads(r.read()).get("items") or []
    except urllib.error.HTTPError as e:
        raise SystemExit("Connected, but reading the channel failed: " + youtube_api._gist(e.read(), e.code)
                         + "\nIs the YouTube Data API v3 enabled in that Cloud project?")
    if not items:
        raise SystemExit("That Google account has no YouTube channel. Run it again and pick the channel's account.")
    return items[0]["id"], items[0]["snippet"]["title"]


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("channel", help="a short name for the channel, e.g. acme (items use --yt-channel acme)")
    ap.add_argument("--client-file", help="the OAuth client JSON (Desktop app) from Google Cloud")
    ap.add_argument("--check", action="store_true", help="say whether it's connected; change nothing")
    a = ap.parse_args(argv)
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,40}", a.channel):
        raise SystemExit("channel name: lowercase letters, digits and dashes, e.g. acme")
    if a.check:
        ok, what = youtube_api.connected(a.channel)
        print(f"Connected: {what}" if ok else f"Not connected: {what}")
        return 0 if ok else 1
    old = stored(a.channel) or {}
    if a.client_file:
        client = load_client(a.client_file)
    elif old.get("client_id") and old.get("client_secret"):
        client = {"client_id": old["client_id"], "client_secret": old["client_secret"]}
    else:
        raise SystemExit("First time: pass --client-file with the OAuth client JSON (see --help for the 5-minute setup).")
    tok = consent(client)
    cid, title = my_channel(tok["access_token"])
    keyring_store.store(youtube_api.key_name(a.channel), json.dumps(
        {**client, "refresh_token": tok["refresh_token"], "channel_id": cid, "channel_title": title}))
    print(f"Connected YouTube channel \"{title}\" ({cid}) as '{a.channel}'. Saved to the Keychain.")
    print("Outbox YouTube uploads for it will run on your click in Roo.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
